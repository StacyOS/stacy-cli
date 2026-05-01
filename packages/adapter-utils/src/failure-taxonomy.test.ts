import { describe, expect, it } from "vitest";
import {
  ADAPTER_EXECUTION_ERROR_FAMILIES,
  ADAPTER_EXECUTION_FAILURE_TAXONOMY,
  getAdapterExecutionFailureTaxonomyEntry,
  isAdapterExecutionErrorFamily,
} from "./failure-taxonomy.js";

describe("adapter execution failure taxonomy", () => {
  it("defines one matrix row for every shared failure family", () => {
    expect(ADAPTER_EXECUTION_ERROR_FAMILIES).toEqual([
      "transient_upstream",
      "auth_required",
      "unknown_session",
      "max_turns",
      "validation",
      "timeout",
      "cancelled",
    ]);
    expect(ADAPTER_EXECUTION_FAILURE_TAXONOMY.map((entry) => entry.family)).toEqual(
      ADAPTER_EXECUTION_ERROR_FAMILIES,
    );
  });

  it("captures retry and session-clearing semantics for the risky adapter cases", () => {
    expect(getAdapterExecutionFailureTaxonomyEntry("transient_upstream")).toMatchObject({
      retryableByDefault: true,
      clearsSession: false,
      operatorAction: "wait_or_retry",
    });
    expect(getAdapterExecutionFailureTaxonomyEntry("unknown_session")).toMatchObject({
      retryableByDefault: true,
      clearsSession: true,
      operatorAction: "retry_fresh_session",
    });
    expect(getAdapterExecutionFailureTaxonomyEntry("auth_required")).toMatchObject({
      retryableByDefault: false,
      clearsSession: false,
      operatorAction: "reauthenticate",
    });
  });

  it("guards family values before adapters persist them", () => {
    expect(isAdapterExecutionErrorFamily("max_turns")).toBe(true);
    expect(isAdapterExecutionErrorFamily("claude_max_turns")).toBe(false);
    expect(isAdapterExecutionErrorFamily(null)).toBe(false);
  });
});
