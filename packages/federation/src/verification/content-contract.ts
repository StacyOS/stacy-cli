import type { CanonicalJsonValue } from "../crypto/canonical.js";

export const CONTENT_CONTRACT_COMPATIBILITY = {
  dashboard: [1],
  report: [1],
  table: [1],
  referral_packet: [1, 2],
} as const;

export type ContentContractKind = keyof typeof CONTENT_CONTRACT_COMPATIBILITY;
export type ContentContractCompatibility = {
  readonly [Kind in ContentContractKind]: readonly number[];
};

export interface ContentContractValidation {
  readonly kind: string;
  readonly schemaVersion: number;
  readonly supportedVersions: readonly number[];
  readonly valid: boolean;
  readonly reason?: string;
  readonly details?: Record<string, CanonicalJsonValue>;
}

export function validateKnowledgeContentContract(content: unknown): ContentContractValidation {
  return validateKnowledgeContentContractWithCompatibility(content, CONTENT_CONTRACT_COMPATIBILITY);
}

export function validateKnowledgeContentContractWithCompatibility(
  content: unknown,
  compatibility: ContentContractCompatibility,
): ContentContractValidation {
  if (!isRecord(content)) {
    return {
      kind: "unknown",
      schemaVersion: -1,
      supportedVersions: [],
      valid: false,
      reason: "KO content is not a JSON object.",
    };
  }

  const kind = typeof content.kind === "string" ? content.kind : "unknown";
  if (!isContentContractKind(kind)) {
    return {
      kind,
      schemaVersion: versionFromContent(content),
      supportedVersions: [],
      valid: false,
      reason: `No content contract is registered for kind "${kind}".`,
    };
  }

  const schemaVersion = versionFromContent(content);
  const supportedVersions = compatibility[kind];
  if (!supportedVersions.includes(schemaVersion as never)) {
    return {
      kind,
      schemaVersion,
      supportedVersions,
      valid: false,
      reason: `Unsupported ${kind} schema version ${schemaVersion}.`,
    };
  }

  if (kind === "dashboard") return validateDashboard(content, schemaVersion, supportedVersions);
  if (kind === "report") return validateReport(content, schemaVersion, supportedVersions);
  if (kind === "table") return validateTable(content, schemaVersion, supportedVersions);
  return validateReferralPacket(content, schemaVersion, supportedVersions);
}

function validateDashboard(
  content: Record<string, unknown>,
  schemaVersion: number,
  supportedVersions: readonly number[],
): ContentContractValidation {
  const widgets = Array.isArray(content.widgets) ? content.widgets : [];
  return {
    kind: "dashboard",
    schemaVersion,
    supportedVersions,
    valid: typeof content.title === "string" && typeof content.summary === "string" && widgets.length > 0,
    reason: widgets.length > 0 ? undefined : "Dashboard content must include at least one widget.",
    details: { widgetCount: widgets.length },
  };
}

function validateReport(
  content: Record<string, unknown>,
  schemaVersion: number,
  supportedVersions: readonly number[],
): ContentContractValidation {
  const sections = Array.isArray(content.sections) ? content.sections : [];
  return {
    kind: "report",
    schemaVersion,
    supportedVersions,
    valid: typeof content.title === "string" && typeof content.summary === "string" && sections.length > 0,
    reason: sections.length > 0 ? undefined : "Report content must include at least one section.",
    details: { sectionCount: sections.length },
  };
}

function validateTable(
  content: Record<string, unknown>,
  schemaVersion: number,
  supportedVersions: readonly number[],
): ContentContractValidation {
  const columns = Array.isArray(content.columns) ? content.columns : [];
  const rows = Array.isArray(content.rows) ? content.rows : [];
  return {
    kind: "table",
    schemaVersion,
    supportedVersions,
    valid: typeof content.title === "string" && columns.length > 0 && Array.isArray(content.rows),
    reason: columns.length > 0 ? undefined : "Table content must include at least one column.",
    details: { columnCount: columns.length, rowCount: rows.length },
  };
}

function validateReferralPacket(
  content: Record<string, unknown>,
  schemaVersion: number,
  supportedVersions: readonly number[],
): ContentContractValidation {
  const required = [
    "patientReference",
    "referralReason",
    "clinicalSummary",
    "labSnapshot",
    "imagingStatus",
  ];
  const missing = required.filter((key) => typeof content[key] !== "string" || !String(content[key]).trim());
  const consent = isRecord(content.consent) ? content.consent : {};
  if (typeof consent.expiresAt !== "string" || !Number.isFinite(Date.parse(consent.expiresAt))) {
    missing.push("consent.expiresAt");
  }
  if (typeof consent.revocationReason !== "string" || !consent.revocationReason.trim()) {
    missing.push("consent.revocationReason");
  }
  if (!Array.isArray(content.medications) || content.medications.length === 0) {
    missing.push("medications");
  }

  return {
    kind: "referral_packet",
    schemaVersion,
    supportedVersions,
    valid: missing.length === 0,
    reason: missing.length === 0 ? undefined : `Referral packet is missing required fields: ${missing.join(", ")}.`,
    details: {
      missingFields: missing as unknown as CanonicalJsonValue,
      attachmentCount: Array.isArray(content.attachments) ? content.attachments.length : 0,
      hasCarePriority: typeof content.carePriority === "string",
    },
  };
}

function versionFromContent(content: Record<string, unknown>): number {
  if (content.schemaVersion === undefined && typeof content.kind === "string" && content.kind !== "referral_packet") {
    return 1;
  }
  return typeof content.schemaVersion === "number" && Number.isInteger(content.schemaVersion)
    ? content.schemaVersion
    : -1;
}

function isContentContractKind(kind: string): kind is ContentContractKind {
  return kind === "dashboard" || kind === "report" || kind === "table" || kind === "referral_packet";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
