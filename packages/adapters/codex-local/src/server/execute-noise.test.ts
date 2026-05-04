import { describe, expect, it } from "vitest";
import { stripCodexTrustSurfaceNoise } from "./execute.js";

describe("stripCodexTrustSurfaceNoise", () => {
  it("removes known local Codex plugin and rollout noise while keeping real failures", () => {
    const input = [
      "2026-04-28T12:00:00.000000Z WARN codex_core_plugins::loader: failed to load plugin: plugin is not installed plugin=browser-use",
      "2026-04-28T12:00:01.000000Z WARN codex_core_plugins::manifest: ignoring interface.defaultPrompt because this interface is not supported",
      "2026-04-28T12:00:02.000000Z WARN codex_core::plugins::manager: ignoring remote plugins missing from local marketplace: browser-use",
      "2026-04-28T12:00:03.000000Z ERROR codex_core::session: failed to record rollout items: thread 123e4567-e89b-12d3-a456-426614174000 not found",
      "2026-04-28T12:00:04.000000Z ERROR codex_core::rollout::list: state db missing rollout path for thread 123e4567-e89b-12d3-a456-426614174000",
      "2026-05-04T20:58:00.000000Z WARN codex_core_skills::loader: ignoring interface.icon_small: icon path must not contain '..'",
      "2026-05-04T20:58:01.000000Z WARN codex_core_skills::loader: ignoring interface.icon_large: icon path must not contain '..'",
      "ERROR: You've hit your usage limit. Try again later.",
    ].join("\n");

    const cleaned = stripCodexTrustSurfaceNoise(input);

    expect(cleaned).toBe("ERROR: You've hit your usage limit. Try again later.");
  });
});
