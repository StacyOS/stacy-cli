import { randomUUID, sign, verify } from "node:crypto";

import { canonicalBytes, type CanonicalJsonValue } from "../crypto/canonical.js";
import type { InstallIdentity } from "../identity/install-identity.js";
import { sha256Hex } from "../util/hash.js";

export const KNOWLEDGE_OBJECT_SCHEMA_VERSION = 1;

export interface KnowledgeObjectUnsignedPayload {
  readonly kind: "knowledge_object";
  readonly schemaVersion: typeof KNOWLEDGE_OBJECT_SCHEMA_VERSION;
  readonly tenant: string;
  readonly creatorInstallId: string;
  readonly contentType: string;
  readonly content: CanonicalJsonValue;
  readonly createdAt: string;
}

export interface KnowledgeObjectSignedPayload
  extends KnowledgeObjectUnsignedPayload {
  readonly contentHash: string;
}

export interface SignedKnowledgeObject {
  readonly id: string;
  readonly signedPayload: KnowledgeObjectSignedPayload;
  readonly signer: {
    readonly installId: string;
    readonly publicKeyPem: string;
  };
  readonly signature: string;
}

export interface CreateKnowledgeObjectOptions {
  readonly tenant: string;
  readonly contentType: string;
  readonly content: CanonicalJsonValue;
  readonly identity: InstallIdentity;
  readonly createdAt?: Date;
  readonly idGenerator?: () => string;
}

export type KnowledgeObjectVerificationResult =
  | { readonly ok: true; readonly contentHash: string }
  | { readonly ok: false; readonly reason: string };

export function createKnowledgeObject(
  options: CreateKnowledgeObjectOptions,
): SignedKnowledgeObject {
  const unsignedPayload: KnowledgeObjectUnsignedPayload = {
    kind: "knowledge_object",
    schemaVersion: KNOWLEDGE_OBJECT_SCHEMA_VERSION,
    tenant: options.tenant,
    creatorInstallId: options.identity.record.installId,
    contentType: options.contentType,
    content: options.content,
    createdAt: (options.createdAt ?? new Date()).toISOString(),
  };

  const contentHash = formatContentHash(sha256Hex(canonicalBytes(unsignedPayload)));
  const signedPayload: KnowledgeObjectSignedPayload = {
    ...unsignedPayload,
    contentHash,
  };
  const signature = sign(null, canonicalBytes(signedPayload), options.identity.privateKey);

  return {
    id: options.idGenerator?.() ?? defaultKnowledgeObjectId(contentHash),
    signedPayload,
    signer: {
      installId: options.identity.record.installId,
      publicKeyPem: options.identity.record.publicKeyPem,
    },
    signature: signature.toString("base64"),
  };
}

export function verifyKnowledgeObject(
  ko: SignedKnowledgeObject,
): KnowledgeObjectVerificationResult {
  try {
    if (ko.signedPayload.kind !== "knowledge_object") {
      return { ok: false, reason: "Knowledge Object has the wrong kind" };
    }

    if (ko.signedPayload.schemaVersion !== KNOWLEDGE_OBJECT_SCHEMA_VERSION) {
      return {
        ok: false,
        reason: `Unsupported Knowledge Object schema version ${ko.signedPayload.schemaVersion}`,
      };
    }

    if (ko.signer.installId !== ko.signedPayload.creatorInstallId) {
      return { ok: false, reason: "Signer install does not match creator install" };
    }

    const unsignedPayload: KnowledgeObjectUnsignedPayload = {
      kind: ko.signedPayload.kind,
      schemaVersion: ko.signedPayload.schemaVersion,
      tenant: ko.signedPayload.tenant,
      creatorInstallId: ko.signedPayload.creatorInstallId,
      contentType: ko.signedPayload.contentType,
      content: ko.signedPayload.content,
      createdAt: ko.signedPayload.createdAt,
    };
    const expectedContentHash = formatContentHash(
      sha256Hex(canonicalBytes(unsignedPayload)),
    );

    if (ko.signedPayload.contentHash !== expectedContentHash) {
      return { ok: false, reason: "Knowledge Object content hash mismatch" };
    }

    const signatureOk = verify(
      null,
      canonicalBytes(ko.signedPayload),
      ko.signer.publicKeyPem,
      Buffer.from(ko.signature, "base64"),
    );

    if (!signatureOk) {
      return { ok: false, reason: "Knowledge Object signature verification failed" };
    }

    return { ok: true, contentHash: expectedContentHash };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Knowledge Object verification failed",
    };
  }
}

function formatContentHash(hash: string): string {
  return `sha256:${hash}`;
}

function defaultKnowledgeObjectId(contentHash: string): string {
  const hash = contentHash.replace(/^sha256:/, "");
  return hash.length > 0 ? `ko_${hash}` : `ko_${randomUUID()}`;
}
