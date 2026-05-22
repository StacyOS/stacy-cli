import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename } from "node:path";
import { createDb } from "@arpanstacy/stacy-db";

import type { BrainDb } from "../src/brain/brain-store.js";
import { createLocalKnowledgeObject } from "../src/brain/local-brain.js";
import {
  createDeterministicDashboardContent,
  parseDashboardSchema,
  parseCsvDashboardInput,
  redactDashboardInputForAdapter,
  normalizeRedactedColumns,
} from "../src/dashboard/dashboard-content.js";
import { parseAdapterDashboardOutput } from "../src/dashboard/adapter-output.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export const DEFAULT_ADAPTER_TIMEOUT_MS = 60_000;
export type AdapterOutputMode = "text" | "json";

export interface RunTaskOptions extends LocalRuntimeOptions {
  readonly input?: string;
  readonly schema?: string;
  readonly adapterCommand?: string;
  readonly adapterArg?: string[];
  readonly adapterOutput?: string;
  readonly adapterTimeoutMs?: string | number;
  readonly redactColumn?: string[];
  readonly ackEgress?: boolean;
  readonly koId?: string;
  readonly json?: boolean;
}

export interface RunTaskDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly stdout?: Pick<typeof console, "log">;
  readonly now?: () => Date;
}

export async function runTaskCommand(
  task: string,
  options: RunTaskOptions,
  dependencies: RunTaskDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const env = dependencies.env ?? process.env;
  const runtime = resolveLocalRuntime(options, dependencies);
  const inputPath = options.input?.trim();
  if (!inputPath) {
    throw new Error("Public federation demo tasks require --input <file>.");
  }

  const rawInput = await readFile(inputPath, "utf8");
  const dashboardInput = parseCsvDashboardInput(inputPath, rawInput);
  const redactedColumns = normalizeRedactedColumns(
    dashboardInput.columns,
    collectRedactedColumns(options.redactColumn, env.STACY_PUBLIC_DEMO_REDACT_COLUMNS),
  );
  const adapterInput = redactDashboardInputForAdapter(dashboardInput, redactedColumns);
  const dashboardSchema = options.schema?.trim()
    ? parseDashboardSchema(await readFile(options.schema.trim(), "utf8"))
    : undefined;
  const adapterCommand = options.adapterCommand?.trim();
  const adapterOutputMode = parseAdapterOutputMode(options.adapterOutput);
  if (adapterCommand && !options.ackEgress) {
    throw new Error("Adapter execution may send input records outside this install. Re-run with --ack-egress to confirm.");
  }
  const adapterOutput = adapterCommand
    ? await runAdapterCommand({
        command: adapterCommand,
        args: options.adapterArg ?? [],
        stdin: JSON.stringify({ task, input: adapterInput, redactedColumns }, null, 2),
        timeoutMs: parseAdapterTimeoutMs(options.adapterTimeoutMs),
        allowedAdapters: parseAllowedAdapters(env.STACY_PUBLIC_DEMO_ALLOWED_ADAPTERS),
      })
    : undefined;
  const adapterDashboard = adapterOutput && adapterOutputMode === "json"
    ? parseAdapterDashboardOutput(adapterOutput)
    : undefined;
  const content = createDeterministicDashboardContent({
    task,
    input: dashboardInput,
    schema: dashboardSchema,
    adapterOutput: adapterOutputMode === "text" ? adapterOutput : undefined,
    adapterDashboard,
    redactedColumns,
  });
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const createdAt = dependencies.now?.() ?? new Date();

  try {
    const result = await createLocalKnowledgeObject({
      db,
      identityPath: runtime.identityPath,
      contentType: "application/json",
      content,
      createdAt,
      storedAt: createdAt,
      idGenerator: options.koId ? () => options.koId! : undefined,
    });

    const output = {
      id: result.ko.id,
      tenant: result.ko.signedPayload.tenant,
      task,
      input: content.input,
      redactedColumns: content.redactedColumns ?? [],
      generator: content.generator,
      contentHash: result.contentHash,
      creatorInstallId: result.creatorInstallId,
      signature: result.ko.signature,
    };

    stdout.log(options.json ? JSON.stringify(output, null, 2) : formatRunTaskText(output));
  } finally {
    if (ownsDb) await closeDb(db);
  }
}

async function runAdapterCommand(options: {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly allowedAdapters: ReadonlySet<string> | null;
}): Promise<string> {
  assertAdapterAllowed(options.command, options.allowedAdapters);
  const child = spawn(options.command, [...options.args], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin?.end(options.stdin);

  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolveExit(code);
    });
  });
  if (timedOut) {
    throw new Error(`Adapter command timed out after ${options.timeoutMs}ms`);
  }
  if (exitCode !== 0) {
    throw new Error(`Adapter command failed with exit code ${exitCode ?? "unknown"}: ${stderr.trim()}`);
  }
  return stdout.trim();
}

function parseAdapterTimeoutMs(value: string | number | undefined): number {
  if (value === undefined || value === "") return DEFAULT_ADAPTER_TIMEOUT_MS;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--adapter-timeout-ms must be a positive integer.");
  }
  return parsed;
}

function parseAdapterOutputMode(value: string | undefined): AdapterOutputMode {
  const normalized = (value ?? "text").trim().toLowerCase();
  if (normalized === "text" || normalized === "json") return normalized;
  throw new Error("--adapter-output must be either text or json.");
}

function parseAllowedAdapters(raw: string | undefined): ReadonlySet<string> | null {
  const entries = raw
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries?.length ? new Set(entries) : null;
}

function collectRedactedColumns(optionColumns: readonly string[] | undefined, envColumns: string | undefined): readonly string[] {
  const fromOptions = optionColumns ?? [];
  const fromEnv = envColumns?.split(",") ?? [];
  return [...fromOptions, ...fromEnv].flatMap((entry) =>
    entry
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean),
  );
}

function assertAdapterAllowed(command: string, allowedAdapters: ReadonlySet<string> | null): void {
  if (!allowedAdapters) return;
  const binaryName = basename(command);
  if (!allowedAdapters.has(binaryName)) {
    throw new Error(
      `Adapter command "${binaryName}" is not allowed. Set STACY_PUBLIC_DEMO_ALLOWED_ADAPTERS to permit it.`,
    );
  }
}

function formatRunTaskText(output: {
  readonly id: string;
  readonly task: string;
  readonly generator?: string;
  readonly contentHash: string;
  readonly creatorInstallId: string;
}): string {
  return [
    `Created public demo Knowledge Object: ${output.id}`,
    `Task: ${output.task}`,
    ...(output.generator ? [`Generator: ${output.generator}`] : []),
    `Content hash: ${output.contentHash}`,
    `Creator install: ${output.creatorInstallId}`,
  ].join("\n");
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
