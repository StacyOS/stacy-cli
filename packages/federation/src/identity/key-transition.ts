import { createPublicKey, sign, verify } from "node:crypto";

import { canonicalBytes } from "../crypto/canonical.js";
import { sha256Hex } from "../util/hash.js";
import type { InstallIdentity } from "./install-identity.js";

export const KEY_TRANSITION_SCHEMA_VERSION = 1;

export interface KeyTransitionUnsignedPayload {
  readonly kind: "install_key_transition";
  readonly schemaVersion: typeof KEY_TRANSITION_SCHEMA_VERSION;
  readonly oldInstallId: string;
  readonly oldPublicKeyPem: string;
  readonly newInstallId: string;
  readonly newPublicKeyPem: string;
  readonly effectiveAt: string;
  readonly createdAt: string;
  readonly reason?: string;
}

export interface KeyTransitionSigner {
  readonly installId: string;
  readonly publicKeyPem: string;
}

export interface SignedKeyTransition {
  readonly id: string;
  readonly signedPayload: KeyTransitionUnsignedPayload;
  readonly oldSigner: KeyTransitionSigner;
  readonly newSigner: KeyTransitionSigner;
  readonly oldSignature: string;
  readonly newSignature: string;
}

export interface CreateKeyTransitionOptions {
  readonly oldIdentity: InstallIdentity;
  readonly newIdentity: InstallIdentity;
  readonly effectiveAt?: Date;
  readonly now?: Date;
  readonly reason?: string;
}

export type KeyTransitionVerificationResult =
  | { readonly ok: true; readonly transitionHash: string }
  | { readonly ok: false; readonly reason: string };

export type KeyTransitionChainVerificationResult =
  | {
      readonly ok: true;
      readonly checked: number;
      readonly rootInstallId: string | null;
      readonly currentInstallId: string | null;
    }
  | {
      readonly ok: false;
      readonly checked: number;
      readonly firstInvalidTransitionId?: string;
      readonly reason: string;
    };

export function createKeyTransition(options: CreateKeyTransitionOptions): SignedKeyTransition {
  const now = options.now ?? new Date();
  const effectiveAt = options.effectiveAt ?? now;
  const reason = options.reason?.trim();
  const signedPayload: KeyTransitionUnsignedPayload = {
    kind: "install_key_transition",
    schemaVersion: KEY_TRANSITION_SCHEMA_VERSION,
    oldInstallId: options.oldIdentity.record.installId,
    oldPublicKeyPem: options.oldIdentity.record.publicKeyPem,
    newInstallId: options.newIdentity.record.installId,
    newPublicKeyPem: options.newIdentity.record.publicKeyPem,
    effectiveAt: effectiveAt.toISOString(),
    createdAt: now.toISOString(),
    ...(reason ? { reason } : {}),
  };
  const payloadBytes = canonicalBytes(signedPayload);
  const transitionHash = hashKeyTransitionPayload(signedPayload);

  return {
    id: `key_transition_${transitionHash.slice(0, 32)}`,
    signedPayload,
    oldSigner: {
      installId: options.oldIdentity.record.installId,
      publicKeyPem: options.oldIdentity.record.publicKeyPem,
    },
    newSigner: {
      installId: options.newIdentity.record.installId,
      publicKeyPem: options.newIdentity.record.publicKeyPem,
    },
    oldSignature: sign(null, payloadBytes, options.oldIdentity.privateKey).toString("base64"),
    newSignature: sign(null, payloadBytes, options.newIdentity.privateKey).toString("base64"),
  };
}

export function verifyKeyTransition(
  transition: SignedKeyTransition,
): KeyTransitionVerificationResult {
  const payload = transition.signedPayload;
  if (payload.kind !== "install_key_transition") {
    return { ok: false, reason: "Key transition has the wrong kind" };
  }
  if (payload.schemaVersion !== KEY_TRANSITION_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `Unsupported key transition schema version ${payload.schemaVersion}`,
    };
  }
  const transitionHash = hashKeyTransitionPayload(payload);
  if (transition.id !== `key_transition_${transitionHash.slice(0, 32)}`) {
    return { ok: false, reason: "Key transition id does not match payload hash" };
  }
  const oldExpected = deriveInstallIdFromPublicKey(payload.oldPublicKeyPem);
  const newExpected = deriveInstallIdFromPublicKey(payload.newPublicKeyPem);
  if (payload.oldInstallId !== oldExpected) {
    return { ok: false, reason: "Old install id does not match old public key" };
  }
  if (payload.newInstallId !== newExpected) {
    return { ok: false, reason: "New install id does not match new public key" };
  }
  if (payload.oldInstallId === payload.newInstallId) {
    return { ok: false, reason: "Key transition must change install id" };
  }
  if (
    transition.oldSigner.installId !== payload.oldInstallId ||
    transition.oldSigner.publicKeyPem !== payload.oldPublicKeyPem
  ) {
    return { ok: false, reason: "Old signer does not match transition payload" };
  }
  if (
    transition.newSigner.installId !== payload.newInstallId ||
    transition.newSigner.publicKeyPem !== payload.newPublicKeyPem
  ) {
    return { ok: false, reason: "New signer does not match transition payload" };
  }
  const payloadBytes = canonicalBytes(payload);
  if (
    !verify(
      null,
      payloadBytes,
      createPublicKey(payload.oldPublicKeyPem),
      Buffer.from(transition.oldSignature, "base64"),
    )
  ) {
    return { ok: false, reason: "Old key signature is invalid" };
  }
  if (
    !verify(
      null,
      payloadBytes,
      createPublicKey(payload.newPublicKeyPem),
      Buffer.from(transition.newSignature, "base64"),
    )
  ) {
    return { ok: false, reason: "New key countersignature is invalid" };
  }
  if (Number.isNaN(Date.parse(payload.effectiveAt)) || Number.isNaN(Date.parse(payload.createdAt))) {
    return { ok: false, reason: "Key transition timestamps must be valid ISO dates" };
  }
  return { ok: true, transitionHash };
}

export function verifyKeyTransitionChain(
  transitions: readonly SignedKeyTransition[],
): KeyTransitionChainVerificationResult {
  if (transitions.length === 0) {
    return { ok: true, checked: 0, rootInstallId: null, currentInstallId: null };
  }

  const ordered = [...transitions].sort((left, right) =>
    left.signedPayload.effectiveAt.localeCompare(right.signedPayload.effectiveAt) ||
    left.signedPayload.createdAt.localeCompare(right.signedPayload.createdAt) ||
    left.id.localeCompare(right.id),
  );
  let expectedOldInstallId: string | null = null;
  let rootInstallId: string | null = null;

  for (const [index, transition] of ordered.entries()) {
    const verification = verifyKeyTransition(transition);
    if (!verification.ok) {
      return {
        ok: false,
        checked: index,
        firstInvalidTransitionId: transition.id,
        reason: verification.reason,
      };
    }
    if (expectedOldInstallId && transition.signedPayload.oldInstallId !== expectedOldInstallId) {
      return {
        ok: false,
        checked: index,
        firstInvalidTransitionId: transition.id,
        reason: `Broken key transition chain: expected old install ${expectedOldInstallId}`,
      };
    }
    rootInstallId ??= transition.signedPayload.oldInstallId;
    expectedOldInstallId = transition.signedPayload.newInstallId;
  }

  return {
    ok: true,
    checked: ordered.length,
    rootInstallId,
    currentInstallId: expectedOldInstallId,
  };
}

export function hashKeyTransitionPayload(payload: KeyTransitionUnsignedPayload): string {
  return `sha256:${sha256Hex(canonicalBytes(payload))}`;
}

export function deriveInstallIdFromPublicKey(publicKeyPem: string): string {
  return `install_${sha256Hex(publicKeyPem).slice(0, 32)}`;
}
