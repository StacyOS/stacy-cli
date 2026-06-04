import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createDb } from "@arpanstacy/stacy-db";

import {
  verifyKnowledgeObject,
  type SignedKnowledgeObject,
} from "../src/ko/knowledge-object.js";
import {
  storeKnowledgeObject,
  type BrainDb,
  type BrainKnowledgeObjectSource,
} from "../src/brain/brain-store.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface BrainImportOptions extends LocalRuntimeOptions {
  readonly source?: string;
  readonly json?: boolean;
}

export interface BrainImportDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly storeKnowledgeObject?: typeof storeKnowledgeObject;
  readonly readFile?: (path: string) => Promise<string>;
  readonly stdout?: Pick<typeof console, "log">;
}

interface KnowledgeObjectExportEnvelope {
  readonly kind: "stacy_knowledge_object_export";
  readonly schemaVersion: 1;
  readonly ko: SignedKnowledgeObject;
}

export async function brainImportCommand(
  path: string,
  options: BrainImportOptions,
  dependencies: BrainImportDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const source = normalizeSource(options.source);

  const inPath = resolve(path.trim());
  const read = dependencies.readFile ?? ((target: string) => readFile(target, "utf8"));
  const ko = parseExportEnvelope(await read(inPath));

  const verification = verifyKnowledgeObject(ko);
  if (!verification.ok) {
    throw new Error(`Cannot import invalid Knowledge Object: ${verification.reason}`);
  }

  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const store = dependencies.storeKnowledgeObject ?? storeKnowledgeObject;

  try {
    const stored = await store({ db, ko, source });

    const summary = {
      koId: stored.id,
      contentHash: stored.contentHash,
      source,
      from: inPath,
    };
    stdout.log(
      options.json
        ? JSON.stringify(summary, null, 2)
        : [
            "Knowledge Object imported.",
            `KO: ${summary.koId}`,
            `Content hash: ${summary.contentHash}`,
            `Source: ${summary.source}`,
            `Imported from: ${summary.from}`,
          ].join("\n"),
    );
  } finally {
    if (ownsDb) await closeDb(db);
  }
}

function normalizeSource(value: string | undefined): BrainKnowledgeObjectSource {
  if (value === undefined) return "federated";
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return "federated";
  if (trimmed === "local" || trimmed === "federated") return trimmed;
  throw new Error(`Invalid --source "${value}". Expected "local" or "federated".`);
}

function parseExportEnvelope(serialized: string): SignedKnowledgeObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Knowledge Object export file is not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Knowledge Object export file is not a valid export envelope.");
  }

  const envelope = parsed as Partial<KnowledgeObjectExportEnvelope>;
  if (envelope.kind !== "stacy_knowledge_object_export") {
    throw new Error("Knowledge Object export file has the wrong kind.");
  }
  if (envelope.schemaVersion !== 1) {
    throw new Error(`Unsupported Knowledge Object export schema version ${String(envelope.schemaVersion)}.`);
  }
  if (typeof envelope.ko !== "object" || envelope.ko === null) {
    throw new Error("Knowledge Object export file is missing its Knowledge Object.");
  }

  return envelope.ko;
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
