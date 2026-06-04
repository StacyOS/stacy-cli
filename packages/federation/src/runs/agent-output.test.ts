import { describe, expect, it } from "vitest";

import { canonicalize } from "../crypto/canonical.js";
import {
  AGENT_OUTPUT_KIND,
  assertValidAdapterOutput,
  buildAgentOutputContent,
} from "./agent-output.js";

describe("buildAgentOutputContent", () => {
  it("wraps adapter output with input KO provenance", () => {
    const content = buildAgentOutputContent({
      task: "Summarize",
      model: "claude-sonnet-4-5",
      adapter: "deterministic",
      inputs: [
        { koId: "ko_a", contentHash: "sha256:aa", contentType: "application/json" },
        { koId: "ko_b", contentHash: "sha256:bb", contentType: "application/json" },
      ],
      output: { kind: "report", title: "Done" },
      notes: ["note"],
    });

    expect(content.kind).toBe(AGENT_OUTPUT_KIND);
    expect(content.provenance.inputKoIds).toEqual(["ko_a", "ko_b"]);
    expect(content.notes).toEqual(["note"]);
  });

  it("omits notes when empty", () => {
    const content = buildAgentOutputContent({
      task: "Summarize",
      model: "m",
      adapter: "deterministic",
      inputs: [],
      output: { kind: "report" },
    });
    expect(content.notes).toBeUndefined();
  });

  it("is timestamp-free and deterministic for identical inputs (chain caching #7)", () => {
    const build = () =>
      buildAgentOutputContent({
        task: "Summarize",
        model: "m",
        adapter: "deterministic",
        inputs: [{ koId: "ko_a", contentHash: "sha256:aa", contentType: "application/json" }],
        output: { kind: "report", title: "Done" },
      });

    const first = build();
    const second = build();
    // No wall-clock field leaks into the hashed content.
    expect("generatedAt" in first).toBe(false);
    // Two identical builds produce byte-identical canonical content, so the KO
    // content hash is stable across runs and chain steps re-cache correctly.
    expect(canonicalize(first)).toBe(canonicalize(second));
  });

  it("rejects non-object adapter output", () => {
    expect(() => assertValidAdapterOutput("string")).toThrow("must be a JSON object");
    expect(() => assertValidAdapterOutput(undefined)).toThrow("no output");
  });
});
