import { readFile } from "node:fs/promises";

import { createDb } from "@arpanstacy/stacy-db";

import {
  readKnowledgeObject,
  type BrainDb,
} from "../src/brain/brain-store.js";
import { canonicalBytes } from "../src/crypto/canonical.js";
import { sha256Hex } from "../src/util/hash.js";
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
import {
  parseChainSpec,
  resolveStepInputs,
} from "../src/runs/chain.js";
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

export interface ChainRunOptions extends LocalRuntimeOptions {
  /** Path to the chain spec JSON file. */
  readonly chain: string;
  readonly model?: string;
  readonly adapter?: string;
  readonly ackEgress?: boolean;
  readonly noCache?: boolean;
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
  const adapter = resolveAdapterWithEgressGate(adapterName, registry, options.ackEgress === true);

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

/**
 * Resolves a run adapter and enforces the egress gate. For a non-deterministic
 * adapter, this throws BEFORE any KO is read or network call is made unless the
 * caller acknowledged egress. A chain calls this ONCE, up front, so the whole
 * chain is gated before its first step reads anything.
 */
function resolveAdapterWithEgressGate(
  adapterName: string,
  registry: ReadonlyMap<string, RunAdapter>,
  ackEgress: boolean,
): RunAdapter {
  const adapter = resolveRunAdapter(adapterName, registry);
  if (!adapter.deterministic && !ackEgress) {
    throw new Error(
      `The ${adapter.id} adapter may send Knowledge Object content outside this install. Re-run with --ack-egress to confirm, or use --adapter deterministic.`,
    );
  }
  return adapter;
}

/**
 * Runs a multi-step chain: each step is a {@link runOnce}, and a later step can
 * consume an earlier step's output KO via an `@<stepId>` reference. The spec is
 * parsed and fully validated (including `@ref` resolution) before the egress
 * gate and before any KO is read, so a malformed chain never egresses. A step
 * failure aborts the chain; already-produced step KOs are durable (no rollback)
 * and the error names the failed step.
 */
export async function runChainCommand(
  options: ChainRunOptions,
  dependencies: AgentRunDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const env = dependencies.env ?? process.env;

  const specPath = options.chain?.trim();
  if (!specPath) {
    throw new Error("`stacy run --chain` requires a path to a chain spec JSON file.");
  }
  const spec = parseChainSpec(await readFile(specPath, "utf8"));

  const model = options.model?.trim() || DEFAULT_ANTHROPIC_MODEL;
  const registry = dependencies.adapters ?? buildAdapterRegistry({ env });
  const adapterName = options.adapter?.trim() || resolveDefaultAdapterId(env);
  // Gate ONCE, up front, before any KO read.
  const adapter = resolveAdapterWithEgressGate(adapterName, registry, options.ackEgress === true);

  const runtime = resolveLocalRuntime(options, dependencies);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const read = dependencies.readKnowledgeObject ?? readKnowledgeObject;
  const now = dependencies.now?.() ?? new Date();
  const cache = options.noCache === true
    ? undefined
    : dependencies.cache ?? new FileRunCache(resolveRunCacheDir(runtime.instanceRoot));
  const context = { db, read, cache, identityPath: runtime.identityPath, now };

  const outputs = new Map<string, string>();
  const stepSummaries: {
    id: string;
    koId: string;
    inputKoIds: readonly string[];
    cached: boolean;
  }[] = [];

  try {
    for (const step of spec.steps) {
      const inputKoIds = resolveStepInputs(step, outputs);
      let result;
      try {
        result = await runOnce(
          { task: step.task, model: step.model?.trim() || model, adapter, inputKoIds },
          context,
        );
      } catch (error) {
        throw new Error(`Chain step "${step.id}" failed: ${(error as Error).message}`);
      }
      outputs.set(step.id, result.koId);
      stepSummaries.push({ id: step.id, koId: result.koId, inputKoIds, cached: result.fromCache });
    }
  } finally {
    if (ownsDb) await closeDb(db);
  }

  const finalStep = stepSummaries[stepSummaries.length - 1];
  const summary = {
    steps: stepSummaries,
    finalKoId: finalStep?.koId,
    adapter: adapter.id,
    model,
  };

  stdout.log(options.json ? JSON.stringify(summary, null, 2) : formatChainText(summary, adapter.deterministic, options.ackEgress === true));
}

function formatChainText(
  summary: {
    readonly steps: readonly { id: string; koId: string; inputKoIds: readonly string[]; cached: boolean }[];
    readonly finalKoId?: string;
    readonly adapter: string;
    readonly model: string;
  },
  deterministic: boolean,
  ackEgress: boolean,
): string {
  const lines = [
    `Egress acknowledgement: ${deterministic ? "not required (deterministic adapter)" : ackEgress ? "✓ (--ack-egress provided)" : "n/a"}`,
    `Adapter: ${summary.adapter}   Model: ${summary.model}`,
    `Chain steps: ${summary.steps.length}`,
  ];
  for (const step of summary.steps) {
    lines.push(
      `  ${step.id}: ${step.koId}${step.cached ? " (cached)" : ""}  ← ${step.inputKoIds.join(", ")}`,
    );
  }
  lines.push("", `Final output KO: ${summary.finalKoId}`, `Inspect it with \`stacy brain show ${summary.finalKoId}\`.`);
  return lines.join("\n");
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
    inputContentHashes: inputs.map((input) => input.cacheHash),
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
  /**
   * Hash of the input's CONTENT (+ content type) only — independent of the KO's
   * `createdAt`. The KO's own `contentHash` folds in a wall-clock `createdAt`
   * (knowledge-object.ts), so it changes every time a KO is created even for
   * identical content. Using it as a run-cache key would make a chain's
   * downstream step (whose input is the prior step's freshly-created output KO)
   * miss the cache on every run. Keying on content instead means identical
   * inputs reuse the cached adapter result, so an identical chain re-run makes
   * zero adapter calls. The KO `contentHash` is still used for provenance.
   */
  readonly cacheHash: string;
}

/** Content-addressed cache hash: stable across runs and installs for identical
 * content, unlike the KO id/contentHash which embed `createdAt`. */
function computeInputCacheHash(contentType: string, content: AdapterRunInput["content"]): string {
  return sha256Hex(canonicalBytes({ contentType, content }));
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
    const contentType = result.ko.signedPayload.contentType;
    const content = result.ko.signedPayload.content;
    loaded.push({
      reference: {
        koId: result.ko.id,
        contentHash: verification.contentHash,
        contentType,
      },
      content,
      cacheHash: computeInputCacheHash(contentType, content),
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
