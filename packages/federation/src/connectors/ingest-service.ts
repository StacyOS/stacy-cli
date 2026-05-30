import { createLocalKnowledgeObject } from "../brain/local-brain.js";
import type { BrainDb } from "../brain/brain-store.js";
import { appendReceipt } from "../receipts/receipt-store.js";
import type { SignedKnowledgeObject } from "../ko/knowledge-object.js";
import type { NormalizedObject } from "./types.js";

export interface StoreIngestedObjectOptions {
  readonly db: BrainDb;
  readonly identityPath: string;
  readonly object: NormalizedObject;
  readonly tenant?: string;
  readonly createdAt?: Date;
  readonly storedAt?: Date;
  readonly idGenerator?: () => string;
}

export interface StoreIngestedObjectResult {
  readonly ko: SignedKnowledgeObject;
  readonly contentHash: string;
  readonly kind: string;
  readonly sourceId: string;
}

/**
 * Persists one connector-normalized object as a signed Knowledge Object and
 * records the full receipt set for it: `create` + `sign` (from the local Brain
 * write) plus `ingest` + `normalize` capturing connector provenance.
 */
export async function storeIngestedObject(
  options: StoreIngestedObjectOptions,
): Promise<StoreIngestedObjectResult> {
  const created = await createLocalKnowledgeObject({
    db: options.db,
    identityPath: options.identityPath,
    tenant: options.tenant,
    contentType: options.object.contentType,
    content: options.object.content,
    createdAt: options.createdAt,
    storedAt: options.storedAt,
    idGenerator: options.idGenerator,
  });

  const provenance = options.object.provenance;
  const receiptAt = options.storedAt ?? options.createdAt;

  await appendReceipt({
    db: options.db,
    eventType: "ingest",
    tenant: created.ko.signedPayload.tenant,
    koId: created.ko.id,
    actorInstallId: created.creatorInstallId,
    payload: {
      connectorId: provenance.connectorId,
      connectorVersion: provenance.connectorVersion,
      sourceId: provenance.sourceId,
      sourceUrl: provenance.sourceUrl,
      sourceTimestamp: provenance.sourceTimestamp,
      ingestCommand: provenance.ingestCommand,
    },
    createdAt: receiptAt,
  });

  await appendReceipt({
    db: options.db,
    eventType: "normalize",
    tenant: created.ko.signedPayload.tenant,
    koId: created.ko.id,
    actorInstallId: created.creatorInstallId,
    payload: {
      kind: options.object.kind,
      connectorVersion: provenance.connectorVersion,
      contentHash: created.contentHash,
    },
    createdAt: receiptAt,
  });

  return {
    ko: created.ko,
    contentHash: created.contentHash,
    kind: options.object.kind,
    sourceId: provenance.sourceId,
  };
}
