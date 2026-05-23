import express from "express";
import http from "node:http";
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
  app.use("/api/federation/ko", federationBrainRoutes({} as never));
  app.use("/api/federation/v1/ko", federationBrainRoutes({} as never));
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
      {
        id: "receipt_verify",
        eventType: "verify",
        tenant: "stacy/acme",
        koId: "ko_demo",
        actorInstallId: "install_verifier",
        counterpartyInstallId: "install_a",
        payload: {
          verificationKoId: "ko_verification",
          verificationContentHash: "sha256:verification",
          verdict: "pass",
          failedChecks: [],
          warningChecks: ["deterministic_reconciliation"],
        },
        createdAt: "2026-05-22T00:00:01.000Z",
        receiptHash: "sha256:verify_receipt",
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
        signer: { installId: "install_a", publicKeyPem: "public-key-a" },
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
      identities: {
        producer: {
          label: "Northstar Clinic",
          installId: "install_a",
          verified: true,
        },
        signer: {
          label: "Northstar Clinic",
          installId: "install_a",
          publicKeyFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
        },
      },
      consent: { status: "local_owner" },
      receipts: {
        total: 2,
        byEvent: { read: 1, verify: 1 },
      },
      receiptVerification: {
        koChainValid: true,
        globalAnchorValid: true,
      },
      verificationReports: [
        {
          verificationKoId: "ko_verification",
          verificationContentHash: "sha256:verification",
          verdict: "pass",
          warningChecks: ["deterministic_reconciliation"],
          verifierInstallId: "install_verifier",
        },
      ],
    });
  });

  it("serves the stable v1 KO read API with the same enforcement payload", async () => {
    federationMocks.readKnowledgeObject.mockResolvedValue({
      ok: true,
      ko: {
        id: "ko_demo",
        signedPayload: {
          tenant: "stacy/acme",
          contentType: "application/vnd.stacy.report+json",
          contentHash: "sha256:ko",
          creatorInstallId: "install_a",
          content: {
            kind: "report",
            title: "Northstar Clinic Referral Packet",
            summary: "Referral packet ready for review.",
            sections: [],
          },
        },
        signer: { installId: "install_a", publicKeyPem: "public-key-a" },
        signature: "sig",
      },
      provenance: {
        source: "local",
        creatorInstallId: "install_a",
        storedAt: "2026-05-22T00:00:00.000Z",
      },
      verification: { contentHash: "sha256:ko" },
    });

    const res = await request(createApp()).get("/api/federation/v1/ko/ko_demo");

    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBeUndefined();
    expect(res.headers.sunset).toBeUndefined();
    expect(res.body).toMatchObject({
      status: "allowed",
      id: "ko_demo",
      content: {
        kind: "report",
        title: "Northstar Clinic Referral Packet",
      },
      receiptVerification: {
        koChainValid: true,
        globalAnchorValid: true,
      },
    });
  });

  it("marks the unversioned KO read API as deprecated", async () => {
    federationMocks.readKnowledgeObject.mockResolvedValue({
      ok: true,
      ko: {
        id: "ko_demo",
        signedPayload: {
          tenant: "stacy/acme",
          contentType: "application/vnd.stacy.report+json",
          contentHash: "sha256:ko",
          creatorInstallId: "install_a",
          content: {
            kind: "report",
            title: "Northstar Clinic Referral Packet",
            summary: "Referral packet ready for review.",
            sections: [],
          },
        },
        signer: { installId: "install_a", publicKeyPem: "public-key-a" },
        signature: "sig",
      },
      provenance: {
        source: "local",
        creatorInstallId: "install_a",
        storedAt: "2026-05-22T00:00:00.000Z",
      },
      verification: { contentHash: "sha256:ko" },
    });

    const res = await request(createApp()).get("/api/federation/ko/ko_demo");

    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBe("true");
    expect(res.headers.sunset).toBe("Fri, 21 Aug 2026 00:00:00 GMT");
    expect(res.body).toMatchObject({ status: "allowed", id: "ko_demo" });
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
      identities: {
        consumer: {
          label: "Dr. Meera Patel / Eastside Specialty",
          installId: "install_b",
          verified: true,
        },
      },
      receipts: {
        total: 2,
      },
    });
  });

  it("streams new receipt events for live UI refresh", async () => {
    federationMocks.listReceipts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "receipt_deny",
          eventType: "deny",
          tenant: "stacy/acme",
          koId: "ko_demo",
          actorInstallId: "install_b",
          counterpartyInstallId: "install_a",
          payload: {},
          createdAt: "2026-05-22T00:00:02.000Z",
          receiptHash: "sha256:deny",
        },
      ]);

    const app = createApp();
    const server = app.listen(0);

    try {
      const body = await new Promise<string>((resolve, reject) => {
        const address = server.address();
        if (typeof address !== "object" || address === null) {
          reject(new Error("Missing test server address"));
          return;
        }

        const req = http.get({
          hostname: "127.0.0.1",
          port: address.port,
          path: "/api/federation/brain/ko_demo/events?pollMs=50",
        }, (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
            if (data.includes("receipt_deny")) {
              req.destroy();
              resolve(data);
            }
          });
        });
        req.on("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "ECONNRESET") return;
          reject(error);
        });
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error("Timed out waiting for SSE receipt event"));
        });
      });

      expect(body).toContain("event: ready");
      expect(body).toContain("event: receipt");
      expect(body).toContain("\"eventType\":\"deny\"");
      expect(body).toContain("\"koId\":\"ko_demo\"");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
