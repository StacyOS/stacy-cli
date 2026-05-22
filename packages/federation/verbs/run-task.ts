import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createDb } from "@arpanstacy/stacy-db";

import type { BrainDb } from "../src/brain/brain-store.js";
import { createLocalKnowledgeObject } from "../src/brain/local-brain.js";
import {
  createDeterministicDashboardContent,
  parseCsvDashboardInput,
} from "../src/dashboard/dashboard-content.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface RunTaskOptions extends LocalRuntimeOptions {
  readonly input?: string;
  readonly adapterCommand?: string;
  readonly adapterArg?: string[];
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
  const runtime = resolveLocalRuntime(options, dependencies);
  const inputPath = options.input?.trim();
  if (!inputPath) {
    throw new Error("Public federation demo tasks require --input <file>.");
  }

  const rawInput = await readFile(inputPath, "utf8");
  const dashboardInput = parseCsvDashboardInput(inputPath, rawInput);
  const adapterOutput = options.adapterCommand?.trim()
    ? await runAdapterCommand({
        command: options.adapterCommand.trim(),
        args: options.adapterArg ?? [],
        stdin: JSON.stringify({ task, input: dashboardInput }, null, 2),
      })
    : undefined;
  const content = createDeterministicDashboardContent({
    task,
    input: dashboardInput,
    adapterOutput,
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
}): Promise<string> {
  const child = spawn(options.command, [...options.args], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
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
    child.on("error", reject);
    child.on("close", resolveExit);
  });
  if (exitCode !== 0) {
    throw new Error(`Adapter command failed with exit code ${exitCode ?? "unknown"}: ${stderr.trim()}`);
  }
  return stdout.trim();
}

function formatRunTaskText(output: {
  readonly id: string;
  readonly task: string;
  readonly contentHash: string;
  readonly creatorInstallId: string;
}): string {
  return [
    `Created public demo Knowledge Object: ${output.id}`,
    `Task: ${output.task}`,
    `Content hash: ${output.contentHash}`,
    `Creator install: ${output.creatorInstallId}`,
  ].join("\n");
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
