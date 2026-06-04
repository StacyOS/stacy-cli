import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "../identity/install-identity.js";
import { createRevocationTombstone, verifyRevocationTombstone } from "./revocation.js";

describe("signed revocation tombstones", () => {
  it("creates and verifies a signed tombstone", () => {
    const issuer = createInstallIdentity();
    const tombstone = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: "ko_1",
      koContentHash: "sha256:abc",
      revokedGrantId: "grant_1",
      issuerIdentity: issuer,
      reason: "Access no longer permitted",
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "revoke_1",
    });

    expect(tombstone).toMatchObject({
      id: "revoke_1",
      signedPayload: {
        kind: "revocation_tombstone",
        tenant: "stacy/acme",
        koId: "ko_1",
        koContentHash: "sha256:abc",
        revokedGrantId: "grant_1",
        issuerInstallId: issuer.record.installId,
        reason: "Access no longer permitted",
      },
      signer: {
        installId: issuer.record.installId,
      },
    });
    expect(verifyRevocationTombstone(tombstone)).toEqual({
      ok: true,
      tombstoneHash: tombstone.signedPayload.tombstoneHash,
    });
  });

  it.each([
    ["reason", { reason: "Tampered reason" }],
    ["KO id", { koId: "ko_wrong" }],
    ["KO hash", { koContentHash: "sha256:wrong" }],
    ["issuer", { issuerInstallId: "install_wrong" }],
  ])("rejects tampered %s", (_label, payloadOverride) => {
    const issuer = createInstallIdentity();
    const tombstone = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: "ko_1",
      koContentHash: "sha256:abc",
      revokedGrantId: "grant_1",
      issuerIdentity: issuer,
      reason: "Access no longer permitted",
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    });

    expect(
      verifyRevocationTombstone({
        ...tombstone,
        signedPayload: {
          ...tombstone.signedPayload,
          ...payloadOverride,
        },
      }).ok,
    ).toBe(false);
  });

  it("rejects forged signatures", () => {
    const issuer = createInstallIdentity();
    const tombstone = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: "ko_1",
      koContentHash: "sha256:abc",
      issuerIdentity: issuer,
      reason: "Access no longer permitted",
    });

    expect(
      verifyRevocationTombstone({
        ...tombstone,
        signature: Buffer.from("forged").toString("base64"),
      }).ok,
    ).toBe(false);
  });

  it("requires a non-empty reason", () => {
    const issuer = createInstallIdentity();

    expect(() =>
      createRevocationTombstone({
        tenant: "stacy/acme",
        koId: "ko_1",
        koContentHash: "sha256:abc",
        issuerIdentity: issuer,
        reason: " ",
      }),
    ).toThrow("reason is required");
  });
});
