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
  const cache = options.noCache === true
    ? undefined
    : dependencies.cache ?? new FileRunCache(resolveRunCacheDir(runtime.instanceRoot));

  try {
    const result = await runOnce(
      { task: trimmedTask, model, adapter, inputKoIds, koId: options.koId },
      { db, read, cache, identityPath: runtime.identityPath, now },
    );

    const summary = {
      id: result.koId,
      tenant: result.tenant,
      task: trimmedTask,
      model,
      adapter: adapter.id,
      inputKoIds,
      contentHash: result.contentHash,
      creatorInstallId: result.creatorInstallId,
      cached: result.fromCache,
    };

    stdout.log(options.json ? JSON.stringify(summary, null, 2) : formatRunText(summary, adapter.deterministic, options.ackEgress === true));
  } finally {
    if (ownsDb) await closeDb(db);
  }
}

/** Inputs to a single run step. The adapter is already resolved and the egress
 * gate already cleared by the caller (so chains gate once, up front). */
export interface RunOnceParams {
  readonly task: string;
  readonly model: string;
  readonly adapter: RunAdapter;
  readonly inputKoIds: readonly string[];
  readonly koId?: string;
}

/** Shared run dependencies. One `cache` instance is reused across chain steps. */
export interface RunOnceContext {
  readonly db: BrainDb;
  readonly read: typeof readKnowledgeObject;
  readonly cache?: RunCache;
  readonly identityPath: string;
  readonly now: Date;
}

export interface RunOnceResult {
  readonly koId: string;
  readonly contentHash: string;
  readonly creatorInstallId: string;
  readonly tenant: string;
  readonly fromCache: boolean;
}

/**
 * Executes ONE run: load + verify inputs, consult the run-result cache, invoke
 * the adapter on a miss, then sign + store the `agent_output` KO. Returns the
 * stored KO id so callers can chain steps. The single-run verb and the run
 * chain both go through here — no duplicated run logic, no stdout parsing.
 */
export async function runOnce(
  params: RunOnceParams,
  context: RunOnceContext,
): Promise<RunOnceResult> {
  const inputs = await loadAndVerifyInputs({
    db: context.db,
    read: context.read,
    koIds: params.inputKoIds,
  });

  const cacheKey = computeRunCacheKey({
    task: params.task,
    model: params.model,
    adapter: params.adapter.id,
    inputContentHashes: inputs.map((input) => input.reference.contentHash),
  });

  let fromCache = false;
  let adapterResult: AdapterRunResult | undefined = await context.cache?.get(cacheKey);
  if (adapterResult) {
    fromCache = true;
  } else {
    adapterResult = await params.adapter.run({
      task: params.task,
      model: params.model,
      inputs: inputs.map(
        (input): AdapterRunInput => ({
          koId: input.reference.koId,
          contentHash: input.reference.contentHash,
          contentType: input.reference.contentType,
          content: input.content,
        }),
      ),
    });
    await context.cache?.set(cacheKey, adapterResult);
  }

  const content = buildAgentOutputContent({
    task: params.task,
    model: params.model,
    adapter: params.adapter.id,
    inputs: inputs.map((input) => input.reference),
    output: adapterResult.output,
    notes: adapterResult.notes,
  });

  const stored = await storeAgentRunOutput({
    db: context.db,
    identityPath: context.identityPath,
    content,
    adapter: params.adapter.id,
    model: params.model,
    inputKoIds: params.inputKoIds,
    createdAt: context.now,
    storedAt: context.now,
    idGenerator: params.koId ? () => params.koId! : undefined,
  });

  return {
    koId: stored.ko.id,
    contentHash: stored.contentHash,
    creatorInstallId: stored.creatorInstallId,
    tenant: stored.ko.signedPayload.tenant,
    fromCache,
  };
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
