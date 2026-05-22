import { createDb } from "@arpanstacy/stacy-db";

import { type CanonicalJsonValue } from "../src/crypto/canonical.js";
import {
  createLocalKnowledgeObject,
  type CreateLocalKnowledgeObjectResult,
} from "../src/brain/local-brain.js";
import { type BrainDb } from "../src/brain/brain-store.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";
import { generatePromptKnowledgeContent } from "./prompt-output.js";

export interface BrainCreateOptions extends LocalRuntimeOptions {
  readonly contentJson?: string;
  readonly prompt?: string;
  readonly adapterCommand?: string;
  readonly adapterArg?: string[];
  readonly contentType?: string;
  readonly koId?: string;
  readonly json?: boolean;
}

export interface BrainCreateDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly stdout?: Pick<typeof console, "log">;
  readonly now?: () => Date;
}

export async function brainCreateCommand(
  options: BrainCreateOptions,
  dependencies: BrainCreateDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const content = await resolveContent(options);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const createdAt = dependencies.now?.() ?? new Date();
  try {
    const result = await createLocalKnowledgeObject({
      db,
      identityPath: runtime.identityPath,
      contentType: options.contentType?.trim() || "application/json",
      content,
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

async function resolveContent(options: BrainCreateOptions): Promise<CanonicalJsonValue> {
  const hasContentJson = typeof options.contentJson === "string" && options.contentJson.trim().length > 0;
  const hasPrompt = typeof options.prompt === "string" && options.prompt.trim().length > 0;

  if (hasContentJson && hasPrompt) {
    throw new Error("Pass either --content-json or --prompt, not both.");
  }

  if (hasContentJson) {
    return parseContentJson(options.contentJson!);
  }

  if (hasPrompt) {
    const generated = await generatePromptKnowledgeContent({
      prompt: options.prompt!.trim(),
      adapterCommand: options.adapterCommand,
      adapterArgs: options.adapterArg,
    });
    return generated.content;
  }

  throw new Error("Pass --content-json or --prompt to create a Knowledge Object.");
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
