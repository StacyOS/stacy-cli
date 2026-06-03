import { describe, expect, it } from "vitest";

import {
  ChainSpecError,
  parseChainSpec,
  resolveStepInputs,
  validateChainSpec,
} from "./chain.js";

describe("parseChainSpec / validateChainSpec", () => {
  it("accepts a valid two-step chain with a forward-resolved @ref", () => {
    const spec = parseChainSpec(
      JSON.stringify({
        steps: [
          { id: "per_doc", task: "Summarize each", use: ["ko_a", "ko_b"] },
          { id: "synthesis", task: "Synthesize", use: ["@per_doc"], model: "claude-sonnet-4-5" },
        ],
      }),
    );
    expect(spec.steps).toHaveLength(2);
    expect(spec.steps[1]?.use).toEqual(["@per_doc"]);
    expect(spec.steps[1]?.model).toBe("claude-sonnet-4-5");
  });

  it("rejects invalid JSON", () => {
    expect(() => parseChainSpec("{not json")).toThrow(ChainSpecError);
  });

  it("requires a non-empty steps array", () => {
    expect(() => validateChainSpec({})).toThrow(/non-empty array/);
    expect(() => validateChainSpec({ steps: [] })).toThrow(/non-empty array/);
  });

  it("requires id, task, and non-empty use on each step", () => {
    expect(() => validateChainSpec({ steps: [{ task: "t", use: ["k"] }] })).toThrow(/id is required/);
    expect(() => validateChainSpec({ steps: [{ id: "a", use: ["k"] }] })).toThrow(/task is required/);
    expect(() => validateChainSpec({ steps: [{ id: "a", task: "t", use: [] }] })).toThrow(/non-empty array/);
  });

  it("rejects duplicate step ids", () => {
    expect(() =>
      validateChainSpec({
        steps: [
          { id: "a", task: "t", use: ["k"] },
          { id: "a", task: "t2", use: ["k"] },
        ],
      }),
    ).toThrow(/duplicated/);
  });

  it("rejects an @ref to an unknown or forward step (before any run)", () => {
    expect(() =>
      validateChainSpec({
        steps: [{ id: "a", task: "t", use: ["@missing"] }],
      }),
    ).toThrow(/not a prior step/);

    expect(() =>
      validateChainSpec({
        steps: [
          { id: "a", task: "t", use: ["@b"] }, // forward ref
          { id: "b", task: "t2", use: ["k"] },
        ],
      }),
    ).toThrow(/not a prior step/);
  });

  it("rejects a self-reference", () => {
    expect(() =>
      validateChainSpec({ steps: [{ id: "a", task: "t", use: ["@a"] }] }),
    ).toThrow(/its own step/);
  });
});

describe("resolveStepInputs", () => {
  it("substitutes @refs with prior step output KO ids and passes literals through", () => {
    const step = { id: "synthesis", task: "t", use: ["ko_literal", "@per_doc"] };
    const outputs = new Map([["per_doc", "ko_out_1"]]);
    expect(resolveStepInputs(step, outputs)).toEqual(["ko_literal", "ko_out_1"]);
  });

  it("throws when a referenced step has no output", () => {
    const step = { id: "synthesis", task: "t", use: ["@per_doc"] };
    expect(() => resolveStepInputs(step, new Map())).toThrow(ChainSpecError);
  });
});
