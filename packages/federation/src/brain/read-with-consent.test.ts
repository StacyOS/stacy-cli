import { describe, expect, it } from "vitest";

import type { BrainDb } from "./brain-store.js";
import { readKnowledgeObjectWithConsent } from "./read-with-consent.js";
import { createConsentGrant } from "../consent/grant.js";
import { createRevocationTombstone } from "../consent/revocation.js";
import { createInstallIdentity } from "../identity/install-identity.js";
import { createKnowledgeObject, type SignedKnowledgeObject } from "../ko/knowledge-object.js";

describe("Brain read-time consent enforcement", () => {
  it("allows local reads without a consent grant", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Local" },
      identity: producer,
      idGenerator: () => "ko_local",
    });
    const db = dbForRows([
      koRow(ko, {
        source: "local",
        creatorInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
      }),
    ).resolves.toMatchObject({ ok: true, ko });
  });

  it("denies federated reads without a grant", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Federated" },
      identity: producer,
      idGenerator: () => "ko_federated",
    });
    const db = dbForRows([
      koRow(ko, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [],
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
      }),
    ).resolves.toEqual({ ok: false, reason: "Missing consent grant" });
  });

  it("allows federated reads with a valid grant", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Federated" },
      identity: producer,
      idGenerator: () => "ko_federated",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
    });
    const db = dbForRows([
      koRow(ko, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [
        {
          id: grant.id,
          signed_payload_json: grant.signedPayload,
          signer_json: grant.signer,
          signature: grant.signature,
        },
      ],
      [],
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ ok: true, ko });
  });

  it("denies federated reads with an expired grant", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Federated" },
      identity: producer,
      idGenerator: () => "ko_federated",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-05-21T00:00:00.000Z"),
      revocable: true,
    });
    const db = dbForRows([
      koRow(ko, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [
        {
          id: grant.id,
          signed_payload_json: grant.signedPayload,
          signer_json: grant.signer,
          signature: grant.signature,
        },
      ],
      [],
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, reason: "Consent grant is expired" });
  });

  it("denies federated reads when a matching revocation tombstone exists", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Federated" },
      identity: producer,
      idGenerator: () => "ko_federated_revoked",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      idGenerator: () => "grant_federated_revoked",
    });
    const revocation = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      revokedGrantId: grant.id,
      issuerIdentity: producer,
      reason: "Access no longer permitted",
    });
    const db = dbForRows([
      koRow(ko, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [
        {
          id: grant.id,
          signed_payload_json: grant.signedPayload,
          signer_json: grant.signer,
          signature: grant.signature,
        },
      ],
      [],
      [],
      [
        {
          id: revocation.id,
          signed_payload_json: revocation.signedPayload,
          signer_json: revocation.signer,
          signature: revocation.signature,
        },
      ],
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, reason: "Consent grant has been revoked" });
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
  };
}

function koRow(ko: SignedKnowledgeObject, provenance: Record<string, unknown>) {
  return [
    {
      id: ko.id,
      signed_payload_json: ko.signedPayload,
      signer_json: ko.signer,
      signature: ko.signature,
      provenance_json: provenance,
    },
  ];
}
