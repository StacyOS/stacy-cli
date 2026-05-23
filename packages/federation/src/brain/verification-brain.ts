import type { DashboardSchema } from "../dashboard/dashboard-content.js";
import { ensureInstallIdentity } from "../identity/install-identity.js";
import { appendReceipt } from "../receipts/receipt-store.js";
import {
  createVerificationReportContent,
  VERIFICATION_REPORT_CONTENT_TYPE,
  type VerificationReportContent,
} from "../verification/verification-report.js";
import {
  readKnowledgeObject,
  type BrainDb,
} from "./brain-store.js";
import {
  createLocalKnowledgeObject,
  type CreateLocalKnowledgeObjectResult,
} from "./local-brain.js";

export interface CreateVerificationKnowledgeObjectOptions {
  readonly db: BrainDb;
  readonly identityPath: string;
  readonly sourceKoId: string;
  readonly input?: {
    readonly path: string;
    readonly raw: string;
  };
  readonly schema?: DashboardSchema;
  readonly createdAt?: Date;
  readonly storedAt?: Date;
  readonly idGenerator?: () => string;
}

export interface CreateVerificationKnowledgeObjectResult extends CreateLocalKnowledgeObjectResult {
  readonly sourceKoId: string;
  readonly sourceContentHash: string;
  readonly sourceProducerInstallId: string;
  readonly report: VerificationReportContent;
}

export async function createVerificationKnowledgeObject(
  options: CreateVerificationKnowledgeObjectOptions,
): Promise<CreateVerificationKnowledgeObjectResult> {
  const createdAt = options.createdAt ?? new Date();
  const identity = await ensureInstallIdentity({
    path: options.identityPath,
    now: createdAt,
  });
  const source = await readKnowledgeObject({ db: options.db, koId: options.sourceKoId });
  if (!source.ok) {
    throw new Error(source.reason);
  }

  const report = createVerificationReportContent({
    sourceKo: source.ko,
    verifierInstallId: identity.record.installId,
    createdAt,
    input: options.input,
    schema: options.schema,
  });

  const verification = await createLocalKnowledgeObject({
    db: options.db,
    identityPath: options.identityPath,
    tenant: source.ko.signedPayload.tenant,
    contentType: VERIFICATION_REPORT_CONTENT_TYPE,
    content: report,
    createdAt,
    storedAt: options.storedAt ?? createdAt,
    idGenerator: options.idGenerator,
  });

  await appendReceipt({
    db: options.db,
    eventType: "verify",
    tenant: source.ko.signedPayload.tenant,
    koId: source.ko.id,
    actorInstallId: identity.record.installId,
    counterpartyInstallId: source.ko.signedPayload.creatorInstallId,
    payload: {
      verificationKoId: verification.ko.id,
      verificationContentHash: verification.contentHash,
      verdict: report.verdict,
      failedChecks: report.checks.filter((check) => check.status === "fail").map((check) => check.id),
      warningChecks: report.checks.filter((check) => check.status === "warn").map((check) => check.id),
    },
    createdAt,
  });

  return {
    ...verification,
    sourceKoId: source.ko.id,
    sourceContentHash: source.ko.signedPayload.contentHash,
    sourceProducerInstallId: source.ko.signedPayload.creatorInstallId,
    report,
  };
}
