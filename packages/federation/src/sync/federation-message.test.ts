import { describe, expect, it } from "vitest";

import type { BrainDb } from "../brain/brain-store.js";
import { createInstallIdentity } from "../identity/install-identity.js";
import { createKnowledgeObject } from "../ko/knowledge-object.js";
import {
  createFederationMessage,
  receiveFederationMessage,
  verifyFederationMessageSignature,
} from "./federation-message.js";

describe("federation KO messages", () => {
  it("creates a KO+grant message from a local KO and stores the producer grant", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Share me" },
      identity: producer,
      idGenerator: () => "ko_share",
    });
    const db = dbForRows([
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
      db,
      koId: ko.id,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    });

    expect(message).toMatchObject({
      kind: "federation_ko_message",
      tenant: "stacy/acme",
      producerInstallId: producer.record.installId,
      consumerInstallId: consumer.record.installId,
      ko,
      sender: {
        installId: producer.record.installId,
      },
      grant: {
        signedPayload: {
          koId: ko.id,
          consumerInstallId: consumer.record.installId,
        },
      },
    });
    expect(verifyFederationMessageSignature(message)).toBe(true);
  });

  it("receives a KO+grant message as federated state", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Share me" },
      identity: producer,
      idGenerator: () => "ko_receive",
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
    });
    const consumerDb = dbForRows([[], [], [], [], [], []]);

    await expect(
      receiveFederationMessage({
        db: consumerDb,
        message,
        receivedAt: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      koId: ko.id,
      grantId: message.grant.id,
      contentHash: ko.signedPayload.contentHash,
    });
  });

  it("rejects a tampered federation message envelope", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const wrongConsumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Share me" },
      identity: producer,
      idGenerator: () => "ko_wrong_consumer",
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
    });

    await expect(
      receiveFederationMessage({
        db: dbForRows([]),
        message: {
          ...message,
          consumerInstallId: wrongConsumer.record.installId,
        },
      }),
    ).rejects.toThrow("signature verification failed");
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
  };
}
