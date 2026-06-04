import { describe, expect, it } from "vitest";

import type { BrainDb } from "../brain/brain-store.js";
import { createInstallIdentity } from "../identity/install-identity.js";
import { createKnowledgeObject } from "../ko/knowledge-object.js";
import {
  createMemoryFederationReplayGuard,
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
      nonce: expect.any(String),
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

  it("can create a signed federation message with a Phase R write-scope grant", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Share for derived work" },
      identity: producer,
      idGenerator: () => "ko_write_share",
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
      scope: "write",
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    });

    expect(message.grant.signedPayload.scope).toBe("write");
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
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    });
    const consumerDb = dbForRows([[], [], [], [], [], []]);

    await expect(
      receiveFederationMessage({
        db: consumerDb,
        message,
        receivedAt: new Date("2026-05-22T00:00:00.000Z"),
        replayGuard: createMemoryFederationReplayGuard(),
      }),
    ).resolves.toMatchObject({
      koId: ko.id,
      grantId: message.grant.id,
      contentHash: ko.signedPayload.contentHash,
    });
  });

  it("rejects stale federation messages before storage", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Too old" },
      identity: producer,
      idGenerator: () => "ko_stale_message",
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
      receiveFederationMessage({
        db: failOnExecuteDb(),
        message,
        receivedAt: new Date("2026-05-22T00:02:00.000Z"),
        replayGuard: createMemoryFederationReplayGuard(),
      }),
    ).rejects.toThrow("outside the replay window");
  });

  it("rejects replayed federation message nonces before storage", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Replay me once" },
      identity: producer,
      idGenerator: () => "ko_replay_message",
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
      nonce: "nonce_replay_test",
    });
    const replayGuard = createMemoryFederationReplayGuard();

    await expect(
      receiveFederationMessage({
        db: dbForRows([[], [], [], [], []]),
        message,
        receivedAt: new Date("2026-05-22T00:00:01.000Z"),
        replayGuard,
      }),
    ).resolves.toMatchObject({ koId: ko.id });
    await expect(
      receiveFederationMessage({
        db: failOnExecuteDb(),
        message,
        receivedAt: new Date("2026-05-22T00:00:02.000Z"),
        replayGuard,
      }),
    ).rejects.toThrow("replay detected");
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
        replayGuard: createMemoryFederationReplayGuard(),
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

function failOnExecuteDb(): BrainDb {
  return {
    execute: async () => {
      throw new Error("Storage should not be touched");
    },
  };
}
