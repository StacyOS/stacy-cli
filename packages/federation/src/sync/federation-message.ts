import { randomUUID, sign, verify } from "node:crypto";

import { readKnowledgeObject, storeKnowledgeObject, type BrainDb } from "../brain/brain-store.js";
import { storeConsentGrant } from "../consent/grant-store.js";
import { createConsentGrant, type ConsentGrantScope, type SignedConsentGrant } from "../consent/grant.js";
import { canonicalBytes } from "../crypto/canonical.js";
import type { InstallIdentity } from "../identity/install-identity.js";
import type { SignedKnowledgeObject } from "../ko/knowledge-object.js";
import { appendReceipt } from "../receipts/receipt-store.js";
import { claimReceivedNonce } from "./received-nonce-store.js";
import { storeRevocationSource } from "./revocation-source-store.js";

export const FEDERATION_MESSAGE_SCHEMA_VERSION = 1;
export const FEDERATION_MESSAGE_REPLAY_WINDOW_MS = 60_000;

export interface FederationKnowledgeObjectMessageSignedPayload {
  readonly kind: "federation_ko_message";
  readonly schemaVersion: typeof FEDERATION_MESSAGE_SCHEMA_VERSION;
  readonly tenant: string;
  readonly producerInstallId: string;
  readonly consumerInstallId: string;
  readonly ko: SignedKnowledgeObject;
  readonly grant: SignedConsentGrant;
  readonly revocationLookupUrl?: string;
  readonly nonce: string;
  readonly createdAt: string;
}

export interface FederationKnowledgeObjectMessage extends FederationKnowledgeObjectMessageSignedPayload {
  readonly sender: {
    readonly installId: string;
    readonly publicKeyPem: string;
  };
  readonly signature: string;
}

export interface CreateFederationMessageOptions {
  readonly db: BrainDb;
  readonly koId: string;
  readonly producerIdentity: InstallIdentity;
  readonly consumerInstallId: string;
  readonly scope?: ConsentGrantScope;
  readonly expiresAt: Date;
  readonly revocable: boolean;
  readonly revocationLookupUrl?: string;
  readonly nonce?: string;
  readonly createdAt?: Date;
}

export interface ReceiveFederationMessageOptions {
  readonly db: BrainDb;
  readonly message: FederationKnowledgeObjectMessage;
  readonly receivedAt?: Date;
  readonly replayWindowMs?: number;
  readonly replayGuard?: FederationReplayGuard;
}

export interface FederationReplayGuard {
  claim(key: string, expiresAt: Date, now: Date): boolean | Promise<boolean>;
}

export async function createFederationMessage(
  options: CreateFederationMessageOptions,
): Promise<FederationKnowledgeObjectMessage> {
  const read = await readKnowledgeObject({ db: options.db, koId: options.koId });
  if (!read.ok) {
    throw new Error(read.reason);
  }

  if (read.provenance.source !== "local") {
    throw new Error("Only local Knowledge Objects can be shared by this install");
  }

  if (read.ko.signedPayload.creatorInstallId !== options.producerIdentity.record.installId) {
    throw new Error("Producer identity does not own this Knowledge Object");
  }

  const createdAt = options.createdAt ?? new Date();
  const grant = createConsentGrant({
    tenant: read.ko.signedPayload.tenant,
    koId: read.ko.id,
    koContentHash: read.ko.signedPayload.contentHash,
    producerIdentity: options.producerIdentity,
    consumerInstallId: options.consumerInstallId,
    scope: options.scope,
    expiresAt: options.expiresAt,
    revocable: options.revocable,
    createdAt,
  });

  await storeConsentGrant({ db: options.db, grant, storedAt: createdAt });
  await appendReceipt({
    db: options.db,
    eventType: "share",
    tenant: read.ko.signedPayload.tenant,
    koId: read.ko.id,
    actorInstallId: options.producerIdentity.record.installId,
    counterpartyInstallId: options.consumerInstallId,
    payload: {
      grantId: grant.id,
      scope: grant.signedPayload.scope,
      contentHash: read.ko.signedPayload.contentHash,
      expiresAt: grant.signedPayload.expiresAt,
    },
    createdAt,
  });

  const signedPayload: FederationKnowledgeObjectMessageSignedPayload = {
    kind: "federation_ko_message",
    schemaVersion: FEDERATION_MESSAGE_SCHEMA_VERSION,
    tenant: read.ko.signedPayload.tenant,
    producerInstallId: options.producerIdentity.record.installId,
    consumerInstallId: options.consumerInstallId,
    ko: read.ko,
    grant,
    ...(options.revocationLookupUrl ? { revocationLookupUrl: options.revocationLookupUrl } : {}),
    nonce: options.nonce ?? randomUUID(),
    createdAt: createdAt.toISOString(),
  };
  const signature = sign(
    null,
    canonicalBytes(signedPayload),
    options.producerIdentity.privateKey,
  );

  return {
    ...signedPayload,
    sender: {
      installId: options.producerIdentity.record.installId,
      publicKeyPem: options.producerIdentity.record.publicKeyPem,
    },
    signature: signature.toString("base64"),
  };
}

export async function receiveFederationMessage(
  options: ReceiveFederationMessageOptions,
): Promise<{ readonly koId: string; readonly grantId: string; readonly contentHash: string }> {
  const receivedAt = options.receivedAt ?? new Date();
  if (options.message.kind !== "federation_ko_message") {
    throw new Error("Federation message has the wrong kind");
  }

  if (options.message.schemaVersion !== FEDERATION_MESSAGE_SCHEMA_VERSION) {
    throw new Error(`Unsupported federation message schema version ${options.message.schemaVersion}`);
  }

  if (!verifyFederationMessageSignature(options.message)) {
    throw new Error("Federation message signature verification failed");
  }

  await validateFederationMessageFreshness({
    db: options.db,
    message: options.message,
    receivedAt,
    replayWindowMs: options.replayWindowMs ?? FEDERATION_MESSAGE_REPLAY_WINDOW_MS,
    replayGuard: options.replayGuard,
  });

  if (options.message.tenant !== options.message.ko.signedPayload.tenant) {
    throw new Error("Federation message tenant does not match KO");
  }

  if (options.message.producerInstallId !== options.message.ko.signedPayload.creatorInstallId) {
    throw new Error("Federation message producer does not match KO creator");
  }

  if (options.message.sender.installId !== options.message.producerInstallId) {
    throw new Error("Federation message sender does not match producer");
  }

  if (options.message.grant.signedPayload.koId !== options.message.ko.id) {
    throw new Error("Federation message grant does not reference KO");
  }

  if (options.message.grant.signedPayload.consumerInstallId !== options.message.consumerInstallId) {
    throw new Error("Federation message grant does not target consumer");
  }

  const stored = await storeKnowledgeObject({
    db: options.db,
    ko: options.message.ko,
    source: "federated",
    receivedFromInstallId: options.message.producerInstallId,
    storedAt: receivedAt,
  });
  await storeConsentGrant({
    db: options.db,
    grant: options.message.grant,
    storedAt: receivedAt,
  });
  if (options.message.revocationLookupUrl) {
    await storeRevocationSource({
      db: options.db,
      koId: options.message.ko.id,
      producerInstallId: options.message.producerInstallId,
      lookupUrl: options.message.revocationLookupUrl,
      storedAt: receivedAt,
    });
  }
  await appendReceipt({
    db: options.db,
    eventType: "receive",
    tenant: options.message.tenant,
    koId: options.message.ko.id,
    actorInstallId: options.message.consumerInstallId,
    counterpartyInstallId: options.message.producerInstallId,
    payload: {
      grantId: options.message.grant.id,
      contentHash: stored.contentHash,
    },
    createdAt: receivedAt,
  });
  await appendReceipt({
    db: options.db,
    eventType: "store",
    tenant: options.message.tenant,
    koId: options.message.ko.id,
    actorInstallId: options.message.consumerInstallId,
    counterpartyInstallId: options.message.producerInstallId,
    payload: {
      source: "federated",
      contentHash: stored.contentHash,
    },
    createdAt: receivedAt,
  });

  return {
    koId: options.message.ko.id,
    grantId: options.message.grant.id,
    contentHash: stored.contentHash,
  };
}

export function verifyFederationMessageSignature(
  message: FederationKnowledgeObjectMessage,
): boolean {
  try {
    return verify(
      null,
      canonicalBytes(signedPayloadForMessage(message)),
      message.sender.publicKeyPem,
      Buffer.from(message.signature, "base64"),
    );
  } catch {
    return false;
  }
}

export function createMemoryFederationReplayGuard(): FederationReplayGuard {
  const seen = new Map<string, number>();
  return {
    claim(key, expiresAt, now) {
      const nowMs = now.getTime();
      for (const [seenKey, expiresAtMs] of seen) {
        if (expiresAtMs <= nowMs) {
          seen.delete(seenKey);
        }
      }
      if (seen.has(key)) {
        return false;
      }
      seen.set(key, expiresAt.getTime());
      return true;
    },
  };
}

async function validateFederationMessageFreshness(options: {
  readonly db: BrainDb;
  readonly message: FederationKnowledgeObjectMessage;
  readonly receivedAt: Date;
  readonly replayWindowMs: number;
  readonly replayGuard?: FederationReplayGuard;
}): Promise<void> {
  if (typeof options.message.nonce !== "string" || !options.message.nonce.trim()) {
    throw new Error("Federation message nonce is required");
  }

  const createdAtMs = Date.parse(options.message.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    throw new Error("Federation message createdAt is invalid");
  }

  const deltaMs = Math.abs(options.receivedAt.getTime() - createdAtMs);
  if (deltaMs > options.replayWindowMs) {
    throw new Error("Federation message is outside the replay window");
  }

  const replayKey = `${options.message.producerInstallId}:${options.message.nonce}`;
  const expiresAt = new Date(options.receivedAt.getTime() + options.replayWindowMs);
  const claimed = options.replayGuard
    ? await options.replayGuard.claim(replayKey, expiresAt, options.receivedAt)
    : await claimReceivedNonce({
        db: options.db,
        producerInstallId: options.message.producerInstallId,
        nonce: options.message.nonce,
        receivedAt: options.receivedAt,
        expiresAt,
      });
  if (!claimed) {
    throw new Error("Federation message replay detected");
  }
}

function signedPayloadForMessage(
  message: FederationKnowledgeObjectMessage,
): FederationKnowledgeObjectMessageSignedPayload {
  return {
    kind: message.kind,
    schemaVersion: message.schemaVersion,
    tenant: message.tenant,
    producerInstallId: message.producerInstallId,
    consumerInstallId: message.consumerInstallId,
    ko: message.ko,
    grant: message.grant,
    ...(message.revocationLookupUrl ? { revocationLookupUrl: message.revocationLookupUrl } : {}),
    nonce: message.nonce,
    createdAt: message.createdAt,
  };
}
