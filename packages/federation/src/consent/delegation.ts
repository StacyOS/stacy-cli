import { randomUUID, sign, verify } from "node:crypto";

import { canonicalBytes } from "../crypto/canonical.js";
import type { InstallIdentity } from "../identity/install-identity.js";
import { sha256Hex } from "../util/hash.js";
import {
  CONSENT_GRANT_SCOPE_READ,
  type ConsentGrantRecipient,
  type ConsentGrantScope,
  normalizeConsentGrantRecipient,
} from "./grant.js";
import {
  type SignedRevocationTombstone,
  verifyRevocationTombstone,
} from "./revocation.js";

export const DELEGATION_GRANT_SCHEMA_VERSION = 1;
export const MAX_DELEGATION_DEPTH = 4;

export interface DelegationGrantUnsignedPayload {
  readonly kind: "delegation_grant";
  readonly schemaVersion: typeof DELEGATION_GRANT_SCHEMA_VERSION;
  readonly tenant: string;
  readonly koId: string;
  readonly koContentHash: string;
  readonly producerInstallId: string;
  readonly delegateInstallId: string;
  readonly recipient: ConsentGrantRecipient;
  readonly scope: ConsentGrantScope;
  readonly sourceGrantId: string;
  readonly expiresAt: string;
  readonly revocable: boolean;
  readonly createdAt: string;
}

export interface DelegationGrantSignedPayload extends DelegationGrantUnsignedPayload {
  readonly delegationHash: string;
}

export interface SignedDelegationGrant {
  readonly id: string;
  readonly signedPayload: DelegationGrantSignedPayload;
  readonly signer: {
    readonly installId: string;
    readonly publicKeyPem: string;
  };
  readonly signature: string;
}

export interface CreateDelegationGrantOptions {
  readonly tenant: string;
  readonly koId: string;
  readonly koContentHash: string;
  readonly producerInstallId: string;
  readonly delegateIdentity: InstallIdentity;
  readonly recipient: ConsentGrantRecipient;
  readonly sourceGrantId: string;
  readonly scope?: ConsentGrantScope;
  readonly expiresAt: Date;
  readonly revocable: boolean;
  readonly createdAt?: Date;
  readonly idGenerator?: () => string;
}

export type DelegationGrantVerificationResult =
  | { readonly ok: true; readonly delegationHash: string }
  | { readonly ok: false; readonly reason: string };

export type DelegationEnforcementResult =
  | { readonly ok: true; readonly delegationId: string }
  | { readonly ok: false; readonly reason: string };

export function createDelegationGrant(options: CreateDelegationGrantOptions): SignedDelegationGrant {
  const unsignedPayload: DelegationGrantUnsignedPayload = {
    kind: "delegation_grant",
    schemaVersion: DELEGATION_GRANT_SCHEMA_VERSION,
    tenant: options.tenant,
    koId: options.koId,
    koContentHash: options.koContentHash,
    producerInstallId: options.producerInstallId,
    delegateInstallId: options.delegateIdentity.record.installId,
    recipient: normalizeConsentGrantRecipient(options.recipient),
    scope: options.scope ?? CONSENT_GRANT_SCOPE_READ,
    sourceGrantId: options.sourceGrantId,
    expiresAt: options.expiresAt.toISOString(),
    revocable: options.revocable,
    createdAt: (options.createdAt ?? new Date()).toISOString(),
  };
  const delegationHash = formatDelegationHash(sha256Hex(canonicalBytes(unsignedPayload)));
  const signedPayload: DelegationGrantSignedPayload = {
    ...unsignedPayload,
    delegationHash,
  };
  const signature = sign(null, canonicalBytes(signedPayload), options.delegateIdentity.privateKey);

  return {
    id: options.idGenerator?.() ?? defaultDelegationId(delegationHash),
    signedPayload,
    signer: {
      installId: options.delegateIdentity.record.installId,
      publicKeyPem: options.delegateIdentity.record.publicKeyPem,
    },
    signature: signature.toString("base64"),
  };
}

export function verifyDelegationGrant(
  delegation: SignedDelegationGrant,
): DelegationGrantVerificationResult {
  try {
    if (delegation.signedPayload.kind !== "delegation_grant") {
      return { ok: false, reason: "Delegation grant has the wrong kind" };
    }
    if (delegation.signedPayload.schemaVersion !== DELEGATION_GRANT_SCHEMA_VERSION) {
      return {
        ok: false,
        reason: `Unsupported delegation grant schema version ${delegation.signedPayload.schemaVersion}`,
      };
    }
    if (delegation.signer.installId !== delegation.signedPayload.delegateInstallId) {
      return { ok: false, reason: "Delegation signer does not match delegate install" };
    }

    const unsignedPayload: DelegationGrantUnsignedPayload = {
      kind: delegation.signedPayload.kind,
      schemaVersion: delegation.signedPayload.schemaVersion,
      tenant: delegation.signedPayload.tenant,
      koId: delegation.signedPayload.koId,
      koContentHash: delegation.signedPayload.koContentHash,
      producerInstallId: delegation.signedPayload.producerInstallId,
      delegateInstallId: delegation.signedPayload.delegateInstallId,
      recipient: normalizeConsentGrantRecipient(delegation.signedPayload.recipient),
      scope: delegation.signedPayload.scope,
      sourceGrantId: delegation.signedPayload.sourceGrantId,
      expiresAt: delegation.signedPayload.expiresAt,
      revocable: delegation.signedPayload.revocable,
      createdAt: delegation.signedPayload.createdAt,
    };
    const expectedDelegationHash = formatDelegationHash(sha256Hex(canonicalBytes(unsignedPayload)));
    if (delegation.signedPayload.delegationHash !== expectedDelegationHash) {
      return { ok: false, reason: "Delegation grant hash mismatch" };
    }

    const signatureOk = verify(
      null,
      canonicalBytes(delegation.signedPayload),
      delegation.signer.publicKeyPem,
      Buffer.from(delegation.signature, "base64"),
    );
    if (!signatureOk) {
      return { ok: false, reason: "Delegation grant signature verification failed" };
    }

    return { ok: true, delegationHash: expectedDelegationHash };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Delegation grant verification failed",
    };
  }
}

export function enforceDelegationGrant(options: {
  readonly delegation: SignedDelegationGrant;
  readonly delegationChain?: readonly SignedDelegationGrant[];
  readonly producerInstallId: string;
  readonly delegateInstallId: string;
  readonly koId: string;
  readonly koContentHash: string;
  readonly revocation?: SignedRevocationTombstone | null;
  readonly now?: Date;
}): DelegationEnforcementResult {
  const depthCheck = enforceDelegationChainDepth(options.delegationChain ?? [options.delegation]);
  if (!depthCheck.ok) return depthCheck;

  const verification = verifyDelegationGrant(options.delegation);
  if (!verification.ok) return { ok: false, reason: verification.reason };

  const payload = options.delegation.signedPayload;
  if (payload.producerInstallId !== options.producerInstallId) {
    return { ok: false, reason: "Delegation producer does not match" };
  }
  if (payload.delegateInstallId !== options.delegateInstallId) {
    return { ok: false, reason: "Delegation delegate does not match" };
  }
  if (payload.koId !== options.koId) {
    return { ok: false, reason: "Delegation KO id does not match" };
  }
  if (payload.koContentHash !== options.koContentHash) {
    return { ok: false, reason: "Delegation KO hash does not match" };
  }
  const expiry = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiry)) {
    return { ok: false, reason: "Delegation expiry is invalid" };
  }
  if (expiry <= (options.now ?? new Date()).getTime()) {
    return { ok: false, reason: "Delegation grant is expired" };
  }
  if (options.revocation) {
    const revocationVerification = verifyRevocationTombstone(options.revocation);
    if (!revocationVerification.ok) return { ok: false, reason: revocationVerification.reason };
    if (options.revocation.signedPayload.revokedGrantId !== options.delegation.id) {
      return { ok: false, reason: "Revocation tombstone does not target delegation grant" };
    }
    return { ok: false, reason: "Delegation grant has been revoked" };
  }

  return { ok: true, delegationId: options.delegation.id };
}

export function enforceDelegationChainDepth(
  delegationChain: readonly SignedDelegationGrant[],
): DelegationEnforcementResult {
  const depth = delegationChain.length;
  if (depth > MAX_DELEGATION_DEPTH) {
    return {
      ok: false,
      reason: `Delegation chain depth ${depth} exceeds the limit of ${MAX_DELEGATION_DEPTH}.`,
    };
  }
  const target = delegationChain.at(-1);
  return { ok: true, delegationId: target?.id ?? "" };
}

function formatDelegationHash(hash: string): string {
  return `sha256:${hash}`;
}

function defaultDelegationId(delegationHash: string): string {
  const hash = delegationHash.replace(/^sha256:/, "");
  return hash.length > 0 ? `delegation_${hash}` : `delegation_${randomUUID()}`;
}
