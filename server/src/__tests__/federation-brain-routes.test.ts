import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { federationBrainRoutes } from "../routes/federation-brain.js";

const federationMocks = vi.hoisted(() => ({
  listReceipts: vi.fn(),
  readKnowledgeObject: vi.fn(),
  readKnowledgeObjectWithConsent: vi.fn(),
  syncRevocationFromProducer: vi.fn(),
  verifyGlobalReceiptAnchor: vi.fn(),
  verifyReceiptChain: vi.fn(),
}));

vi.mock("@arpanstacy/stacy-federation", () => federationMocks);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/federation/brain", federationBrainRoutes({} as never));
  return app;
}

describe("federationBrainRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    federationMocks.listReceipts.mockResolvedValue([
      {
        id: "receipt_1",
        eventType: "read",
        tenant: "stacy/acme",
        koId: "ko_demo",
        actorInstallId: "install_b",
        counterpartyInstallId: "install_a",
        payload: {},
        createdAt: "2026-05-22T00:00:00.000Z",
        receiptHash: "sha256:receipt",
      },
    ]);
    federationMocks.verifyReceiptChain.mockResolvedValue({ valid: true, checked: 1 });
    federationMocks.verifyGlobalReceiptAnchor.mockResolvedValue({ valid: true, checked: 3 });
    federationMocks.syncRevocationFromProducer.mockResolvedValue({ synced: false });
  });

  it("returns a visual-ready KO payload for allowed reads", async () => {
    federationMocks.readKnowledgeObject.mockResolvedValue({
      ok: true,
      ko: {
        id: "ko_demo",
        signedPayload: {
          tenant: "stacy/acme",
          contentType: "application/vnd.stacy.dashboard+json",
          contentHash: "sha256:ko",
          creatorInstallId: "install_a",
          content: {
            kind: "dashboard",
            title: "Revenue dashboard",
            summary: "Pipeline is growing.",
            widgets: [{ kind: "metric", label: "Revenue", value: "$423,750" }],
          },
        },
        signer: { installId: "install_a" },
        signature: "sig",
      },
      provenance: {
        source: "local",
        creatorInstallId: "install_a",
        storedAt: "2026-05-22T00:00:00.000Z",
      },
      verification: { contentHash: "sha256:ko" },
    });

    const res = await request(createApp()).get("/api/federation/brain/ko_demo");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "allowed",
      id: "ko_demo",
      contentHash: "sha256:ko",
      verification: { signature: "verified" },
      consent: { status: "local_owner" },
      receipts: {
        total: 1,
        byEvent: { read: 1 },
      },
      receiptVerification: {
        koChainValid: true,
        globalAnchorValid: true,
      },
    });
  });

  it("syncs revocation and returns denied state for consumer reads", async () => {
    federationMocks.readKnowledgeObjectWithConsent.mockResolvedValue({
      ok: false,
      reason: "revoked",
    });

    const res = await request(createApp()).get("/api/federation/brain/ko_demo?asConsumer=install_b");

    expect(res.status).toBe(200);
    expect(federationMocks.syncRevocationFromProducer).toHaveBeenCalledWith({
      db: {},
      koId: "ko_demo",
    });
    expect(res.body).toMatchObject({
      status: "denied",
      id: "ko_demo",
      reason: "revoked",
      asConsumer: "install_b",
      receipts: {
        total: 1,
      },
    });
  });
});
