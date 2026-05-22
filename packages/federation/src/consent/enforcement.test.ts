import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "../identity/install-identity.js";
import { createKnowledgeObject } from "../ko/knowledge-object.js";
import { createConsentGrant } from "./grant.js";
import { enforceReadConsent } from "./enforcement.js";
import { createRevocationTombstone } from "./revocation.js";

describe("read-time consent enforcement", () => {
  it("denies federated read without a grant", () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Private" },
      identity: producer,
    });

    expect(
      enforceReadConsent({
        ko,
        grant: null,
        consumerInstallId: consumer.record.installId,
      }),
    ).toEqual({ ok: false, reason: "Missing consent grant" });
  });

  it("allows read with a valid unexpired matching grant", () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Private" },
      identity: producer,
      idGenerator: () => "ko_private",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "grant_private",
    });

    expect(
      enforceReadConsent({
        ko,
        grant,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).toEqual({ ok: true, grantId: "grant_private" });
  });

  type GrantOverride = {
    readonly tenant?: string;
    readonly koId?: string;
    readonly koContentHash?: string;
    readonly consumerInstallId?: string;
    readonly expiresAt?: Date;
  };

  it.each<[string, GrantOverride, string]>([
    ["expired", { expiresAt: new Date("2026-05-21T00:00:00.000Z") }, "Consent grant is expired"],
    ["wrong consumer", { consumerInstallId: "install_wrong" }, "Consent grant consumer does not match this install"],
    ["wrong KO id", { koId: "ko_wrong" }, "Consent grant KO id does not match"],
    ["wrong KO hash", { koContentHash: "sha256:wrong" }, "Consent grant KO hash does not match"],
    ["wrong tenant", { tenant: "stacy/other" }, "Consent grant tenant does not match KO"],
  ])("denies read for %s grant", (_label, overrides, reason) => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Private" },
      identity: producer,
      idGenerator: () => "ko_private",
    });
    const grant = createConsentGrant({
      tenant: typeof overrides.tenant === "string" ? overrides.tenant : "stacy/acme",
      koId: typeof overrides.koId === "string" ? overrides.koId : ko.id,
      koContentHash: typeof overrides.koContentHash === "string" ? overrides.koContentHash : ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId:
        typeof overrides.consumerInstallId === "string"
          ? overrides.consumerInstallId
          : consumer.record.installId,
      expiresAt:
        overrides.expiresAt instanceof Date
          ? overrides.expiresAt
          : new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
    });

    expect(
      enforceReadConsent({
        ko,
        grant,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).toEqual({ ok: false, reason });
  });

  it("denies read when a matching valid tombstone exists", () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Private" },
      identity: producer,
      idGenerator: () => "ko_private",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      idGenerator: () => "grant_private",
    });
    const revocation = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      revokedGrantId: grant.id,
      issuerIdentity: producer,
      reason: "Access no longer permitted",
    });

    expect(
      enforceReadConsent({
        ko,
        grant,
        revocation,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).toEqual({ ok: false, reason: "Consent grant has been revoked" });
  });

  it("rejects tombstones from the wrong issuer", () => {
    const producer = createInstallIdentity();
    const attacker = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Private" },
      identity: producer,
      idGenerator: () => "ko_private",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      idGenerator: () => "grant_private",
    });
    const revocation = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      revokedGrantId: grant.id,
      issuerIdentity: attacker,
      reason: "Forged revoke",
    });

    expect(
      enforceReadConsent({
        ko,
        grant,
        revocation,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).toEqual({ ok: false, reason: "Revocation tombstone issuer does not match grant producer" });
  });
});
