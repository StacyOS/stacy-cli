import { describe, expect, it } from "vitest";
import {
  extractClaudeRetryNotBefore,
  isClaudeTransientUpstreamError,
  parseClaudeStreamJson,
} from "./parse.js";

describe("parseClaudeStreamJson", () => {
  it("captures session, model, summary, usage, cost, and raw result metadata", () => {
    const resultEvent = {
      type: "result",
      session_id: "claude-session-123",
      model: "claude-sonnet-4-5",
      result: "Finished and verified.",
      total_cost_usd: 0.045,
      usage: {
        input_tokens: 30,
        cache_read_input_tokens: 12,
        output_tokens: 6,
      },
    };
    const stdout = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "claude-session-123",
        model: "claude-sonnet-4-5",
      }),
      JSON.stringify({
        type: "assistant",
        session_id: "claude-session-123",
        message: {
          content: [{ type: "text", text: "Working through the task." }],
        },
      }),
      JSON.stringify(resultEvent),
    ].join("\n");

    expect(parseClaudeStreamJson(stdout)).toEqual({
      sessionId: "claude-session-123",
      model: "claude-sonnet-4-5",
      costUsd: 0.045,
      usage: {
        inputTokens: 30,
        cachedInputTokens: 12,
        outputTokens: 6,
      },
      summary: "Finished and verified.",
      resultJson: resultEvent,
    });
  });

  it("falls back to assistant text when no final result event is emitted", () => {
    const stdout = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "claude-session-456",
        model: "claude-opus-4-1",
      }),
      JSON.stringify({
        type: "assistant",
        session_id: "claude-session-456",
        message: { content: [{ type: "text", text: "First update." }] },
      }),
      JSON.stringify({
        type: "assistant",
        session_id: "claude-session-456",
        message: { content: [{ type: "text", text: "Second update." }] },
      }),
    ].join("\n");

    expect(parseClaudeStreamJson(stdout)).toEqual({
      sessionId: "claude-session-456",
      model: "claude-opus-4-1",
      costUsd: null,
      usage: null,
      summary: "First update.\n\nSecond update.",
      resultJson: null,
    });
  });
});

describe("isClaudeTransientUpstreamError", () => {
  it("classifies the 'out of extra usage' subscription window failure as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "You're out of extra usage · resets 4pm (America/Chicago)",
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          is_error: true,
          result: "You're out of extra usage. Resets at 4pm (America/Chicago).",
        },
      }),
    ).toBe(true);
  });

  it("classifies Anthropic API rate_limit_error and overloaded_error as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          is_error: true,
          errors: [{ type: "rate_limit_error", message: "Rate limit reached for requests." }],
        },
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          is_error: true,
          errors: [{ type: "overloaded_error", message: "Overloaded" }],
        },
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        stderr: "HTTP 429: Too Many Requests",
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        stderr: "Bedrock ThrottlingException: slow down",
      }),
    ).toBe(true);
  });

  it("classifies the subscription 5-hour / weekly limit wording", () => {
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "Claude usage limit reached — weekly limit reached. Try again in 2 days.",
      }),
    ).toBe(true);
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "5-hour limit reached.",
      }),
    ).toBe(true);
  });

  it("does not classify login/auth failures as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        stderr: "Please log in. Run `claude login` first.",
      }),
    ).toBe(false);
  });

  it("does not classify max-turns or unknown-session as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        parsed: { subtype: "error_max_turns", result: "Maximum turns reached." },
      }),
    ).toBe(false);
    expect(
      isClaudeTransientUpstreamError({
        parsed: {
          result: "No conversation found with session id abc-123",
          errors: [{ message: "No conversation found with session id abc-123" }],
        },
      }),
    ).toBe(false);
  });

  it("does not classify deterministic validation errors as transient", () => {
    expect(
      isClaudeTransientUpstreamError({
        errorMessage: "Invalid request_error: Unknown parameter 'foo'.",
      }),
    ).toBe(false);
  });
});

describe("extractClaudeRetryNotBefore", () => {
  it("parses the 'resets 4pm' hint in its explicit timezone", () => {
    const now = new Date("2026-04-22T15:15:00.000Z");
    const extracted = extractClaudeRetryNotBefore(
      { errorMessage: "You're out of extra usage · resets 4pm (America/Chicago)" },
      now,
    );
    expect(extracted?.toISOString()).toBe("2026-04-22T21:00:00.000Z");
  });

  it("rolls forward past midnight when the reset time has already passed today", () => {
    const now = new Date("2026-04-22T23:30:00.000Z");
    const extracted = extractClaudeRetryNotBefore(
      { errorMessage: "Usage limit reached. Resets at 3:15 AM (UTC)." },
      now,
    );
    expect(extracted?.toISOString()).toBe("2026-04-23T03:15:00.000Z");
  });

  it("returns null when no reset hint is present", () => {
    expect(
      extractClaudeRetryNotBefore({ errorMessage: "Overloaded. Try again later." }, new Date()),
    ).toBeNull();
  });
});
