import { describe, expect, it } from "vitest";

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
      generatedAt: new Date("2026-05-22T00:00:00.000Z"),
      inputs: [
        { koId: "ko_a", contentHash: "sha256:aa", contentType: "application/json" },
        { koId: "ko_b", contentHash: "sha256:bb", contentType: "application/json" },
      ],
      output: { kind: "report", title: "Done" },
      notes: ["note"],
    });

    expect(content.kind).toBe(AGENT_OUTPUT_KIND);
    expect(content.provenance.inputKoIds).toEqual(["ko_a", "ko_b"]);
    expect(content.generatedAt).toBe("2026-05-22T00:00:00.000Z");
    expect(content.notes).toEqual(["note"]);
  });

  it("omits notes when empty", () => {
    const content = buildAgentOutputContent({
      task: "Summarize",
      model: "m",
      adapter: "deterministic",
      generatedAt: new Date("2026-05-22T00:00:00.000Z"),
      inputs: [],
      output: { kind: "report" },
    });
    expect(content.notes).toBeUndefined();
  });

  it("rejects non-object adapter output", () => {
    expect(() => assertValidAdapterOutput("string")).toThrow("must be a JSON object");
    expect(() => assertValidAdapterOutput(undefined)).toThrow("no output");
  });
});
