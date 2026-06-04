import type { CanonicalJsonValue } from "../crypto/canonical.js";
import { enforceWriteConsent } from "../consent/enforcement.js";
import { readConsentGrant } from "../consent/grant-store.js";
import { readRevocationTombstone } from "../consent/revocation-store.js";
import { ensureInstallIdentity } from "../identity/install-identity.js";
import { appendReceipt } from "../receipts/receipt-store.js";
import {
  readKnowledgeObject,
  type BrainDb,
} from "./brain-store.js";
import {
  createLocalKnowledgeObject,
  type CreateLocalKnowledgeObjectResult,
} from "./local-brain.js";

export const DERIVED_KO_CONTENT_SCHEMA_VERSION = 1;
export const DERIVED_KO_CONTENT_TYPE = "application/vnd.stacy.derived-ko+json";

export interface DerivedKnowledgeObjectContent {
  readonly kind: "derived_knowledge_object";
  readonly schemaVersion: typeof DERIVED_KO_CONTENT_SCHEMA_VERSION;
  readonly source: {
    readonly koId: string;
    readonly koContentHash: string;
    readonly producerInstallId: string;
    readonly grantId: string;
    readonly grantScope: "write" | "admin";
  };
  readonly createdByConsumerInstallId: string;
  readonly createdAt: string;
  readonly derivedContent: CanonicalJsonValue;
}

export interface CreateDerivedKnowledgeObjectOptions {
  readonly db: BrainDb;
  readonly identityPath: string;
  readonly sourceKoId: string;
  readonly derivedContent: CanonicalJsonValue;
  readonly contentType?: string;
  readonly createdAt?: Date;
  readonly storedAt?: Date;
  readonly idGenerator?: () => string;
}

export interface CreateDerivedKnowledgeObjectResult extends CreateLocalKnowledgeObjectResult {
  readonly sourceKoId: string;
  readonly sourceContentHash: string;
  readonly sourceProducerInstallId: string;
  readonly grantId: string;
}

export async function createDerivedKnowledgeObject(
  options: CreateDerivedKnowledgeObjectOptions,
): Promise<CreateDerivedKnowledgeObjectResult> {
  const createdAt = options.createdAt ?? new Date();
  const identity = await ensureInstallIdentity({
    path: options.identityPath,
    now: createdAt,
  });
  const consumerInstallId = identity.record.installId;

  const source = await readKnowledgeObject({ db: options.db, koId: options.sourceKoId });
  if (!source.ok) {
    throw new Error(source.reason);
  }
  if (source.provenance.source !== "federated") {
    throw new Error("Only federated Knowledge Objects can be derived with write consent");
  }

  const grant = await readConsentGrant({
    db: options.db,
    koId: source.ko.id,
    consumerInstallId,
  });
  const revocation = await readRevocationTombstone({
    db: options.db,
    koId: source.ko.id,
    grantId: grant?.id,
  });
  const consent = enforceWriteConsent({
    ko: source.ko,
    grant,
    revocation,
    consumerInstallId,
    now: createdAt,
  });
  if (!consent.ok) {
    await appendReceipt({
      db: options.db,
      eventType: "deny",
      tenant: source.ko.signedPayload.tenant,
      koId: source.ko.id,
      actorInstallId: consumerInstallId,
      counterpartyInstallId: source.ko.signedPayload.creatorInstallId,
      payload: {
        operation: "derive",
        reason: consent.reason,
        grantId: grant?.id,
      },
      createdAt,
    });
    throw new Error(consent.reason);
  }

  const content: DerivedKnowledgeObjectContent & CanonicalJsonValue = {
    kind: "derived_knowledge_object",
    schemaVersion: DERIVED_KO_CONTENT_SCHEMA_VERSION,
    source: {
      koId: source.ko.id,
      koContentHash: source.ko.signedPayload.contentHash,
      producerInstallId: source.ko.signedPayload.creatorInstallId,
      grantId: consent.grantId,
      grantScope: grant!.signedPayload.scope as "write" | "admin",
    },
    createdByConsumerInstallId: consumerInstallId,
    createdAt: createdAt.toISOString(),
    derivedContent: options.derivedContent,
  } as DerivedKnowledgeObjectContent & CanonicalJsonValue;

  const derived = await createLocalKnowledgeObject({
    db: options.db,
    identityPath: options.identityPath,
    tenant: source.ko.signedPayload.tenant,
    contentType: options.contentType?.trim() || DERIVED_KO_CONTENT_TYPE,
    content,
    createdAt,
    storedAt: options.storedAt ?? createdAt,
    idGenerator: options.idGenerator,
  });
  await appendReceipt({
    db: options.db,
    eventType: "derive",
    tenant: source.ko.signedPayload.tenant,
    koId: derived.ko.id,
    actorInstallId: consumerInstallId,
    counterpartyInstallId: source.ko.signedPayload.creatorInstallId,
    payload: {
      sourceKoId: source.ko.id,
      sourceContentHash: source.ko.signedPayload.contentHash,
      grantId: consent.grantId,
      derivedContentHash: derived.contentHash,
    },
    createdAt,
  });

  return {
    ...derived,
    sourceKoId: source.ko.id,
    sourceContentHash: source.ko.signedPayload.contentHash,
    sourceProducerInstallId: source.ko.signedPayload.creatorInstallId,
    grantId: consent.grantId,
  };
}
