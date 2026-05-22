import type { SignedKnowledgeObject } from "../ko/knowledge-object.js";
import { type SignedConsentGrant, verifyConsentGrant } from "./grant.js";
import {
  type SignedRevocationTombstone,
  verifyRevocationTombstone,
} from "./revocation.js";

export interface EnforceReadConsentOptions {
  readonly ko: SignedKnowledgeObject;
  readonly grant: SignedConsentGrant | null;
  readonly revocation?: SignedRevocationTombstone | null;
  readonly consumerInstallId: string;
  readonly now?: Date;
}

export type ReadConsentEnforcementResult =
  | { readonly ok: true; readonly grantId: string }
  | { readonly ok: false; readonly reason: string };

export function enforceReadConsent(
  options: EnforceReadConsentOptions,
): ReadConsentEnforcementResult {
  if (!options.grant) {
    return { ok: false, reason: "Missing consent grant" };
  }

  const verification = verifyConsentGrant(options.grant);
  if (!verification.ok) {
    return { ok: false, reason: verification.reason };
  }

  const payload = options.grant.signedPayload;
  if (payload.tenant !== options.ko.signedPayload.tenant) {
    return { ok: false, reason: "Consent grant tenant does not match KO" };
  }

  if (payload.koId !== options.ko.id) {
    return { ok: false, reason: "Consent grant KO id does not match" };
  }

  if (payload.koContentHash !== options.ko.signedPayload.contentHash) {
    return { ok: false, reason: "Consent grant KO hash does not match" };
  }

  if (payload.producerInstallId !== options.ko.signedPayload.creatorInstallId) {
    return { ok: false, reason: "Consent grant producer does not match KO creator" };
  }

  if (payload.consumerInstallId !== options.consumerInstallId) {
    return { ok: false, reason: "Consent grant consumer does not match this install" };
  }

  const expiry = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiry)) {
    return { ok: false, reason: "Consent grant expiry is invalid" };
  }

  if (expiry <= (options.now ?? new Date()).getTime()) {
    return { ok: false, reason: "Consent grant is expired" };
  }

  if (options.revocation) {
    const revocationVerification = verifyRevocationTombstone(options.revocation);
    if (!revocationVerification.ok) {
      return { ok: false, reason: revocationVerification.reason };
    }

    const tombstone = options.revocation.signedPayload;
    if (tombstone.tenant !== options.ko.signedPayload.tenant) {
      return { ok: false, reason: "Revocation tombstone tenant does not match KO" };
    }

    if (tombstone.koId !== options.ko.id) {
      return { ok: false, reason: "Revocation tombstone KO id does not match" };
    }

    if (tombstone.koContentHash !== options.ko.signedPayload.contentHash) {
      return { ok: false, reason: "Revocation tombstone KO hash does not match" };
    }

    if (tombstone.issuerInstallId !== payload.producerInstallId) {
      return { ok: false, reason: "Revocation tombstone issuer does not match grant producer" };
    }

    if (tombstone.revokedGrantId && tombstone.revokedGrantId !== options.grant.id) {
      return { ok: false, reason: "Revocation tombstone grant does not match consent grant" };
    }

    return { ok: false, reason: "Consent grant has been revoked" };
  }

  return { ok: true, grantId: options.grant.id };
}
