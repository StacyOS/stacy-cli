import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { federationMetricsRoutes } from "../routes/federation-metrics.js";

const federationMocks = vi.hoisted(() => ({
  listReceipts: vi.fn(),
  verifyGlobalReceiptAnchor: vi.fn(),
}));

vi.mock("@arpanstacy/stacy-federation", () => federationMocks);

function createApp() {
  const app = express();
  app.use("/api/federation/metrics", federationMetricsRoutes({} as never));
  return app;
}

describe("federationMetricsRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    federationMocks.verifyGlobalReceiptAnchor.mockResolvedValue({ valid: true, checked: 8 });
    federationMocks.listReceipts.mockResolvedValue([
      {
        id: "receipt_create",
        eventType: "create",
        koId: "ko_referral_packet",
        createdAt: "2026-05-23T00:00:00.000Z",
        payload: {},
      },
      {
        id: "receipt_share",
        eventType: "share",
        koId: "ko_referral_packet",
        createdAt: "2026-05-23T00:00:01.000Z",
        payload: {},
      },
      {
        id: "receipt_receive",
        eventType: "receive",
        koId: "ko_referral_packet",
        createdAt: "2026-05-23T00:00:02.000Z",
        payload: { receiveDurationMs: 82 },
      },
      {
        id: "receipt_read",
        eventType: "read",
        koId: "ko_referral_packet",
        createdAt: "2026-05-23T00:00:03.000Z",
        payload: { readEnforcementMs: 3 },
      },
      {
        id: "receipt_deny",
        eventType: "deny",
        koId: "ko_referral_packet",
        createdAt: "2026-05-23T00:00:04.000Z",
        payload: { readEnforcementMs: 4 },
      },
      {
        id: "receipt_revoke",
        eventType: "revoke",
        koId: "ko_referral_packet",
        createdAt: "2026-05-23T00:00:05.000Z",
        payload: {},
      },
    ]);
  });

  it("returns federation counts, averages, and receipt anchor status", async () => {
    const res = await request(createApp()).get("/api/federation/metrics");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      koCount: 1,
      shareCount: 1,
      revokeCount: 1,
      denyCount: 1,
      readCount: 1,
      receiveCount: 1,
      averageFederationReceiveMs: 82,
      federationRoundtripP50Ms: 82,
      averageReadEnforcementMs: 3.5,
      mostRecentReceiptAt: "2026-05-23T00:00:05.000Z",
      receiptChain: {
        globalAnchorValid: true,
        checkedAnchors: 8,
      },
      receipts: {
        total: 6,
        byEvent: {
          create: 1,
          share: 1,
          receive: 1,
          read: 1,
          deny: 1,
          revoke: 1,
        },
      },
    });
  });
});
