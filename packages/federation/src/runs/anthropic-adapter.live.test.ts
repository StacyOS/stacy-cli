import { describe, expect, it } from "vitest";

import { buildAgentOutputContent } from "./agent-output.js";
import { createAnthropicAdapter, DEFAULT_ANTHROPIC_MODEL } from "./adapters.js";

/**
 * Live, opt-in smoke test for the anthropic adapter. It is skipped unless an
 * adapter command is configured via STACY_ANTHROPIC_ADAPTER_COMMAND, so CI and
 * offline runs never spawn an external (billable) process or send egress.
 *
 * Enable it with, e.g.:
 *   STACY_ANTHROPIC_ADAPTER_COMMAND=./scripts/claude-cli-adapter.mjs \
 *     pnpm --filter @arpanstacy/stacy-federation exec vitest run \
 *     src/runs/anthropic-adapter.live.test.ts
 */
const adapterCommand = process.env.STACY_ANTHROPIC_ADAPTER_COMMAND?.trim();

describe.skipIf(!adapterCommand)("anthropic adapter (live)", () => {
  it("runs the configured adapter command and wraps it in a valid agent_output KO", async () => {
    const adapter = createAnthropicAdapter();
    expect(adapter.deterministic).toBe(false);

    const result = await adapter.run({
      task: "Summarize the linked pull request in two sentences.",
      model: DEFAULT_ANTHROPIC_MODEL,
      inputs: [
        {
          koId: "ko_live_input",
          contentHash: "sha256:live",
          contentType: "application/json",
          content: { kind: "github_pull_request", number: 1, title: "Add caching" },
        },
      ],
    });

    expect(result.output).toBeDefined();
    expect(typeof result.output).toBe("object");

    // The adapter output must survive being wrapped as a signed-content payload.
    const content = buildAgentOutputContent({
      task: "Summarize the linked pull request in two sentences.",
      model: DEFAULT_ANTHROPIC_MODEL,
      adapter: adapter.id,
      generatedAt: new Date("2026-06-01T00:00:00.000Z"),
      inputs: [
        { koId: "ko_live_input", contentHash: "sha256:live", contentType: "application/json" },
      ],
      output: result.output,
      notes: result.notes,
    });

    expect(content).toMatchObject({
      kind: "agent_output",
      adapter: "anthropic",
      provenance: { inputKoIds: ["ko_live_input"] },
    });
  }, 180_000);
});
