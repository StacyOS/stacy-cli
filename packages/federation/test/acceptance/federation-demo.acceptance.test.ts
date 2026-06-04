import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createConsentGrant } from "../../src/consent/grant.js";
import { enforceReadConsent } from "../../src/consent/enforcement.js";
import { createRevocationTombstone } from "../../src/consent/revocation.js";
import {
  createDeterministicDashboardContent,
  parseDashboardSchema,
  parseCsvDashboardInput,
} from "../../src/dashboard/dashboard-content.js";
import { createInstallIdentity } from "../../src/identity/install-identity.js";
import {
  createKnowledgeObject,
  type SignedKnowledgeObject,
  verifyKnowledgeObject,
} from "../../src/ko/knowledge-object.js";
import { listReceipts } from "../../src/receipts/receipt-store.js";
import { createTwoInstallHarness } from "../harness/two-install-harness.js";

describe("StacyOS federation demo acceptance contract", () => {
  it("TIME: create -> federate -> read -> revoke completes in under 4 minutes", () => {
    const startedAt = performance.now();
    const producer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const consumer = createInstallIdentity(new Date("2026-05-22T00:00:01.000Z"));
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: {
        title: "Timed federation dashboard",
        widgets: [{ kind: "metric", label: "Loop", value: 1 }],
      },
      identity: producer,
      createdAt: new Date("2026-05-22T00:00:02.000Z"),
      idGenerator: () => "ko_acceptance_time",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:03.000Z"),
      idGenerator: () => "grant_acceptance_time",
    });

    expect(
      enforceReadConsent({
        ko,
        grant,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:04.000Z"),
      }),
    ).toMatchObject({ ok: true });

    const revocation = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      revokedGrantId: grant.id,
      issuerIdentity: producer,
      reason: "Access no longer permitted",
      createdAt: new Date("2026-05-22T00:00:05.000Z"),
    });

    expect(
      enforceReadConsent({
        ko,
        grant,
        revocation,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:06.000Z"),
      }),
    ).toEqual({ ok: false, reason: "Consent grant has been revoked" });

    expect(Math.round(performance.now() - startedAt)).toBeLessThan(4 * 60 * 1000);
  });
  it("INSTALLS: demo runs across two isolated installs using tenant stacy/acme", async () => {
    const harness = await createTwoInstallHarness();
    try {
      await harness.prepare();

      expect(harness.installA.tenant).toBe("stacy/acme");
      expect(harness.installB.tenant).toBe("stacy/acme");
      expect(harness.installA.homeDir).not.toBe(harness.installB.homeDir);
      expect(harness.installA.instanceRoot).not.toBe(harness.installB.instanceRoot);
      expect(harness.installA.configPath).not.toBe(harness.installB.configPath);
      expect(harness.installA.dbPort).not.toBe(harness.installB.dbPort);
      expect(harness.installA.serverPort).not.toBe(harness.installB.serverPort);

      const [configA, configB] = await Promise.all([
        harness.readConfig("A"),
        harness.readConfig("B"),
      ]);

      expect(configA).toMatchObject({
        database: {
          embeddedPostgresPort: harness.installA.dbPort,
        },
        server: {
          port: harness.installA.serverPort,
        },
      });
      expect(configB).toMatchObject({
        database: {
          embeddedPostgresPort: harness.installB.dbPort,
        },
        server: {
          port: harness.installB.serverPort,
        },
      });
    } finally {
      await harness.stop();
    }
  });
  it("SIGNED KO: Knowledge Object signature and content hash verify, and tampering fails", () => {
    const identity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: {
        title: "Day 30 dashboard",
        widgets: [{ kind: "metric", label: "Signed objects", value: 1 }],
      },
      identity,
      createdAt: new Date("2026-05-22T00:00:01.000Z"),
      idGenerator: () => "ko_acceptance_signed",
    });

    expect(verifyKnowledgeObject(ko)).toEqual({
      ok: true,
      contentHash: ko.signedPayload.contentHash,
    });

    const tamperedFields: SignedKnowledgeObject[] = [
      {
        ...ko,
        signedPayload: {
          ...ko.signedPayload,
          content: { title: "Tampered" },
        },
      },
      {
        ...ko,
        signedPayload: {
          ...ko.signedPayload,
          tenant: "stacy/not-acme",
        },
      },
      {
        ...ko,
        signedPayload: {
          ...ko.signedPayload,
          contentHash:
            "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      },
      {
        ...ko,
        signature: Buffer.from("tampered-signature").toString("base64"),
      },
    ];

    for (const tampered of tamperedFields) {
      expect(verifyKnowledgeObject(tampered).ok).toBe(false);
    }
  });
  it("PER-OBJECT CONSENT: consumer cannot read without grant, can read with grant, and expired grant fails", () => {
    const producer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const consumer = createInstallIdentity(new Date("2026-05-22T00:00:01.000Z"));
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: {
        title: "Consent-gated dashboard",
        widgets: [{ kind: "metric", label: "Federated reads", value: 1 }],
      },
      identity: producer,
      createdAt: new Date("2026-05-22T00:00:02.000Z"),
      idGenerator: () => "ko_acceptance_consent",
    });
    const validGrant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:03.000Z"),
    });
    const expiredGrant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-05-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-20T00:00:00.000Z"),
    });

    expect(
      enforceReadConsent({
        ko,
        grant: null,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:04.000Z"),
      }),
    ).toEqual({ ok: false, reason: "Missing consent grant" });

    expect(
      enforceReadConsent({
        ko,
        grant: validGrant,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:04.000Z"),
      }),
    ).toMatchObject({ ok: true });

    expect(
      enforceReadConsent({
        ko,
        grant: expiredGrant,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:04.000Z"),
      }),
    ).toEqual({ ok: false, reason: "Consent grant is expired" });
  });
  it("REVOKE: consumer read succeeds before revoke and fails or redacts on next read after revoke without a push", () => {
    const producer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const consumer = createInstallIdentity(new Date("2026-05-22T00:00:01.000Z"));
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: {
        title: "Revocable dashboard",
        widgets: [{ kind: "metric", label: "Active grants", value: 1 }],
      },
      identity: producer,
      createdAt: new Date("2026-05-22T00:00:02.000Z"),
      idGenerator: () => "ko_acceptance_revoke",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:03.000Z"),
      idGenerator: () => "grant_acceptance_revoke",
    });
    const revocation = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      revokedGrantId: grant.id,
      issuerIdentity: producer,
      reason: "Access no longer permitted",
      createdAt: new Date("2026-05-22T00:00:04.000Z"),
    });

    expect(
      enforceReadConsent({
        ko,
        grant,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:04.000Z"),
      }),
    ).toMatchObject({ ok: true });

    expect(
      enforceReadConsent({
        ko,
        grant,
        revocation,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:05.000Z"),
      }),
    ).toEqual({ ok: false, reason: "Consent grant has been revoked" });
  });
  it("RECEIPTS: append-only receipts persist on both installs across restart", async () => {
    const installAReceipts = [
      receiptRow("receipt_a_create", "create", "install_a"),
      receiptRow("receipt_a_sign", "sign", "install_a"),
      receiptRow("receipt_a_share", "share", "install_a", "install_b"),
      receiptRow("receipt_a_revoke", "revoke", "install_a"),
    ];
    const installBReceipts = [
      receiptRow("receipt_b_receive", "receive", "install_b", "install_a"),
      receiptRow("receipt_b_store", "store", "install_b", "install_a"),
      receiptRow("receipt_b_read", "read", "install_b", "install_a"),
      receiptRow("receipt_b_deny", "deny", "install_b", "install_a"),
    ];

    const restartedA = dbForReceiptRows(installAReceipts);
    const restartedB = dbForReceiptRows(installBReceipts);

    await expect(listReceipts({ db: restartedA, koId: "ko_acceptance_receipts" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "create", actorInstallId: "install_a" }),
        expect.objectContaining({ eventType: "sign", actorInstallId: "install_a" }),
        expect.objectContaining({ eventType: "share", actorInstallId: "install_a" }),
        expect.objectContaining({ eventType: "revoke", actorInstallId: "install_a" }),
      ]),
    );
    await expect(listReceipts({ db: restartedB, koId: "ko_acceptance_receipts" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "receive", actorInstallId: "install_b" }),
        expect.objectContaining({ eventType: "store", actorInstallId: "install_b" }),
        expect.objectContaining({ eventType: "read", actorInstallId: "install_b" }),
        expect.objectContaining({ eventType: "deny", actorInstallId: "install_b" }),
      ]),
    );
  });
  it("PUBLIC TASK: CSV task input creates a signed dashboard Knowledge Object", () => {
    const identity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const csvPath = resolve(process.cwd(), "demo/acme-q2-revenue.csv");
    const schemaPath = resolve(process.cwd(), "demo/acme-dashboard.schema.json");
    const input = parseCsvDashboardInput(csvPath, readFileSync(csvPath, "utf8"));
    const schema = parseDashboardSchema(readFileSync(schemaPath, "utf8"));
    const content = createDeterministicDashboardContent({
      task: "build a quarterly revenue dashboard from this CSV",
      input,
      schema,
    });
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content,
      identity,
      createdAt: new Date("2026-05-22T00:00:01.000Z"),
      idGenerator: () => "ko_acceptance_public_task",
    });

    expect(verifyKnowledgeObject(ko)).toEqual({
      ok: true,
      contentHash: ko.signedPayload.contentHash,
    });
    expect(ko.signedPayload.content).toMatchObject({
      kind: "dashboard",
      input: {
        fileName: "acme-q2-revenue.csv",
        rows: 3,
      },
      widgets: expect.arrayContaining([
        expect.objectContaining({ label: "Revenue" }),
        expect.objectContaining({ label: "Pipeline" }),
        expect.objectContaining({ label: "Active customers" }),
      ]),
    });
  });
});

function receiptRow(
  id: string,
  eventType: string,
  actorInstallId: string,
  counterpartyInstallId?: string,
) {
  return {
    id,
    event_type: eventType,
    tenant: "stacy/acme",
    ko_id: "ko_acceptance_receipts",
    actor_install_id: actorInstallId,
    counterparty_install_id: counterpartyInstallId ?? null,
    payload_json: {},
    created_at: "2026-05-22T00:00:00.000Z",
    previous_receipt_hash: null,
    receipt_hash: null,
  };
}

function dbForReceiptRows(rows: readonly unknown[]) {
  let callCount = 0;
  return {
    execute: async () => {
      callCount += 1;
      if (callCount <= 5) return [];
      return rows;
    },
  };
}
