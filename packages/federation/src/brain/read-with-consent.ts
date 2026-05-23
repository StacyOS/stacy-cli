import {
  readKnowledgeObject,
  type BrainDb,
  type ReadKnowledgeObjectResult,
} from "./brain-store.js";
import { enforceReadConsent } from "../consent/enforcement.js";
import { listConsentGrantsForKo, readConsentGrant } from "../consent/grant-store.js";
import { readGroupRoster } from "../consent/group-roster-store.js";
import { readRevocationTombstone } from "../consent/revocation-store.js";
import { appendReceipt } from "../receipts/receipt-store.js";
import type { SignedConsentGrant } from "../consent/grant.js";

export interface ReadKnowledgeObjectWithConsentOptions {
  readonly db: BrainDb;
  readonly koId: string;
  readonly consumerInstallId: string;
  readonly now?: Date;
}

export async function readKnowledgeObjectWithConsent(
  options: ReadKnowledgeObjectWithConsentOptions,
): Promise<ReadKnowledgeObjectResult> {
  const read = await readKnowledgeObject({ db: options.db, koId: options.koId });
  if (!read.ok) {
    return read;
  }

  if (read.provenance.source === "local") {
    return read;
  }

  const directGrant = await readConsentGrant({
    db: options.db,
    koId: read.ko.id,
    consumerInstallId: options.consumerInstallId,
  });
  const candidateGrants = directGrant
    ? [directGrant]
    : await listConsentGrantsForKo({ db: options.db, koId: read.ko.id });

  const evaluated = await findAllowedConsent({
    db: options.db,
    ko: read,
    grants: candidateGrants,
    consumerInstallId: options.consumerInstallId,
    now: options.now,
  });

  if (!evaluated.ok) {
    await appendReceipt({
      db: options.db,
      eventType: "deny",
      tenant: read.ko.signedPayload.tenant,
      koId: read.ko.id,
      actorInstallId: options.consumerInstallId,
      counterpartyInstallId: read.ko.signedPayload.creatorInstallId,
      payload: {
        reason: evaluated.reason,
        grantId: evaluated.grant?.id,
      },
      createdAt: options.now,
    });
    return { ok: false, reason: evaluated.reason };
  }

  await appendReceipt({
    db: options.db,
    eventType: "read",
    tenant: read.ko.signedPayload.tenant,
    koId: read.ko.id,
    actorInstallId: options.consumerInstallId,
    counterpartyInstallId: read.ko.signedPayload.creatorInstallId,
    payload: {
      grantId: evaluated.grantId,
    },
    createdAt: options.now,
  });
  return {
    ...read,
    consent: {
      grantId: evaluated.grantId,
      recipient: evaluated.grant.signedPayload.recipient,
    },
  };
}

async function findAllowedConsent(options: {
  readonly db: BrainDb;
  readonly ko: Extract<ReadKnowledgeObjectResult, { ok: true }>;
  readonly grants: readonly SignedConsentGrant[];
  readonly consumerInstallId: string;
  readonly now?: Date;
}): Promise<
  | { readonly ok: true; readonly grantId: string; readonly grant: SignedConsentGrant }
  | { readonly ok: false; readonly reason: string; readonly grant?: SignedConsentGrant }
> {
  if (options.grants.length === 0) {
    return { ok: false, reason: "Missing consent grant" };
  }

  let lastDenied: { readonly reason: string; readonly grant?: SignedConsentGrant } = {
    reason: "Missing consent grant",
  };
  for (const grant of options.grants) {
    const roster = grant.signedPayload.recipient?.type === "group"
      ? await readGroupRoster({ db: options.db, groupId: grant.signedPayload.recipient.id })
      : null;
    const revocation = await readRevocationTombstone({
      db: options.db,
      koId: options.ko.ko.id,
      grantId: grant.id,
    });
    const consent = enforceReadConsent({
      ko: options.ko.ko,
      grant,
      revocation,
      consumerInstallId: options.consumerInstallId,
      groupRosters: roster ? [roster] : [],
      now: options.now,
    });
    if (consent.ok) {
      return { ok: true, grantId: consent.grantId, grant };
    }
    lastDenied = { reason: consent.reason, grant };
  }
  return { ok: false, ...lastDenied };
}
