import { readFile } from "node:fs/promises";
import { createDb } from "@arpanstacy/stacy-db";

import type { BrainDb } from "../src/brain/brain-store.js";
import {
  createVerificationKnowledgeObject,
  type CreateVerificationKnowledgeObjectResult,
} from "../src/brain/verification-brain.js";
import { parseDashboardSchema } from "../src/dashboard/dashboard-content.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface BrainVerifyOptions extends LocalRuntimeOptions {
  readonly input?: string;
  readonly schema?: string;
  readonly koId?: string;
  readonly json?: boolean;
}

export interface BrainVerifyDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly stdout?: Pick<typeof console, "log">;
  readonly now?: () => Date;
}

export async function brainVerifyCommand(
  sourceKoId: string,
  options: BrainVerifyOptions,
  dependencies: BrainVerifyDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const inputPath = options.input?.trim();
  const schemaPath = options.schema?.trim();
  const input = inputPath
    ? {
        path: inputPath,
        raw: await readFile(inputPath, "utf8"),
      }
    : undefined;
  const schema = schemaPath ? parseDashboardSchema(await readFile(schemaPath, "utf8")) : undefined;
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const createdAt = dependencies.now?.() ?? new Date();

  try {
    const result = await createVerificationKnowledgeObject({
      db,
      identityPath: runtime.identityPath,
      sourceKoId,
      input,
      schema,
      createdAt,
      storedAt: createdAt,
      idGenerator: options.koId ? () => options.koId! : undefined,
    });

    stdout.log(options.json ? JSON.stringify(formatBrainVerifyJson(result), null, 2) : formatBrainVerifyText(result));
  } finally {
    if (ownsDb) await closeDb(db);
  }
}

function formatBrainVerifyJson(result: CreateVerificationKnowledgeObjectResult) {
  return {
    id: result.ko.id,
    tenant: result.ko.signedPayload.tenant,
    contentType: result.ko.signedPayload.contentType,
    contentHash: result.contentHash,
    creatorInstallId: result.creatorInstallId,
    sourceKoId: result.sourceKoId,
    sourceContentHash: result.sourceContentHash,
    sourceProducerInstallId: result.sourceProducerInstallId,
    verdict: result.report.verdict,
    checks: result.report.checks,
    signature: result.ko.signature,
  };
}

function formatBrainVerifyText(result: CreateVerificationKnowledgeObjectResult): string {
  return [
    `Created verification Knowledge Object: ${result.ko.id}`,
    `Source Knowledge Object: ${result.sourceKoId}`,
    `Source content hash: ${result.sourceContentHash}`,
    `Verdict: ${result.report.verdict}`,
    ...result.report.checks.map((check) => `- ${check.status}: ${check.id} - ${check.summary}`),
    `Verification content hash: ${result.contentHash}`,
    `Verifier install: ${result.creatorInstallId}`,
  ].join("\n");
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
