import { describe, expect, it } from "vitest";

import type { BrainDb } from "../brain/brain-store.js";
import { createInstallIdentity } from "../identity/install-identity.js";
import { createKnowledgeObject } from "../ko/knowledge-object.js";
import { createFederationMessage } from "./federation-message.js";
import { receiveFederationHttpMessage } from "./federation-receive.js";

describe("receiveFederationHttpMessage", () => {
  it("accepts a signed federation message body and stores the KO+grant", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Receive me" },
      identity: producer,
      idGenerator: () => "ko_http_receive",
    });
    const producerDb = dbForRows([
      [
        {
          id: ko.id,
          signed_payload_json: ko.signedPayload,
          signer_json: ko.signer,
          signature: ko.signature,
          provenance_json: {
            source: "local",
            creatorInstallId: producer.record.installId,
            storedAt: "2026-05-22T00:00:00.000Z",
          },
        },
      ],
      [],
      [],
    ]);
    const message = await createFederationMessage({
      db: producerDb,
      koId: ko.id,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    });

    await expect(
      receiveFederationHttpMessage({
        db: dbForRows([[], [], [], [], [], []]),
        body: { message },
        receivedAt: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      accepted: true,
      koId: ko.id,
      grantId: message.grant.id,
      producerInstallId: producer.record.installId,
      consumerInstallId: consumer.record.installId,
    });
  });

  it("rejects malformed request bodies before storage", async () => {
    await expect(
      receiveFederationHttpMessage({
        db: dbForRows([]),
        body: { nope: true },
      }),
    ).rejects.toThrow("wrong kind");
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
  };
}
