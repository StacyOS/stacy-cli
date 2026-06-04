import { describe, expect, it } from "vitest";

import { generatePromptKnowledgeContent } from "./prompt-output.js";

describe("generatePromptKnowledgeContent", () => {
  it("uses deterministic fallback content when no adapter command is configured", async () => {
    await expect(
      generatePromptKnowledgeContent({ prompt: "build a dashboard" }),
    ).resolves.toEqual({
      generator: "deterministic_fallback",
      content: {
        kind: "agent_output",
        prompt: "build a dashboard",
        output: "Deterministic Stacy federation KO content for prompt: build a dashboard",
        generatedAt: "1970-01-01T00:00:00.000Z",
        generator: "deterministic_fallback",
      },
    });
  });

  it("can collect output from an adapter-like command", async () => {
    const result = await generatePromptKnowledgeContent({
      prompt: "hello",
      adapterCommand: process.execPath,
      adapterArgs: ["-e", "process.stdin.pipe(process.stdout)"],
    });

    expect(result).toEqual({
      generator: "adapter_command",
      content: {
        kind: "agent_output",
        prompt: "hello",
        output: "hello",
        generatedAt: "1970-01-01T00:00:00.000Z",
        generator: "adapter_command",
      },
    });
  });
});
