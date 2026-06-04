import { describe, expect, it } from "vitest";

import { summarizeFederationHealth } from "./FederationHealthCard";

describe("FederationHealthCard", () => {
  it("formats available federation metrics", () => {
    expect(
      summarizeFederationHealth({
        koCount: 2,
        receipts: { total: 7, byEvent: {} },
        mostRecentReceiptAt: "2026-05-23T00:00:00.000Z",
        federationRoundtripP50Ms: 82,
      }),
    ).toMatchObject({
      koCount: "2",
      receipts: "7",
      roundtripP50: "82ms",
    });
  });

  it("survives an empty metrics response", () => {
    expect(summarizeFederationHealth({})).toEqual({
      koCount: "0",
      receipts: "0",
      latestReceipt: "none",
      roundtripP50: "n/a",
    });
  });
});
