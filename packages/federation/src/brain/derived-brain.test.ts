import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BrainDb } from "./brain-store.js";
import { createDerivedKnowledgeObject, DERIVED_KO_CONTENT_TYPE } from "./derived-brain.js";
import { createConsentGrant } from "../consent/grant.js";
import { createRevocationTombstone } from "../consent/revocation.js";
import { createInstallIdentity } from "../identity/install-identity.js";
import { createKnowledgeObject, type SignedKnowledgeObject } from "../ko/knowledge-object.js";

const tempRoots: string[] = [];

describe("derived Brain KO creation", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it("creates a local consumer-signed derived KO from a federated source with write consent", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-derived-brain-"));
    tempRoots.push(root);
    const producer = createInstallIdentity();
    const sourceConsumer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const sourceKo = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Source" },
      identity: producer,
      idGenerator: () => "ko_source",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: sourceKo.id,
      koContentHash: sourceKo.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: sourceConsumer.record.installId,
      scope: "write",
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "grant_write",
    });
    const db = dbForRows([
      koRow(sourceKo, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [{ id: grant.id, signed_payload_json: grant.signedPayload, signer_json: grant.signer, signature: grant.signature }],
      [],
    ]);
    const identityPath = join(root, "identity.json");
    await writeIdentity(identityPath, sourceConsumer);

    const result = await createDerivedKnowledgeObject({
      db,
      identityPath,
      sourceKoId: sourceKo.id,
      derivedContent: { note: "Consumer analysis" },
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "ko_derived",
    });

    expect(result).toMatchObject({
      sourceKoId: "ko_source",
      sourceContentHash: sourceKo.signedPayload.contentHash,
      sourceProducerInstallId: producer.record.installId,
      grantId: "grant_write",
      ko: {
        id: "ko_derived",
        signedPayload: {
          contentType: DERIVED_KO_CONTENT_TYPE,
          creatorInstallId: sourceConsumer.record.installId,
          content: {
            kind: "derived_knowledge_object",
            source: {
              koId: "ko_source",
              koContentHash: sourceKo.signedPayload.contentHash,
              producerInstallId: producer.record.installId,
              grantId: "grant_write",
              grantScope: "write",
            },
            derivedContent: { note: "Consumer analysis" },
          },
        },
      },
    });
    expect(result.ko.signedPayload.contentHash).not.toBe(sourceKo.signedPayload.contentHash);
  });

  it("rejects derived writes when the grant is read-only", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-derived-brain-"));
    tempRoots.push(root);
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const sourceKo = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Source" },
      identity: producer,
      idGenerator: () => "ko_source",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: sourceKo.id,
      koContentHash: sourceKo.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      scope: "read",
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
    });
    const db = dbForRows([
      koRow(sourceKo, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [{ id: grant.id, signed_payload_json: grant.signedPayload, signer_json: grant.signer, signature: grant.signature }],
      [],
    ]);
    const identityPath = join(root, "identity.json");
    await writeIdentity(identityPath, consumer);

    await expect(
      createDerivedKnowledgeObject({
        db,
        identityPath,
        sourceKoId: sourceKo.id,
        derivedContent: { note: "Nope" },
        createdAt: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).rejects.toThrow("Consent grant does not include write scope");
  });

  it("rejects future derived writes after the producer revokes the source grant", async () => {
    const root = await mkdtemp(join(tmpdir(), "stacy-federation-derived-brain-"));
    tempRoots.push(root);
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const sourceKo = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Source" },
      identity: producer,
      idGenerator: () => "ko_source",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: sourceKo.id,
      koContentHash: sourceKo.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      scope: "write",
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      idGenerator: () => "grant_write_revoked",
    });
    const revocation = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: sourceKo.id,
      koContentHash: sourceKo.signedPayload.contentHash,
      revokedGrantId: grant.id,
      issuerIdentity: producer,
      reason: "Stop derived writes",
    });
    const db = dbForRows([
      koRow(sourceKo, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [{ id: grant.id, signed_payload_json: grant.signedPayload, signer_json: grant.signer, signature: grant.signature }],
      [],
      [],
      [{ id: revocation.id, signed_payload_json: revocation.signedPayload, signer_json: revocation.signer, signature: revocation.signature }],
    ]);
    const identityPath = join(root, "identity.json");
    await writeIdentity(identityPath, consumer);

    await expect(
      createDerivedKnowledgeObject({
        db,
        identityPath,
        sourceKoId: sourceKo.id,
        derivedContent: { note: "No longer allowed" },
        createdAt: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).rejects.toThrow("Consent grant has been revoked");
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
  };
}

async function writeIdentity(path: string, identity: ReturnType<typeof createInstallIdentity>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(identity.record), { mode: 0o600 });
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
