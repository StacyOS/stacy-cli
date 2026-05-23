import type { CanonicalJsonValue } from "../crypto/canonical.js";
import { canonicalize } from "../crypto/canonical.js";
import {
  createDeterministicDashboardContent,
  parseCsvDashboardInput,
  type DashboardContent,
  type DashboardSchema,
} from "../dashboard/dashboard-content.js";
import type { SignedKnowledgeObject } from "../ko/knowledge-object.js";

export const VERIFICATION_REPORT_SCHEMA_VERSION = 1;
export const VERIFICATION_REPORT_CONTENT_TYPE = "application/vnd.stacy.verification-report+json";

export type VerificationCheckStatus = "pass" | "fail" | "warn";
export type VerificationVerdict = "pass" | "fail";

export interface VerificationCheck {
  readonly id: string;
  readonly status: VerificationCheckStatus;
  readonly summary: string;
  readonly details?: Record<string, CanonicalJsonValue>;
}

export interface VerificationReportContent {
  readonly kind: "verification_report";
  readonly schemaVersion: typeof VERIFICATION_REPORT_SCHEMA_VERSION;
  readonly source: {
    readonly koId: string;
    readonly koContentHash: string;
    readonly producerInstallId: string;
    readonly contentType: string;
  };
  readonly verifierInstallId: string;
  readonly verdict: VerificationVerdict;
  readonly checks: readonly VerificationCheck[];
  readonly createdAt: string;
}

export interface CreateVerificationReportOptions {
  readonly sourceKo: SignedKnowledgeObject;
  readonly verifierInstallId: string;
  readonly createdAt: Date;
  readonly input?: {
    readonly path: string;
    readonly raw: string;
  };
  readonly schema?: DashboardSchema;
}

export function createVerificationReportContent(
  options: CreateVerificationReportOptions,
): VerificationReportContent & CanonicalJsonValue {
  const checks = [
    createSignatureContextCheck(options.sourceKo),
    ...createContentChecks(options),
  ];
  const verdict: VerificationVerdict = checks.some((check) => check.status === "fail") ? "fail" : "pass";

  return {
    kind: "verification_report",
    schemaVersion: VERIFICATION_REPORT_SCHEMA_VERSION,
    source: {
      koId: options.sourceKo.id,
      koContentHash: options.sourceKo.signedPayload.contentHash,
      producerInstallId: options.sourceKo.signedPayload.creatorInstallId,
      contentType: options.sourceKo.signedPayload.contentType,
    },
    verifierInstallId: options.verifierInstallId,
    verdict,
    checks,
    createdAt: options.createdAt.toISOString(),
  } as unknown as VerificationReportContent & CanonicalJsonValue;
}

function createSignatureContextCheck(ko: SignedKnowledgeObject): VerificationCheck {
  return {
    id: "signed_ko_verified",
    status: "pass",
    summary: "Source KO signature and content hash verified before report creation.",
    details: {
      koId: ko.id,
      contentHash: ko.signedPayload.contentHash,
      signerInstallId: ko.signer.installId,
    },
  };
}

function createContentChecks(options: CreateVerificationReportOptions): readonly VerificationCheck[] {
  const content = options.sourceKo.signedPayload.content;
  if (!isRecord(content)) {
    return [{
      id: "content_contract",
      status: "fail",
      summary: "KO content is not a JSON object.",
    }];
  }

  if (content.kind === "dashboard") {
    return createDashboardChecks(content, options);
  }

  if (content.kind === "report") {
    return createReportChecks(content);
  }

  if (content.kind === "table") {
    return createTableChecks(content);
  }

  return [{
    id: "content_contract",
    status: "warn",
    summary: "No specialized verifier is registered for this KO content kind.",
    details: {
      kind: typeof content.kind === "string" ? content.kind : "unknown",
    },
  }];
}

function createDashboardChecks(
  content: Record<string, unknown>,
  options: CreateVerificationReportOptions,
): readonly VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const widgets = Array.isArray(content.widgets) ? content.widgets : [];
  checks.push({
    id: "dashboard_contract",
    status: typeof content.title === "string" && typeof content.summary === "string" && widgets.length > 0
      ? "pass"
      : "fail",
    summary: "Dashboard content has title, summary, and at least one widget.",
    details: { widgetCount: widgets.length },
  });

  const inputMeta = isRecord(content.input) ? content.input : null;
  if (!options.input) {
    checks.push({
      id: "source_input_reconciled",
      status: "warn",
      summary: "No source input was provided, so file hash and row-count reconciliation were skipped.",
    });
    return checks;
  }

  const parsedInput = parseCsvDashboardInput(options.input.path, options.input.raw);
  const hashMatches = inputMeta?.contentHash === parsedInput.contentHash;
  const rowCountMatches = inputMeta?.rows === parsedInput.rows;
  const fileNameMatches = inputMeta?.fileName === parsedInput.fileName;
  checks.push({
    id: "source_input_reconciled",
    status: hashMatches && rowCountMatches && fileNameMatches ? "pass" : "fail",
    summary: "Dashboard source metadata matches the supplied input file.",
    details: {
      expectedFileName: parsedInput.fileName,
      actualFileName: stringDetail(inputMeta?.fileName),
      expectedContentHash: parsedInput.contentHash,
      actualContentHash: stringDetail(inputMeta?.contentHash),
      expectedRows: parsedInput.rows,
      actualRows: numberDetail(inputMeta?.rows),
    },
  });

  if (options.schema) {
    const deterministic = createDeterministicDashboardContent({
      task: typeof content.task === "string" ? content.task : "verify dashboard",
      input: parsedInput,
      schema: options.schema,
    });
    checks.push({
      id: "deterministic_reconciliation",
      status: canonicalize((content as unknown as DashboardContent).widgets) === canonicalize(deterministic.widgets)
        ? "pass"
        : "warn",
      summary: "Dashboard widgets were reconciled against deterministic CSV/schema aggregation.",
      details: {
        expectedWidgets: deterministic.widgets as unknown as CanonicalJsonValue,
        actualWidgets: widgets as unknown as CanonicalJsonValue,
      },
    });
  }

  return checks;
}

function createReportChecks(content: Record<string, unknown>): readonly VerificationCheck[] {
  const sections = Array.isArray(content.sections) ? content.sections : [];
  return [{
    id: "report_contract",
    status: typeof content.title === "string" && typeof content.summary === "string" && sections.length > 0
      ? "pass"
      : "fail",
    summary: "Report content has title, summary, and at least one section.",
    details: { sectionCount: sections.length },
  }];
}

function createTableChecks(content: Record<string, unknown>): readonly VerificationCheck[] {
  const columns = Array.isArray(content.columns) ? content.columns : [];
  const rows = Array.isArray(content.rows) ? content.rows : [];
  return [{
    id: "table_contract",
    status: typeof content.title === "string" && columns.length > 0 && Array.isArray(content.rows)
      ? "pass"
      : "fail",
    summary: "Table content has title, columns, and rows.",
    details: { columnCount: columns.length, rowCount: rows.length },
  }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringDetail(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberDetail(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}
