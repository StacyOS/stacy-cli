import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { createDb } from "@arpanstacy/stacy-db";

import { type CanonicalJsonValue } from "../src/crypto/canonical.js";
import {
  createLocalKnowledgeObject,
  type CreateLocalKnowledgeObjectResult,
} from "../src/brain/local-brain.js";
import { type BrainDb } from "../src/brain/brain-store.js";
import {
  FileDocumentError,
  buildFileDocumentContent,
  safeSourceLabel,
  type FileDocumentResult,
} from "../src/brain/file-document.js";
import { collectFiles, type CollectedFile } from "../src/brain/file-walk.js";
import {
  resolveLocalRuntime,
  type LocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";
import { generatePromptKnowledgeContent } from "./prompt-output.js";

export interface BrainCreateOptions extends LocalRuntimeOptions {
  readonly contentJson?: string;
  readonly prompt?: string;
  readonly file?: string;
  readonly dir?: string;
  readonly glob?: string;
  readonly ext?: string;
  readonly yes?: boolean;
  readonly sourceLabel?: string;
  readonly maxBytes?: number;
  readonly adapterCommand?: string;
  readonly adapterArg?: string[];
  readonly contentType?: string;
  readonly koId?: string;
  readonly json?: boolean;
}

/** Resolved content plus the content type to sign it under. */
interface ResolvedContent {
  readonly content: CanonicalJsonValue;
  readonly contentType: string;
}

export interface BrainCreateDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly stdout?: Pick<typeof console, "log">;
  readonly now?: () => Date;
  /** Confirmation hook for directory ingest; defaults to a TTY prompt. */
  readonly confirm?: (summary: string) => Promise<boolean>;
}

export async function brainCreateCommand(
  options: BrainCreateOptions,
  dependencies: BrainCreateDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);

  if (isDirectoryMode(options)) {
    await brainCreateFromDirectory(options, dependencies, runtime, stdout);
    return;
  }

  const resolved = await resolveContent(options);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const createdAt = dependencies.now?.() ?? new Date();
  try {
    const result = await createLocalKnowledgeObject({
      db,
      identityPath: runtime.identityPath,
      contentType: resolved.contentType,
      content: resolved.content,
      createdAt,
      storedAt: createdAt,
      idGenerator: options.koId ? () => options.koId! : undefined,
    });

    if (options.json) {
      stdout.log(JSON.stringify(formatBrainCreateJson(result), null, 2));
      return;
    }

    stdout.log(formatBrainCreateText(result));
  } finally {
    if (ownsDb) {
      await closeDb(db);
    }
  }
}

async function resolveContent(options: BrainCreateOptions): Promise<ResolvedContent> {
  const hasContentJson = typeof options.contentJson === "string" && options.contentJson.trim().length > 0;
  const hasPrompt = typeof options.prompt === "string" && options.prompt.trim().length > 0;
  const hasFile = typeof options.file === "string" && options.file.trim().length > 0;

  const sources = [hasContentJson, hasPrompt, hasFile].filter(Boolean).length;
  if (sources > 1) {
    throw new Error("Pass exactly one of --content-json, --prompt, or --file.");
  }

  if (hasFile) {
    const fileResult = await readFileDocument(options);
    return { content: fileResult.content, contentType: fileResult.contentType };
  }

  if (hasContentJson) {
    return {
      content: parseContentJson(options.contentJson!),
      contentType: options.contentType?.trim() || "application/json",
    };
  }

  if (hasPrompt) {
    const generated = await generatePromptKnowledgeContent({
      prompt: options.prompt!.trim(),
      adapterCommand: options.adapterCommand,
      adapterArgs: options.adapterArg,
    });
    return {
      content: generated.content,
      contentType: options.contentType?.trim() || "application/json",
    };
  }

  throw new Error("Pass --content-json, --prompt, or --file to create a Knowledge Object.");
}

/**
 * Reads a single local file and wraps it in a signed-KO document envelope.
 * The source label stored in the KO is a cwd-relative path (or basename if the
 * file sits outside cwd) so absolute paths never leak into shareable KOs.
 */
async function readFileDocument(
  options: BrainCreateOptions,
  reader: (path: string) => Promise<Buffer> = (path) => readFile(path),
): Promise<FileDocumentResult> {
  const filePath = options.file!.trim();
  const bytes = await reader(filePath);
  const sourceLabel = options.sourceLabel?.trim() || relativeSourceLabel(filePath);
  return buildFileDocumentContent({
    path: filePath,
    bytes,
    sourceLabel,
    maxBytes: options.maxBytes,
  });
}

/** Leak-safe cwd-relative label (basename if the file sits outside cwd). */
function relativeSourceLabel(filePath: string): string {
  const absolute = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  return safeSourceLabel(relative(process.cwd(), absolute));
}

// ---------------------------------------------------------------------------
// Directory ingest (--dir / --glob / --ext): one signed KO per matching file.
//
//   collectFiles ──► confirm summary ──► per-file: read → wrap → sign+store
//                          │                          │
//                          └─ --yes / --json skip     └─ binary/oversize ⇒ warn+skip
// ---------------------------------------------------------------------------

function isDirectoryMode(options: BrainCreateOptions): boolean {
  const has = (v: string | undefined): boolean => typeof v === "string" && v.trim().length > 0;
  return has(options.dir) || has(options.glob) || has(options.ext);
}

async function brainCreateFromDirectory(
  options: BrainCreateOptions,
  dependencies: BrainCreateDependencies,
  runtime: LocalRuntime,
  stdout: Pick<typeof console, "log">,
): Promise<void> {
  if (options.file || options.contentJson || options.prompt) {
    throw new Error("--dir/--glob/--ext cannot be combined with --file, --content-json, or --prompt.");
  }
  if (options.koId) {
    throw new Error("--ko-id is only valid for single-object creation, not directory ingest.");
  }

  const ext = options.ext
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const { files, skipped } = collectFiles({ root: options.dir, glob: options.glob, ext });

  if (files.length === 0) {
    stdout.log(options.json ? JSON.stringify({ created: [], skipped: skipped.length }) : "No matching files found.");
    return;
  }

  const approved = options.yes === true || options.json === true
    ? true
    : await confirmDirectory(buildDirectorySummary(files, skipped.length), dependencies, stdout);
  if (!approved) {
    stdout.log("Aborted. No Knowledge Objects were created.");
    return;
  }

  const maxBytes = options.maxBytes;
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const createdAt = dependencies.now?.() ?? new Date();

  const created: { id: string; source: string; contentHash: string }[] = [];
  const failures: { source: string; reason: string }[] = [];

  try {
    for (const file of files) {
      let document: FileDocumentResult;
      try {
        const bytes = await readFile(file.absolutePath);
        document = buildFileDocumentContent({ path: file.absolutePath, bytes, sourceLabel: file.label, maxBytes });
      } catch (error) {
        const reason = error instanceof FileDocumentError ? error.message : (error as Error).message;
        failures.push({ source: file.label, reason });
        if (!options.json) stdout.log(`  skip ${file.label}: ${reason}`);
        continue;
      }

      const result = await createLocalKnowledgeObject({
        db,
        identityPath: runtime.identityPath,
        contentType: document.contentType,
        content: document.content,
        createdAt,
        storedAt: createdAt,
      });
      created.push({ id: result.ko.id, source: document.source, contentHash: result.contentHash });
    }
  } finally {
    if (ownsDb) await closeDb(db);
  }

  if (options.json) {
    stdout.log(JSON.stringify({ created, skipped: skipped.length, failed: failures }, null, 2));
    return;
  }
  stdout.log(
    [
      `Created ${created.length} Knowledge Object(s).`,
      ...created.map((c) => `  ${c.id}  ${c.source}`),
      ...(failures.length > 0 ? [`Skipped ${failures.length} unreadable file(s).`] : []),
    ].join("\n"),
  );
}

function buildDirectorySummary(files: readonly CollectedFile[], skippedCount: number): string {
  const preview = files.slice(0, 20).map((f) => `  ${f.label}`);
  const more = files.length > 20 ? [`  …and ${files.length - 20} more`] : [];
  const skipNote = skippedCount > 0 ? [`(${skippedCount} path(s) excluded: hidden/node_modules/.git/symlinks)`] : [];
  return [
    `About to create ${files.length} signed Knowledge Object(s) from local files:`,
    ...preview,
    ...more,
    ...skipNote,
  ].join("\n");
}

async function confirmDirectory(
  summary: string,
  dependencies: BrainCreateDependencies,
  stdout: Pick<typeof console, "log">,
): Promise<boolean> {
  if (dependencies.confirm) return dependencies.confirm(summary);

  stdout.log(summary);
  if (!process.stdin.isTTY) {
    throw new Error("Directory ingest needs confirmation. Re-run with --yes for non-interactive use.");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Continue? [y/N] ");
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

function parseContentJson(raw: string): CanonicalJsonValue {
  const parsed = JSON.parse(raw) as unknown;
  assertCanonicalJsonValue(parsed, "content");
  return parsed;
}

function assertCanonicalJsonValue(value: unknown, path: string): asserts value is CanonicalJsonValue {
  if (value === null) return;

  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") return;
  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must be finite JSON`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertCanonicalJsonValue(entry, `${path}[${index}]`);
    });
    return;
  }

  if (valueType === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      assertCanonicalJsonValue(entry, `${path}.${key}`);
    }
    return;
  }

  throw new Error(`${path} is not valid JSON content`);
}

function formatBrainCreateJson(result: CreateLocalKnowledgeObjectResult) {
  return {
    id: result.ko.id,
    tenant: result.ko.signedPayload.tenant,
    contentType: result.ko.signedPayload.contentType,
    contentHash: result.contentHash,
    creatorInstallId: result.creatorInstallId,
    signature: result.ko.signature,
  };
}

function formatBrainCreateText(result: CreateLocalKnowledgeObjectResult): string {
  return [
    `Created Knowledge Object: ${result.ko.id}`,
    `Tenant: ${result.ko.signedPayload.tenant}`,
    `Content hash: ${result.contentHash}`,
    `Creator install: ${result.creatorInstallId}`,
  ].join("\n");
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
