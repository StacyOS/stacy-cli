import { randomUUID, sign, verify } from "node:crypto";

import { canonicalBytes } from "../crypto/canonical.js";
import type { InstallIdentity } from "../identity/install-identity.js";
import { sha256Hex } from "../util/hash.js";

export const REVOCATION_TOMBSTONE_SCHEMA_VERSION = 1;

export interface RevocationTombstoneUnsignedPayload {
  readonly kind: "revocation_tombstone";
  readonly schemaVersion: typeof REVOCATION_TOMBSTONE_SCHEMA_VERSION;
  readonly tenant: string;
  readonly koId: string;
  readonly koContentHash: string;
  readonly revokedGrantId?: string;
  readonly issuerInstallId: string;
  readonly reason: string;
  readonly createdAt: string;
}

export interface RevocationTombstoneSignedPayload extends RevocationTombstoneUnsignedPayload {
  readonly tombstoneHash: string;
}

export interface SignedRevocationTombstone {
  readonly id: string;
  readonly signedPayload: RevocationTombstoneSignedPayload;
  readonly signer: {
    readonly installId: string;
    readonly publicKeyPem: string;
  };
  readonly signature: string;
}

export interface CreateRevocationTombstoneOptions {
  readonly tenant: string;
  readonly koId: string;
  readonly koContentHash: string;
  readonly issuerIdentity: InstallIdentity;
  readonly reason: string;
  readonly revokedGrantId?: string;
  readonly createdAt?: Date;
  readonly idGenerator?: () => string;
}

export type RevocationTombstoneVerificationResult =
  | { readonly ok: true; readonly tombstoneHash: string }
  | { readonly ok: false; readonly reason: string };

export function createRevocationTombstone(
  options: CreateRevocationTombstoneOptions,
): SignedRevocationTombstone {
  const trimmedReason = options.reason.trim();
  if (!trimmedReason) {
    throw new Error("Revocation reason is required");
  }

  const unsignedPayload: RevocationTombstoneUnsignedPayload = {
    kind: "revocation_tombstone",
    schemaVersion: REVOCATION_TOMBSTONE_SCHEMA_VERSION,
    tenant: options.tenant,
    koId: options.koId,
    koContentHash: options.koContentHash,
    issuerInstallId: options.issuerIdentity.record.installId,
    reason: trimmedReason,
    createdAt: (options.createdAt ?? new Date()).toISOString(),
    ...(options.revokedGrantId ? { revokedGrantId: options.revokedGrantId } : {}),
  };
  const tombstoneHash = formatTombstoneHash(sha256Hex(canonicalBytes(unsignedPayload)));
  const signedPayload: RevocationTombstoneSignedPayload = {
    ...unsignedPayload,
    tombstoneHash,
  };
  const signature = sign(
    null,
    canonicalBytes(signedPayload),
    options.issuerIdentity.privateKey,
  );

  return {
    id: options.idGenerator?.() ?? defaultRevocationTombstoneId(tombstoneHash),
    signedPayload,
    signer: {
      installId: options.issuerIdentity.record.installId,
      publicKeyPem: options.issuerIdentity.record.publicKeyPem,
    },
    signature: signature.toString("base64"),
  };
}

export function verifyRevocationTombstone(
  tombstone: SignedRevocationTombstone,
): RevocationTombstoneVerificationResult {
  try {
    if (tombstone.signedPayload.kind !== "revocation_tombstone") {
      return { ok: false, reason: "Revocation tombstone has the wrong kind" };
    }

    if (tombstone.signedPayload.schemaVersion !== REVOCATION_TOMBSTONE_SCHEMA_VERSION) {
      return {
        ok: false,
        reason: `Unsupported revocation tombstone schema version ${tombstone.signedPayload.schemaVersion}`,
      };
    }

    if (tombstone.signer.installId !== tombstone.signedPayload.issuerInstallId) {
      return { ok: false, reason: "Signer install does not match revocation issuer" };
    }

    const unsignedPayload: RevocationTombstoneUnsignedPayload = {
      kind: tombstone.signedPayload.kind,
      schemaVersion: tombstone.signedPayload.schemaVersion,
      tenant: tombstone.signedPayload.tenant,
      koId: tombstone.signedPayload.koId,
      koContentHash: tombstone.signedPayload.koContentHash,
      issuerInstallId: tombstone.signedPayload.issuerInstallId,
      reason: tombstone.signedPayload.reason,
      createdAt: tombstone.signedPayload.createdAt,
      ...(tombstone.signedPayload.revokedGrantId
        ? { revokedGrantId: tombstone.signedPayload.revokedGrantId }
        : {}),
    };
    const expectedTombstoneHash = formatTombstoneHash(sha256Hex(canonicalBytes(unsignedPayload)));

    if (tombstone.signedPayload.tombstoneHash !== expectedTombstoneHash) {
      return { ok: false, reason: "Revocation tombstone hash mismatch" };
    }

    const signatureOk = verify(
      null,
      canonicalBytes(tombstone.signedPayload),
      tombstone.signer.publicKeyPem,
      Buffer.from(tombstone.signature, "base64"),
    );

    if (!signatureOk) {
      return { ok: false, reason: "Revocation tombstone signature verification failed" };
    }

    return { ok: true, tombstoneHash: expectedTombstoneHash };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Revocation tombstone verification failed",
    };
  }
}

function formatTombstoneHash(hash: string): string {
  return `sha256:${hash}`;
}

function defaultRevocationTombstoneId(tombstoneHash: string): string {
  const hash = tombstoneHash.replace(/^sha256:/, "");
  return hash.length > 0 ? `revoke_${hash}` : `revoke_${randomUUID()}`;
}
