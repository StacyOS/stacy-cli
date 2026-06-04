import { describe, expect, it } from "vitest";

import type { BrainDb } from "../brain/brain-store.js";
import { createInstallIdentity } from "../identity/install-identity.js";
import { createRevocationTombstone } from "./revocation.js";
import { readRevocationTombstone, storeRevocationTombstone } from "./revocation-store.js";

describe("revocation tombstone store", () => {
  it("stores a valid tombstone", async () => {
    const issuer = createInstallIdentity();
    const tombstone = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: "ko_1",
      koContentHash: "sha256:abc",
      revokedGrantId: "grant_1",
      issuerIdentity: issuer,
      reason: "Access no longer permitted",
      idGenerator: () => "revoke_1",
    });
    const db = dbForRows([[], [], []]);

    await expect(storeRevocationTombstone({ db, tombstone })).resolves.toMatchObject({
      id: "revoke_1",
      tombstoneHash: tombstone.signedPayload.tombstoneHash,
    });
  });

  it("reads the latest matching tombstone", async () => {
    const issuer = createInstallIdentity();
    const tombstone = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: "ko_1",
      koContentHash: "sha256:abc",
      revokedGrantId: "grant_1",
      issuerIdentity: issuer,
      reason: "Access no longer permitted",
      idGenerator: () => "revoke_1",
    });
    const db = dbForRows([
      [],
      [],
      [
        {
          id: tombstone.id,
          signed_payload_json: tombstone.signedPayload,
          signer_json: tombstone.signer,
          signature: tombstone.signature,
        },
      ],
    ]);

    await expect(readRevocationTombstone({ db, koId: "ko_1", grantId: "grant_1" })).resolves.toEqual(tombstone);
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
  };
}
