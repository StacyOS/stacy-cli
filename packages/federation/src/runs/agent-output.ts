import type { CanonicalJsonValue } from "../crypto/canonical.js";

export const AGENT_OUTPUT_KIND = "agent_output";
export const AGENT_OUTPUT_SCHEMA_VERSION = 1;

export interface AgentRunInputReference {
  readonly koId: string;
  readonly contentHash: string;
  readonly contentType: string;
}

export interface AgentOutputContent {
  readonly kind: typeof AGENT_OUTPUT_KIND;
  readonly schemaVersion: typeof AGENT_OUTPUT_SCHEMA_VERSION;
  readonly task: string;
  readonly model: string;
  readonly adapter: string;
  readonly generatedAt: string;
  readonly provenance: {
    readonly inputKoIds: readonly string[];
    readonly inputs: readonly AgentRunInputReference[];
  };
  readonly output: CanonicalJsonValue;
  readonly notes?: readonly string[];
}

export interface BuildAgentOutputContentOptions {
  readonly task: string;
  readonly model: string;
  readonly adapter: string;
  readonly generatedAt: Date;
  readonly inputs: readonly AgentRunInputReference[];
  readonly output: CanonicalJsonValue;
  readonly notes?: readonly string[];
}

/**
 * Validates an adapter's raw output and wraps it in the canonical
 * `agent_output` Knowledge Object content envelope. Provenance records every
 * input Knowledge Object id so the run is verifiably reproducible.
 */
export function buildAgentOutputContent(
  options: BuildAgentOutputContentOptions,
): AgentOutputContent & CanonicalJsonValue {
  assertValidAdapterOutput(options.output);

  const inputs = options.inputs.map((input) => ({
    koId: input.koId,
    contentHash: input.contentHash,
    contentType: input.contentType,
  }));

  const content: AgentOutputContent = {
    kind: AGENT_OUTPUT_KIND,
    schemaVersion: AGENT_OUTPUT_SCHEMA_VERSION,
    task: options.task,
    model: options.model,
    adapter: options.adapter,
    generatedAt: options.generatedAt.toISOString(),
    provenance: {
      inputKoIds: inputs.map((input) => input.koId),
      inputs,
    },
    output: options.output,
    ...(options.notes && options.notes.length > 0 ? { notes: options.notes } : {}),
  };

  return content as AgentOutputContent & CanonicalJsonValue;
}

/**
 * Ensures an adapter produced a structured, JSON-serializable result. Adapters
 * that return `undefined`, functions, or other non-canonical values are
 * rejected before a Knowledge Object is ever signed.
 */
export function assertValidAdapterOutput(
  output: unknown,
): asserts output is CanonicalJsonValue {
  if (output === undefined) {
    throw new Error("Adapter returned no output. Expected an agent_output payload.");
  }
  if (typeof output === "object" && output !== null) {
    return;
  }
  if (
    output === null ||
    typeof output === "string" ||
    typeof output === "number" ||
    typeof output === "boolean"
  ) {
    throw new Error("Adapter output must be a JSON object for the agent_output schema.");
  }
  throw new Error("Adapter output is not JSON-serializable.");
}
