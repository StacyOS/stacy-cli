import { describe, expect, it } from "vitest";

import type { BrainDb } from "../brain/brain-store.js";
import { createInstallIdentity } from "../identity/install-identity.js";
import { createRevocationTombstone } from "../consent/revocation.js";
import { lookupRevocationHttp, syncRevocationFromProducer } from "./revocation-lookup.js";

describe("revocation lookup", () => {
  it("returns the producer tombstone for HTTP lookup", async () => {
    const issuer = createInstallIdentity();
    const tombstone = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: "ko_1",
      koContentHash: "sha256:abc",
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

    await expect(lookupRevocationHttp({ db, koId: "ko_1" })).resolves.toEqual({
      revoked: true,
      tombstone,
    });
  });

  it("pulls and stores a producer tombstone from the remembered source URL", async () => {
    const issuer = createInstallIdentity();
    const tombstone = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: "ko_1",
      koContentHash: "sha256:abc",
      issuerIdentity: issuer,
      reason: "Access no longer permitted",
      idGenerator: () => "revoke_1",
    });
    const requestedUrls: string[] = [];
    const db = dbForRows([
      [],
      [
        {
          ko_id: "ko_1",
          producer_install_id: issuer.record.installId,
          lookup_url: "http://127.0.0.1:3100/api/federation/revocations",
        },
      ],
      [],
      [],
      [],
      [],
    ]);

    await expect(
      syncRevocationFromProducer({
        db,
        koId: "ko_1",
        fetch: async (url) => {
          requestedUrls.push(url);
          return {
            ok: true,
            status: 200,
            json: async () => ({ revoked: true, tombstone }),
            text: async () => "",
          };
        },
      }),
    ).resolves.toEqual(tombstone);

    expect(requestedUrls[0]).toBe("http://127.0.0.1:3100/api/federation/revocations?koId=ko_1");
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
  };
}
