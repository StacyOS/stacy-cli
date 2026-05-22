import {
  readKnowledgeObject,
  type BrainDb,
  type ReadKnowledgeObjectResult,
} from "./brain-store.js";
import { enforceReadConsent } from "../consent/enforcement.js";
import { readConsentGrant } from "../consent/grant-store.js";
import { readRevocationTombstone } from "../consent/revocation-store.js";
import { appendReceipt } from "../receipts/receipt-store.js";

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

  const grant = await readConsentGrant({
    db: options.db,
    koId: read.ko.id,
    consumerInstallId: options.consumerInstallId,
  });
  const revocation = await readRevocationTombstone({
    db: options.db,
    koId: read.ko.id,
    grantId: grant?.id,
  });
  const consent = enforceReadConsent({
    ko: read.ko,
    grant,
    revocation,
    consumerInstallId: options.consumerInstallId,
    now: options.now,
  });

  if (!consent.ok) {
    await appendReceipt({
      db: options.db,
      eventType: "deny",
      tenant: read.ko.signedPayload.tenant,
      koId: read.ko.id,
      actorInstallId: options.consumerInstallId,
      counterpartyInstallId: read.ko.signedPayload.creatorInstallId,
      payload: {
        reason: consent.reason,
        grantId: grant?.id,
      },
      createdAt: options.now,
    });
    return { ok: false, reason: consent.reason };
  }

  await appendReceipt({
    db: options.db,
    eventType: "read",
    tenant: read.ko.signedPayload.tenant,
    koId: read.ko.id,
    actorInstallId: options.consumerInstallId,
    counterpartyInstallId: read.ko.signedPayload.creatorInstallId,
    payload: {
      grantId: consent.grantId,
    },
    createdAt: options.now,
  });
  return read;
}
