import { createDb } from "@arpanstacy/stacy-db";

import {
  readKnowledgeObject,
  type BrainDb,
} from "../src/brain/brain-store.js";
import { verifyKnowledgeObject } from "../src/ko/knowledge-object.js";
import {
  buildAgentOutputContent,
  type AgentRunInputReference,
} from "../src/runs/agent-output.js";
import {
  buildAdapterRegistry,
  resolveDefaultAdapterId,
  resolveRunAdapter,
  DEFAULT_ANTHROPIC_MODEL,
  type AdapterRunInput,
  type RunAdapter,
} from "../src/runs/adapters.js";
import { storeAgentRunOutput } from "../src/runs/run-service.js";
import {
  FileRunCache,
  computeRunCacheKey,
  type RunCache,
} from "../src/runs/run-cache.js";
import { resolveRunCacheDir } from "../src/identity/paths.js";
import type { AdapterRunResult } from "../src/runs/adapters.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface AgentRunOptions extends LocalRuntimeOptions {
  readonly use?: readonly string[];
  readonly model?: string;
  readonly adapter?: string;
  readonly ackEgress?: boolean;
  readonly noCache?: boolean;
  readonly koId?: string;
  readonly json?: boolean;
}

export interface AgentRunDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly readKnowledgeObject?: typeof readKnowledgeObject;
  readonly adapters?: ReadonlyMap<string, RunAdapter>;
  readonly cache?: RunCache;
  readonly stdout?: Pick<typeof console, "log">;
  readonly now?: () => Date;
}

export async function agentRunCommand(
  task: string,
  options: AgentRunOptions,
  dependencies: AgentRunDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const env = dependencies.env ?? process.env;
  const trimmedTask = task?.trim();
  if (!trimmedTask) {
    throw new Error("`stacy run` requires a task description.");
  }

  const inputKoIds = normalizeInputKoIds(options.use);
  if (inputKoIds.length === 0) {
    throw new Error("`stacy run` requires at least one input Knowledge Object via --use <ko_id>.");
  }

  const model = options.model?.trim() || DEFAULT_ANTHROPIC_MODEL;
  const registry = dependencies.adapters ?? buildAdapterRegistry({ env });
  const adapterName = options.adapter?.trim() || resolveDefaultAdapterId(env);
  const adapter = resolveRunAdapter(adapterName, registry);

  // Egress gate must fire before any Knowledge Object is read or any network
  // call is made, exactly like the existing demo runner.
  if (!adapter.deterministic && options.ackEgress !== true) {
    throw new Error(
      `The ${adapter.id} adapter may send Knowledge Object content outside this install. Re-run with --ack-egress to confirm, or use --adapter deterministic.`,
    );
  }

  const runtime = resolveLocalRuntime(options, dependencies);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const read = dependencies.readKnowledgeObject ?? readKnowledgeObject;
  const now = dependencies.now?.() ?? new Date();

  try {
    const inputs = await loadAndVerifyInputs({ db, read, koIds: inputKoIds });

    const cache = options.noCache === true
      ? undefined
      : dependencies.cache ?? new FileRunCache(resolveRunCacheDir(runtime.instanceRoot));
    const cacheKey = computeRunCacheKey({
      task: trimmedTask,
      model,
      adapter: adapter.id,
      inputContentHashes: inputs.map((input) => input.reference.contentHash),
    });

    let fromCache = false;
    let adapterResult: AdapterRunResult | undefined = await cache?.get(cacheKey);
    if (adapterResult) {
      fromCache = true;
    } else {
      adapterResult = await adapter.run({
        task: trimmedTask,
        model,
        inputs: inputs.map(
          (input): AdapterRunInput => ({
            koId: input.reference.koId,
            contentHash: input.reference.contentHash,
            contentType: input.reference.contentType,
            content: input.content,
          }),
        ),
      });
      await cache?.set(cacheKey, adapterResult);
    }

    const content = buildAgentOutputContent({
      task: trimmedTask,
      model,
      adapter: adapter.id,
      inputs: inputs.map((input) => input.reference),
      output: adapterResult.output,
      notes: adapterResult.notes,
    });

    const stored = await storeAgentRunOutput({
      db,
      identityPath: runtime.identityPath,
      content,
      adapter: adapter.id,
      model,
      inputKoIds,
      createdAt: now,
      storedAt: now,
      idGenerator: options.koId ? () => options.koId! : undefined,
    });

    const summary = {
      id: stored.ko.id,
      tenant: stored.ko.signedPayload.tenant,
      task: trimmedTask,
      model,
      adapter: adapter.id,
      inputKoIds,
      contentHash: stored.contentHash,
      creatorInstallId: stored.creatorInstallId,
      cached: fromCache,
    };

    stdout.log(options.json ? JSON.stringify(summary, null, 2) : formatRunText(summary, adapter.deterministic, options.ackEgress === true));
  } finally {
    if (ownsDb) await closeDb(db);
  }
}

interface LoadedInput {
  readonly reference: AgentRunInputReference;
  readonly content: AdapterRunInput["content"];
}

async function loadAndVerifyInputs(options: {
  readonly db: BrainDb;
  readonly read: typeof readKnowledgeObject;
  readonly koIds: readonly string[];
}): Promise<readonly LoadedInput[]> {
  const loaded: LoadedInput[] = [];
  for (const koId of options.koIds) {
    const result = await options.read({ db: options.db, koId });
    if (!result.ok) {
      throw new Error(`Input Knowledge Object ${koId} could not be read: ${result.reason}`);
    }
    const verification = verifyKnowledgeObject(result.ko);
    if (!verification.ok) {
      throw new Error(`Input Knowledge Object ${koId} failed verification: ${verification.reason}`);
    }
    loaded.push({
      reference: {
        koId: result.ko.id,
        contentHash: verification.contentHash,
        contentType: result.ko.signedPayload.contentType,
      },
      content: result.ko.signedPayload.content,
    });
  }
  return loaded;
}

function normalizeInputKoIds(use: readonly string[] | undefined): readonly string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of use ?? []) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function formatRunText(
  summary: {
    readonly id: string;
    readonly task: string;
    readonly model: string;
    readonly adapter: string;
    readonly inputKoIds: readonly string[];
    readonly contentHash: string;
    readonly creatorInstallId: string;
  },
  deterministic: boolean,
  ackEgress: boolean,
): string {
  return [
    `Egress acknowledgement: ${deterministic ? "not required (deterministic adapter)" : ackEgress ? "✓ (--ack-egress provided)" : "n/a"}`,
    `Adapter: ${summary.adapter}`,
    `Model: ${summary.model}`,
    `Input KOs: ${summary.inputKoIds.length} (${summary.inputKoIds.join(", ")})`,
    `✓ Output schema valid (agent_output)`,
    `✓ KO created: ${summary.id}`,
    `Content hash: ${summary.contentHash}`,
    `Creator install: ${summary.creatorInstallId}`,
    "",
    "Receipts: run, sign, create",
    `Inspect it with \`stacy brain show ${summary.id}\`.`,
  ].join("\n");
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
