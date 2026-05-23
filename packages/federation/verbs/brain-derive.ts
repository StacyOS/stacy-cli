import { createDb } from "@arpanstacy/stacy-db";

import {
  createDerivedKnowledgeObject,
  type CreateDerivedKnowledgeObjectResult,
} from "../src/brain/derived-brain.js";
import type { BrainDb } from "../src/brain/brain-store.js";
import type { CanonicalJsonValue } from "../src/crypto/canonical.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface BrainDeriveOptions extends LocalRuntimeOptions {
  readonly contentJson?: string;
  readonly contentType?: string;
  readonly koId?: string;
  readonly json?: boolean;
}

export interface BrainDeriveDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly stdout?: Pick<typeof console, "log">;
  readonly now?: () => Date;
}

export async function brainDeriveCommand(
  sourceKoId: string,
  options: BrainDeriveOptions,
  dependencies: BrainDeriveDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const derivedContent = parseContentJson(options.contentJson);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const createdAt = dependencies.now?.() ?? new Date();

  try {
    const result = await createDerivedKnowledgeObject({
      db,
      identityPath: runtime.identityPath,
      sourceKoId,
      derivedContent,
      contentType: options.contentType,
      createdAt,
      storedAt: createdAt,
      idGenerator: options.koId ? () => options.koId! : undefined,
    });

    if (options.json) {
      stdout.log(JSON.stringify(formatBrainDeriveJson(result), null, 2));
      return;
    }

    stdout.log(formatBrainDeriveText(result));
  } finally {
    if (ownsDb) {
      await closeDb(db);
    }
  }
}

function parseContentJson(raw: string | undefined): CanonicalJsonValue {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("Pass --content-json to create a derived Knowledge Object.");
  }
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

function formatBrainDeriveJson(result: CreateDerivedKnowledgeObjectResult) {
  return {
    id: result.ko.id,
    tenant: result.ko.signedPayload.tenant,
    contentType: result.ko.signedPayload.contentType,
    contentHash: result.contentHash,
    creatorInstallId: result.creatorInstallId,
    sourceKoId: result.sourceKoId,
    sourceContentHash: result.sourceContentHash,
    sourceProducerInstallId: result.sourceProducerInstallId,
    grantId: result.grantId,
    signature: result.ko.signature,
  };
}

function formatBrainDeriveText(result: CreateDerivedKnowledgeObjectResult): string {
  return [
    `Created derived Knowledge Object: ${result.ko.id}`,
    `Source Knowledge Object: ${result.sourceKoId}`,
    `Source content hash: ${result.sourceContentHash}`,
    `Grant: ${result.grantId}`,
    `Derived content hash: ${result.contentHash}`,
    `Creator install: ${result.creatorInstallId}`,
  ].join("\n");
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
