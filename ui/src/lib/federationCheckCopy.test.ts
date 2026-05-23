import { describe, expect, it } from "vitest";

import { describeFederationCheck, federationCheckDescriptions } from "./federationCheckCopy";

describe("federation check copy", () => {
  it("covers every verification check emitted by the federation report builder", () => {
    expect(Object.keys(federationCheckDescriptions).sort()).toEqual([
      "content_contract",
      "content_contract_version",
      "dashboard_contract",
      "deterministic_reconciliation",
      "referral_packet_contract",
      "report_contract",
      "signed_ko_verified",
      "source_input_reconciled",
      "table_contract",
    ]);
  });

  it("returns a fallback for unknown check ids", () => {
    expect(describeFederationCheck("future_check")).toBe(
      "Check ID: future_check, no description registered.",
    );
  });
});
