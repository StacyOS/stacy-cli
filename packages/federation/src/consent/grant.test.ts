import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "../identity/install-identity.js";
import {
  CONSENT_GRANT_SCOPES,
  consentGrantScopeIncludesRead,
  createConsentGrant,
  isConsentGrantScope,
  type SignedConsentGrant,
  verifyConsentGrant,
} from "./grant.js";

describe("signed consent grants", () => {
  it("creates a signed read grant that verifies", () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: "ko_123",
      koContentHash: "sha256:abc",
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "grant_test",
    });

    expect(grant.id).toBe("grant_test");
    expect(grant.signedPayload).toMatchObject({
      kind: "consent_grant",
      tenant: "stacy/acme",
      koId: "ko_123",
      koContentHash: "sha256:abc",
      producerInstallId: producer.record.installId,
      consumerInstallId: consumer.record.installId,
      scope: "read",
      revocable: true,
    });
    expect(verifyConsentGrant(grant)).toEqual({
      ok: true,
      grantHash: grant.signedPayload.grantHash,
    });
  });

  it.each(CONSENT_GRANT_SCOPES)("creates and verifies a signed %s grant", (scope) => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: "ko_123",
      koContentHash: "sha256:abc",
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      scope,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    });

    expect(grant.signedPayload.scope).toBe(scope);
    expect(verifyConsentGrant(grant)).toEqual({
      ok: true,
      grantHash: grant.signedPayload.grantHash,
    });
  });

  it("defines the Phase R scope vocabulary and read-capability lattice", () => {
    expect(CONSENT_GRANT_SCOPES).toEqual(["read", "write", "admin"]);
    expect(isConsentGrantScope("read")).toBe(true);
    expect(isConsentGrantScope("write")).toBe(true);
    expect(isConsentGrantScope("admin")).toBe(true);
    expect(isConsentGrantScope("owner")).toBe(false);
    expect(CONSENT_GRANT_SCOPES.every((scope) => consentGrantScopeIncludesRead(scope))).toBe(true);
  });

  it.each([
    [
      "scope",
      (grant: SignedConsentGrant): SignedConsentGrant => ({
        ...grant,
        signedPayload: { ...grant.signedPayload, scope: "owner" as "read" },
      }),
    ],
    [
      "expiry",
      (grant: SignedConsentGrant): SignedConsentGrant => ({
        ...grant,
        signedPayload: {
          ...grant.signedPayload,
          expiresAt: "2027-06-21T00:00:00.000Z",
        },
      }),
    ],
    [
      "recipient",
      (grant: SignedConsentGrant): SignedConsentGrant => ({
        ...grant,
        signedPayload: {
          ...grant.signedPayload,
          consumerInstallId: "install_wrong",
        },
      }),
    ],
    [
      "KO hash",
      (grant: SignedConsentGrant): SignedConsentGrant => ({
        ...grant,
        signedPayload: {
          ...grant.signedPayload,
          koContentHash: "sha256:wrong",
        },
      }),
    ],
    [
      "signature",
      (grant: SignedConsentGrant): SignedConsentGrant => ({
        ...grant,
        signature: Buffer.from("not the real signature").toString("base64"),
      }),
    ],
  ])("rejects tampered %s", (_label, mutate) => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: "ko_123",
      koContentHash: "sha256:abc",
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
    });

    expect(verifyConsentGrant(mutate(grant)).ok).toBe(false);
  });

  it("rejects forged signer metadata", () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const wrongProducer = createInstallIdentity();
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: "ko_123",
      koContentHash: "sha256:abc",
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
    });

    expect(
      verifyConsentGrant({
        ...grant,
        signer: {
          installId: wrongProducer.record.installId,
          publicKeyPem: wrongProducer.record.publicKeyPem,
        },
      }),
    ).toEqual({
      ok: false,
      reason: "Signer install does not match producer install",
    });
  });
});
