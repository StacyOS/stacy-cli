import type { CanonicalJsonValue } from "../crypto/canonical.js";
import { ensureInstallIdentity } from "../identity/install-identity.js";
import {
  createKnowledgeObject,
  type SignedKnowledgeObject,
} from "../ko/knowledge-object.js";
import {
  storeKnowledgeObject,
  type BrainDb,
  type StoreKnowledgeObjectOptions,
} from "./brain-store.js";
import { appendReceipt } from "../receipts/receipt-store.js";

export interface CreateLocalKnowledgeObjectOptions {
  readonly db: BrainDb;
  readonly identityPath: string;
  readonly tenant?: string;
  readonly contentType: string;
  readonly content: CanonicalJsonValue;
  readonly createdAt?: Date;
  readonly storedAt?: Date;
  readonly idGenerator?: () => string;
}

export interface CreateLocalKnowledgeObjectResult {
  readonly ko: SignedKnowledgeObject;
  readonly contentHash: string;
  readonly creatorInstallId: string;
}

export async function createLocalKnowledgeObject(
  options: CreateLocalKnowledgeObjectOptions,
): Promise<CreateLocalKnowledgeObjectResult> {
  const identity = await ensureInstallIdentity({
    path: options.identityPath,
    now: options.createdAt,
  });
  const ko = createKnowledgeObject({
    tenant: options.tenant ?? "stacy/acme",
    contentType: options.contentType,
    content: options.content,
    identity,
    createdAt: options.createdAt,
    idGenerator: options.idGenerator,
  });
  const stored = await storeKnowledgeObject({
    db: options.db,
    ko,
    source: "local",
    storedAt: options.storedAt,
  } satisfies StoreKnowledgeObjectOptions);
  const receiptAt = options.storedAt ?? options.createdAt;
  await appendReceipt({
    db: options.db,
    eventType: "create",
    tenant: ko.signedPayload.tenant,
    koId: ko.id,
    actorInstallId: identity.record.installId,
    payload: {
      contentHash: stored.contentHash,
      contentType: ko.signedPayload.contentType,
    },
    createdAt: receiptAt,
  });
  await appendReceipt({
    db: options.db,
    eventType: "sign",
    tenant: ko.signedPayload.tenant,
    koId: ko.id,
    actorInstallId: identity.record.installId,
    payload: {
      contentHash: stored.contentHash,
      signerInstallId: ko.signer.installId,
    },
    createdAt: receiptAt,
  });

  return {
    ko,
    contentHash: stored.contentHash,
    creatorInstallId: identity.record.installId,
  };
}
