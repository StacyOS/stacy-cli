/**
 * Run-chain spec: an ordered list of run steps where a later step can consume
 * an earlier step's `agent_output` KO as input via an `@<stepId>` reference.
 *
 *   { "steps": [
 *       { "id": "per_doc",   "task": "Summarize each doc", "use": ["ko_a","ko_b"] },
 *       { "id": "synthesis", "task": "Synthesize",         "use": ["@per_doc"]  }
 *   ]}
 *
 *   per_doc ──run──► ko_out1 ─┐
 *                              ├─ @per_doc resolves to ko_out1
 *   synthesis(use:[@per_doc]) ─┘──run──► ko_final
 *
 * This module is PURE — JSON parsing + structural validation + `@ref`
 * resolution only. No filesystem, no database, no adapter. Validation rejects
 * forward/unknown references up front so a malformed chain fails BEFORE the
 * egress gate or any KO read. Orchestration (calling `runOnce` per step) lives
 * in the verb layer.
 */

export const STEP_REF_PREFIX = "@";

export interface ChainStepSpec {
  readonly id: string;
  readonly task: string;
  /** Input refs: a literal KO id, or `@<priorStepId>` for a prior step output. */
  readonly use: readonly string[];
  /** Optional per-step model override. */
  readonly model?: string;
}

export interface ChainSpec {
  readonly steps: readonly ChainStepSpec[];
}

export class ChainSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainSpecError";
  }
}

export function isStepRef(use: string): boolean {
  return use.startsWith(STEP_REF_PREFIX);
}

export function stepRefId(use: string): string {
  return use.slice(STEP_REF_PREFIX.length);
}

/**
 * Parses and fully validates a chain spec from raw JSON. Throws
 * {@link ChainSpecError} on any structural problem or dangling `@ref`.
 */
export function parseChainSpec(raw: string): ChainSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ChainSpecError(`Chain spec is not valid JSON: ${(error as Error).message}`);
  }
  return validateChainSpec(parsed);
}

export function validateChainSpec(value: unknown): ChainSpec {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ChainSpecError('Chain spec must be a JSON object with a "steps" array.');
  }
  const steps = (value as Record<string, unknown>).steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new ChainSpecError('Chain spec "steps" must be a non-empty array.');
  }

  const seenIds = new Set<string>();
  const validated: ChainStepSpec[] = [];

  steps.forEach((rawStep, index) => {
    const where = `steps[${index}]`;
    if (typeof rawStep !== "object" || rawStep === null || Array.isArray(rawStep)) {
      throw new ChainSpecError(`${where} must be an object.`);
    }
    const step = rawStep as Record<string, unknown>;

    const id = typeof step.id === "string" ? step.id.trim() : "";
    if (!id) throw new ChainSpecError(`${where}.id is required and must be a non-empty string.`);
    if (seenIds.has(id)) throw new ChainSpecError(`${where}.id "${id}" is duplicated; step ids must be unique.`);

    const task = typeof step.task === "string" ? step.task.trim() : "";
    if (!task) throw new ChainSpecError(`${where}.task is required and must be a non-empty string.`);

    if (!Array.isArray(step.use) || step.use.length === 0) {
      throw new ChainSpecError(`${where}.use must be a non-empty array of KO ids or @stepId references.`);
    }
    const use: string[] = [];
    step.use.forEach((rawRef, refIndex) => {
      if (typeof rawRef !== "string" || rawRef.trim().length === 0) {
        throw new ChainSpecError(`${where}.use[${refIndex}] must be a non-empty string.`);
      }
      const ref = rawRef.trim();
      if (isStepRef(ref)) {
        const refId = stepRefId(ref);
        if (!refId) throw new ChainSpecError(`${where}.use[${refIndex}] "${ref}" is an empty step reference.`);
        if (refId === id) throw new ChainSpecError(`${where}.use[${refIndex}] "${ref}" refers to its own step.`);
        if (!seenIds.has(refId)) {
          throw new ChainSpecError(
            `${where}.use[${refIndex}] references "@${refId}", which is not a prior step. Steps run in order; a step can only use outputs declared before it.`,
          );
        }
      }
      use.push(ref);
    });

    let model: string | undefined;
    if (step.model !== undefined) {
      if (typeof step.model !== "string" || step.model.trim().length === 0) {
        throw new ChainSpecError(`${where}.model, when present, must be a non-empty string.`);
      }
      model = step.model.trim();
    }

    seenIds.add(id);
    validated.push({ id, task, use, ...(model ? { model } : {}) });
  });

  return { steps: validated };
}

/**
 * Resolves a step's `use[]` into concrete KO ids, substituting `@<stepId>`
 * references with the output KO id produced by that prior step. Assumes the
 * spec already passed {@link validateChainSpec}, so every ref is known.
 */
export function resolveStepInputs(
  step: ChainStepSpec,
  outputs: ReadonlyMap<string, string>,
): readonly string[] {
  return step.use.map((ref) => {
    if (!isStepRef(ref)) return ref;
    const refId = stepRefId(ref);
    const koId = outputs.get(refId);
    if (!koId) {
      throw new ChainSpecError(`Step "${step.id}" references "@${refId}" but that step produced no output.`);
    }
    return koId;
  });
}
