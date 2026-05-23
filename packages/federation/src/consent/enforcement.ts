import type { SignedKnowledgeObject } from "../ko/knowledge-object.js";
import {
  consentGrantScopeIncludesRead,
  consentGrantScopeIncludesWrite,
  type SignedConsentGrant,
  verifyConsentGrant,
} from "./grant.js";
import {
  groupRosterIncludesInstall,
  type SignedGroupRoster,
  verifyGroupRoster,
} from "./group-roster.js";
import {
  type SignedRevocationTombstone,
  verifyRevocationTombstone,
} from "./revocation.js";
import {
  enforceWitnessRevocationPolicy,
  type SignedWitnessedRevocation,
  type WitnessRevocationPolicy,
} from "./witnessed-revocation.js";

export interface EnforceReadConsentOptions {
  readonly ko: SignedKnowledgeObject;
  readonly grant: SignedConsentGrant | null;
  readonly revocation?: SignedRevocationTombstone | null;
  readonly witnessedRevocations?: readonly SignedWitnessedRevocation[];
  readonly revocationPolicy?: WitnessRevocationPolicy;
  readonly consumerInstallId: string;
  readonly groupRosters?: readonly SignedGroupRoster[];
  readonly now?: Date;
}

export type ReadConsentEnforcementResult =
  | { readonly ok: true; readonly grantId: string }
  | { readonly ok: false; readonly reason: string };

export type WriteConsentEnforcementResult =
  | { readonly ok: true; readonly grantId: string }
  | { readonly ok: false; readonly reason: string };

export function enforceReadConsent(
  options: EnforceReadConsentOptions,
): ReadConsentEnforcementResult {
  const coverage = enforceConsentCoverage(options);
  if (!coverage.ok) return coverage;

  if (!consentGrantScopeIncludesRead(coverage.grant.signedPayload.scope)) {
    return { ok: false, reason: "Consent grant does not include read scope" };
  }

  return { ok: true, grantId: coverage.grant.id };
}

export function enforceWriteConsent(
  options: EnforceReadConsentOptions,
): WriteConsentEnforcementResult {
  const coverage = enforceConsentCoverage(options);
  if (!coverage.ok) return coverage;

  if (!consentGrantScopeIncludesWrite(coverage.grant.signedPayload.scope)) {
    return { ok: false, reason: "Consent grant does not include write scope" };
  }

  return { ok: true, grantId: coverage.grant.id };
}

function enforceConsentCoverage(
  options: EnforceReadConsentOptions,
):
  | { readonly ok: true; readonly grant: SignedConsentGrant }
  | { readonly ok: false; readonly reason: string } {
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

  const recipient = payload.recipient ?? { type: "install" as const, id: payload.consumerInstallId };
  if (recipient.type === "install") {
    if (recipient.id !== options.consumerInstallId || payload.consumerInstallId !== options.consumerInstallId) {
      return { ok: false, reason: "Consent grant consumer does not match this install" };
    }
  } else if (recipient.type === "group") {
    if (payload.consumerInstallId !== recipient.id) {
      return { ok: false, reason: "Consent grant group recipient does not match legacy consumer field" };
    }
    const roster = options.groupRosters?.find((candidate) => candidate.signedPayload.groupId === recipient.id);
    if (!roster) {
      return { ok: false, reason: "Missing group roster for consent grant" };
    }
    const rosterVerification = verifyGroupRoster(roster);
    if (!rosterVerification.ok) {
      return { ok: false, reason: rosterVerification.reason };
    }
    if (roster.signedPayload.tenant !== payload.tenant) {
      return { ok: false, reason: "Group roster tenant does not match consent grant" };
    }
    if (roster.signer.installId !== payload.producerInstallId) {
      return { ok: false, reason: "Group roster signer does not match grant producer" };
    }
    if (!groupRosterIncludesInstall(roster, options.consumerInstallId, recipient.role)) {
      return { ok: false, reason: "Consumer not in producer's latest group roster" };
    }
  } else {
    return { ok: false, reason: "Consent grant recipient type is unsupported" };
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

    const witnessPolicy = options.revocationPolicy ?? { mode: "producer_only" as const };
    const witnessEnforcement = enforceWitnessRevocationPolicy({
      tombstone: options.revocation,
      witnesses: options.witnessedRevocations ?? [],
      policy: witnessPolicy,
    });
    if (!witnessEnforcement.ok) {
      return { ok: false, reason: witnessEnforcement.reason };
    }

    return { ok: false, reason: "Consent grant has been revoked" };
  }

  return { ok: true, grant: options.grant };
}
