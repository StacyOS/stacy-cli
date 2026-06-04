import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createDb } from "@arpanstacy/stacy-db";

import {
  readKnowledgeObject,
  type BrainDb,
} from "../src/brain/brain-store.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface BrainExportOptions extends LocalRuntimeOptions {
  readonly out?: string;
  readonly json?: boolean;
}

export interface BrainExportDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly readKnowledgeObject?: typeof readKnowledgeObject;
  readonly writeFile?: (path: string, contents: string) => Promise<void>;
  readonly stdout?: Pick<typeof console, "log">;
}

export async function brainExportCommand(
  koId: string,
  options: BrainExportOptions,
  dependencies: BrainExportDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const read = dependencies.readKnowledgeObject ?? readKnowledgeObject;

  try {
    const result = await read({ db, koId });
    if (!result.ok) {
      throw new Error(result.reason);
    }

    const outPath = resolve(options.out?.trim() || `${koId}.stacy-ko.json`);
    const envelope = {
      kind: "stacy_knowledge_object_export" as const,
      schemaVersion: 1 as const,
      ko: result.ko,
    };
    const serialized = `${JSON.stringify(envelope, null, 2)}\n`;

    if (dependencies.writeFile) {
      await dependencies.writeFile(outPath, serialized);
    } else {
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, serialized, { mode: 0o600 });
    }

    const summary = {
      koId: result.ko.id,
      contentHash: result.verification.contentHash,
      out: outPath,
    };
    stdout.log(
      options.json
        ? JSON.stringify(summary, null, 2)
        : [
            "Knowledge Object exported.",
            `KO: ${summary.koId}`,
            `Content hash: ${summary.contentHash}`,
            `Written to: ${summary.out}`,
          ].join("\n"),
    );
  } finally {
    if (ownsDb) await closeDb(db);
  }
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
