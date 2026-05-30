import { createDb } from "@arpanstacy/stacy-db";

import type { BrainDb, KnowledgeObjectSummary } from "../src/brain/brain-store.js";
import { listKnowledgeObjects } from "../src/brain/brain-store.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface BrainListOptions extends LocalRuntimeOptions {
  readonly contentType?: string;
  readonly source?: string;
  readonly limit?: string | number;
  readonly json?: boolean;
}

export interface BrainListDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly stdout?: Pick<typeof console, "log">;
}

export async function brainListCommand(
  options: BrainListOptions,
  dependencies: BrainListDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);

  const source = normalizeSource(options.source);
  const limit = normalizeLimit(options.limit);

  try {
    const objects = await listKnowledgeObjects({
      db,
      contentType: options.contentType,
      source,
      limit,
    });

    if (options.json) {
      stdout.log(JSON.stringify({ knowledgeObjects: objects }, null, 2));
      return;
    }

    stdout.log(formatKnowledgeObjects(objects));
  } finally {
    if (ownsDb) await closeDb(db);
  }
}

function normalizeSource(value: string | undefined): "local" | "federated" | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return undefined;
  if (trimmed === "local" || trimmed === "federated") return trimmed;
  throw new Error(`Invalid --source "${value}". Expected "local" or "federated".`);
}

function normalizeLimit(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --limit "${value}". Expected a number between 1 and 100.`);
  }
  return parsed;
}

function formatKnowledgeObjects(objects: readonly KnowledgeObjectSummary[]): string {
  if (objects.length === 0) {
    return "No Knowledge Objects.";
  }

  const idWidth = Math.max(2, ...objects.map((object) => object.id.length));
  const typeWidth = Math.max(12, ...objects.map((object) => object.contentType.length));
  const header = `${"ID".padEnd(idWidth)}  ${"CONTENT-TYPE".padEnd(typeWidth)}  ${"SRC".padEnd(9)}  CREATED`;
  const rows = objects.map((object) => {
    const created = object.createdAt.replace("T", " ").replace(/\.\d+Z?$/, "").replace("Z", "");
    return `${object.id.padEnd(idWidth)}  ${object.contentType.padEnd(typeWidth)}  ${object.source.padEnd(9)}  ${created}`;
  });

  return [header, ...rows, "", `Total: ${objects.length}`].join("\n");
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
