import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "../identity/install-identity.js";
import { createKnowledgeObject } from "../ko/knowledge-object.js";
import { createConsentGrant } from "./grant.js";
import { enforceReadConsent } from "./enforcement.js";
import { createRevocationTombstone } from "./revocation.js";
import {
  createWitnessedRevocation,
  enforceWitnessRevocationPolicy,
  verifyWitnessedRevocation,
  witnessIdFromPublicKey,
  type SignedWitnessedRevocation,
} from "./witnessed-revocation.js";
import { storeWitnessedRevocation } from "./witnessed-revocation-store.js";

describe("witnessed revocation", () => {
  it("accepts a witnessed revoke when policy threshold is satisfied", () => {
    const fixture = createFixture();
    const witnessed = createWitnessedRevocation({
      tombstone: fixture.tombstone,
      witnessIdentity: fixture.witness,
      witnessLabel: "Northstar Revocation Witness",
      witnessedAt: new Date("2026-05-23T00:00:01.000Z"),
    });

    expect(verifyWitnessedRevocation(witnessed, fixture.tombstone)).toMatchObject({ ok: true });
    expect(
      enforceWitnessRevocationPolicy({
        tombstone: fixture.tombstone,
        witnesses: [witnessed],
        policy: { mode: "witnessed", requiredWitnesses: 1 },
      }),
    ).toEqual({ ok: true, validWitnesses: 1 });
    expect(
      enforceReadConsent({
        ko: fixture.ko,
        grant: fixture.grant,
        revocation: fixture.tombstone,
        witnessedRevocations: [witnessed],
        revocationPolicy: { mode: "witnessed", requiredWitnesses: 1 },
        consumerInstallId: fixture.consumer.record.installId,
      }),
    ).toEqual({ ok: false, reason: "Consent grant has been revoked" });
  });

  it("does not treat an unwitnessed tombstone as revoked under witnessed policy", () => {
    const fixture = createFixture();

    expect(
      enforceReadConsent({
        ko: fixture.ko,
        grant: fixture.grant,
        revocation: fixture.tombstone,
        witnessedRevocations: [],
        revocationPolicy: { mode: "witnessed", requiredWitnesses: 2 },
        consumerInstallId: fixture.consumer.record.installId,
      }),
    ).toEqual({
      ok: false,
      reason: "Witness policy requires 2 valid witness(es); found 0",
    });
  });

  it("rejects a forged witness signature", () => {
    const fixture = createFixture();
    const witnessed = createWitnessedRevocation({
      tombstone: fixture.tombstone,
      witnessIdentity: fixture.witness,
      witnessLabel: "Northstar Revocation Witness",
    });
    const forged: SignedWitnessedRevocation = {
      ...witnessed,
      signature: "not-valid-base64",
    };

    expect(verifyWitnessedRevocation(forged, fixture.tombstone)).toEqual({
      ok: false,
      reason: "Witnessed revocation signature verification failed",
    });
    expect(
      enforceWitnessRevocationPolicy({
        tombstone: fixture.tombstone,
        witnesses: [forged],
        policy: { mode: "witnessed", requiredWitnesses: 1 },
      }),
    ).toEqual({
      ok: false,
      reason: "Witness policy requires 1 valid witness(es); found 0",
      validWitnesses: 0,
    });
  });

  it("honors trusted witness allowlists", () => {
    const fixture = createFixture();
    const witnessed = createWitnessedRevocation({
      tombstone: fixture.tombstone,
      witnessIdentity: fixture.witness,
      witnessLabel: "Northstar Revocation Witness",
    });
    const otherWitness = createInstallIdentity();

    expect(
      enforceWitnessRevocationPolicy({
        tombstone: fixture.tombstone,
        witnesses: [witnessed],
        policy: {
          mode: "witnessed",
          requiredWitnesses: 1,
          trustedWitnessIds: [witnessIdFromPublicKey(otherWitness.record.publicKeyPem)],
        },
      }),
    ).toMatchObject({
      ok: false,
      validWitnesses: 0,
    });
  });

  it("refuses to store a forged witnessed revocation", async () => {
    const fixture = createFixture();
    const witnessed = createWitnessedRevocation({
      tombstone: fixture.tombstone,
      witnessIdentity: fixture.witness,
      witnessLabel: "Northstar Revocation Witness",
    });
    const forged = { ...witnessed, signature: "forged" };

    await expect(
      storeWitnessedRevocation({
        db: { execute: async () => [] },
        witnessed: forged,
        tombstone: fixture.tombstone,
      }),
    ).rejects.toThrow("Cannot store invalid witnessed revocation");
  });
});

function createFixture() {
  const producer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
  const consumer = createInstallIdentity(new Date("2026-05-22T00:00:01.000Z"));
  const witness = createInstallIdentity(new Date("2026-05-22T00:00:02.000Z"));
  const ko = createKnowledgeObject({
    tenant: "stacy/acme",
    contentType: "application/json",
    content: { title: "Referral Packet" },
    identity: producer,
    idGenerator: () => "ko_referral_packet",
    createdAt: new Date("2026-05-22T00:01:00.000Z"),
  });
  const grant = createConsentGrant({
    tenant: "stacy/acme",
    koId: ko.id,
    koContentHash: ko.signedPayload.contentHash,
    producerIdentity: producer,
    consumerInstallId: consumer.record.installId,
    scope: "read",
    expiresAt: new Date("2026-06-22T00:00:00.000Z"),
    revocable: true,
    createdAt: new Date("2026-05-22T00:02:00.000Z"),
    idGenerator: () => "grant_referral_read",
  });
  const tombstone = createRevocationTombstone({
    tenant: "stacy/acme",
    koId: ko.id,
    koContentHash: ko.signedPayload.contentHash,
    issuerIdentity: producer,
    reason: "Patient withdrew consent",
    createdAt: new Date("2026-05-23T00:00:00.000Z"),
    idGenerator: () => "revoke_referral",
  });

  return { producer, consumer, witness, ko, grant, tombstone };
}
