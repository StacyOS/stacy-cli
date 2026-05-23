import { createPublicKey, randomUUID, sign, verify } from "node:crypto";

import { canonicalBytes } from "../crypto/canonical.js";
import type { InstallIdentity } from "../identity/install-identity.js";
import { sha256Hex } from "../util/hash.js";
import {
  type SignedRevocationTombstone,
  verifyRevocationTombstone,
} from "./revocation.js";

export const WITNESS_REVOCATION_SCHEMA_VERSION = 1;

export interface WitnessIdentity {
  readonly witnessId: string;
  readonly label: string;
  readonly publicKeyPem: string;
}

export interface WitnessedRevocationUnsignedPayload {
  readonly kind: "witnessed_revocation";
  readonly schemaVersion: typeof WITNESS_REVOCATION_SCHEMA_VERSION;
  readonly tenant: string;
  readonly koId: string;
  readonly koContentHash: string;
  readonly tombstoneId: string;
  readonly tombstoneHash: string;
  readonly producerInstallId: string;
  readonly witnessId: string;
  readonly witnessLabel: string;
  readonly witnessedAt: string;
}

export interface SignedWitnessedRevocation {
  readonly id: string;
  readonly signedPayload: WitnessedRevocationUnsignedPayload;
  readonly witness: WitnessIdentity;
  readonly signature: string;
}

export interface CreateWitnessedRevocationOptions {
  readonly tombstone: SignedRevocationTombstone;
  readonly witnessIdentity: InstallIdentity;
  readonly witnessLabel: string;
  readonly witnessedAt?: Date;
  readonly idGenerator?: () => string;
}

export interface WitnessRevocationPolicy {
  readonly mode: "producer_only" | "witnessed";
  readonly requiredWitnesses?: number;
  readonly trustedWitnessIds?: readonly string[];
}

export type WitnessedRevocationVerificationResult =
  | { readonly ok: true; readonly witnessHash: string }
  | { readonly ok: false; readonly reason: string };

export type WitnessPolicyEnforcementResult =
  | { readonly ok: true; readonly validWitnesses: number }
  | { readonly ok: false; readonly reason: string; readonly validWitnesses: number };

export function createWitnessedRevocation(
  options: CreateWitnessedRevocationOptions,
): SignedWitnessedRevocation {
  const tombstoneVerification = verifyRevocationTombstone(options.tombstone);
  if (!tombstoneVerification.ok) {
    throw new Error(`Cannot witness invalid revocation tombstone: ${tombstoneVerification.reason}`);
  }
  const witnessLabel = options.witnessLabel.trim();
  if (!witnessLabel) {
    throw new Error("Witness label is required");
  }

  const signedPayload: WitnessedRevocationUnsignedPayload = {
    kind: "witnessed_revocation",
    schemaVersion: WITNESS_REVOCATION_SCHEMA_VERSION,
    tenant: options.tombstone.signedPayload.tenant,
    koId: options.tombstone.signedPayload.koId,
    koContentHash: options.tombstone.signedPayload.koContentHash,
    tombstoneId: options.tombstone.id,
    tombstoneHash: options.tombstone.signedPayload.tombstoneHash,
    producerInstallId: options.tombstone.signedPayload.issuerInstallId,
    witnessId: witnessIdFromPublicKey(options.witnessIdentity.record.publicKeyPem),
    witnessLabel,
    witnessedAt: (options.witnessedAt ?? new Date()).toISOString(),
  };
  const witnessHash = hashWitnessedRevocationPayload(signedPayload);

  return {
    id: options.idGenerator?.() ?? defaultWitnessedRevocationId(witnessHash),
    signedPayload,
    witness: {
      witnessId: signedPayload.witnessId,
      label: witnessLabel,
      publicKeyPem: options.witnessIdentity.record.publicKeyPem,
    },
    signature: sign(null, canonicalBytes(signedPayload), options.witnessIdentity.privateKey).toString("base64"),
  };
}

export function verifyWitnessedRevocation(
  witnessed: SignedWitnessedRevocation,
  tombstone: SignedRevocationTombstone,
): WitnessedRevocationVerificationResult {
  const tombstoneVerification = verifyRevocationTombstone(tombstone);
  if (!tombstoneVerification.ok) {
    return { ok: false, reason: tombstoneVerification.reason };
  }
  const payload = witnessed.signedPayload;
  if (payload.kind !== "witnessed_revocation") {
    return { ok: false, reason: "Witnessed revocation has the wrong kind" };
  }
  if (payload.schemaVersion !== WITNESS_REVOCATION_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `Unsupported witnessed revocation schema version ${payload.schemaVersion}`,
    };
  }
  if (payload.tenant !== tombstone.signedPayload.tenant) {
    return { ok: false, reason: "Witnessed revocation tenant does not match tombstone" };
  }
  if (payload.koId !== tombstone.signedPayload.koId) {
    return { ok: false, reason: "Witnessed revocation KO id does not match tombstone" };
  }
  if (payload.koContentHash !== tombstone.signedPayload.koContentHash) {
    return { ok: false, reason: "Witnessed revocation KO hash does not match tombstone" };
  }
  if (payload.tombstoneId !== tombstone.id || payload.tombstoneHash !== tombstone.signedPayload.tombstoneHash) {
    return { ok: false, reason: "Witnessed revocation tombstone binding does not match" };
  }
  if (payload.producerInstallId !== tombstone.signedPayload.issuerInstallId) {
    return { ok: false, reason: "Witnessed revocation producer does not match tombstone issuer" };
  }
  if (payload.witnessId !== witnessed.witness.witnessId) {
    return { ok: false, reason: "Witness identity does not match witnessed payload" };
  }
  if (payload.witnessLabel !== witnessed.witness.label) {
    return { ok: false, reason: "Witness label does not match witnessed payload" };
  }
  if (payload.witnessId !== witnessIdFromPublicKey(witnessed.witness.publicKeyPem)) {
    return { ok: false, reason: "Witness id does not match witness public key" };
  }
  if (Number.isNaN(Date.parse(payload.witnessedAt))) {
    return { ok: false, reason: "Witnessed revocation timestamp must be a valid ISO date" };
  }

  const signatureOk = verify(
    null,
    canonicalBytes(payload),
    createPublicKey(witnessed.witness.publicKeyPem),
    Buffer.from(witnessed.signature, "base64"),
  );
  if (!signatureOk) {
    return { ok: false, reason: "Witnessed revocation signature verification failed" };
  }

  return { ok: true, witnessHash: hashWitnessedRevocationPayload(payload) };
}

export function enforceWitnessRevocationPolicy(
  options: {
    readonly tombstone: SignedRevocationTombstone;
    readonly witnesses: readonly SignedWitnessedRevocation[];
    readonly policy: WitnessRevocationPolicy;
  },
): WitnessPolicyEnforcementResult {
  if (options.policy.mode === "producer_only") {
    return { ok: true, validWitnesses: 0 };
  }

  const required = options.policy.requiredWitnesses ?? 1;
  if (!Number.isInteger(required) || required <= 0) {
    return { ok: false, reason: "Witness policy requires a positive witness count", validWitnesses: 0 };
  }
  const trusted = options.policy.trustedWitnessIds ? new Set(options.policy.trustedWitnessIds) : null;
  const seen = new Set<string>();

  for (const witnessed of options.witnesses) {
    const verification = verifyWitnessedRevocation(witnessed, options.tombstone);
    if (!verification.ok) continue;
    if (trusted && !trusted.has(witnessed.witness.witnessId)) continue;
    seen.add(witnessed.witness.witnessId);
  }

  if (seen.size < required) {
    return {
      ok: false,
      reason: `Witness policy requires ${required} valid witness(es); found ${seen.size}`,
      validWitnesses: seen.size,
    };
  }
  return { ok: true, validWitnesses: seen.size };
}

export function witnessIdFromPublicKey(publicKeyPem: string): string {
  return `witness_${sha256Hex(publicKeyPem).slice(0, 32)}`;
}

export function hashWitnessedRevocationPayload(payload: WitnessedRevocationUnsignedPayload): string {
  return `sha256:${sha256Hex(canonicalBytes(payload))}`;
}

function defaultWitnessedRevocationId(witnessHash: string): string {
  const hash = witnessHash.replace(/^sha256:/, "");
  return hash.length > 0 ? `witness_revoke_${hash}` : `witness_revoke_${randomUUID()}`;
}
