import type { DashboardWidget } from "./dashboard-content.js";

export type AdapterOutputKind = "dashboard" | "report" | "table" | "referral_packet";

export interface AdapterDashboardOutput {
  readonly title?: string;
  readonly summary?: string;
  readonly widgets: readonly DashboardWidget[];
  readonly notes?: readonly string[];
}

export interface AdapterReportOutput {
  readonly title?: string;
  readonly summary: string;
  readonly sections?: readonly AdapterReportSection[];
  readonly notes?: readonly string[];
}

export interface AdapterReportSection {
  readonly heading: string;
  readonly body: string;
}

export interface AdapterTableOutput {
  readonly title?: string;
  readonly summary?: string;
  readonly columns: readonly string[];
  readonly rows: readonly AdapterTableRow[];
  readonly notes?: readonly string[];
}

export interface AdapterReferralPacketOutput {
  readonly title?: string;
  readonly patientReference: string;
  readonly referralReason: string;
  readonly clinicalSummary: string;
  readonly labSnapshot: string;
  readonly medications: readonly string[];
  readonly imagingStatus: string;
  readonly consent: {
    readonly expiresAt: string;
    readonly revocationReason: string;
  };
  readonly attachments?: readonly AdapterReferralAttachment[];
  readonly notes?: readonly string[];
}

export interface AdapterReferralAttachment {
  readonly label: string;
  readonly status: string;
}

export type AdapterTableCell = string | number | boolean | null;
export type AdapterTableRow = Readonly<Record<string, AdapterTableCell>>;

export type ParsedAdapterOutput =
  | AdapterDashboardOutput
  | AdapterReportOutput
  | AdapterTableOutput
  | AdapterReferralPacketOutput;

export function parseAdapterOutput(raw: string, kind: AdapterOutputKind): ParsedAdapterOutput {
  if (kind === "dashboard") return parseAdapterDashboardOutput(raw);
  if (kind === "report") return parseAdapterReportOutput(raw);
  if (kind === "table") return parseAdapterTableOutput(raw);
  return parseAdapterReferralPacketOutput(raw);
}

export function parseAdapterDashboardOutput(raw: string): AdapterDashboardOutput {
  const parsed = parseAdapterJsonObject(raw, "dashboard");

  const widgets = parsed.widgets;
  if (!Array.isArray(widgets) || widgets.length === 0) {
    throw new Error("Adapter dashboard output must include a non-empty widgets array.");
  }

  return {
    ...(typeof parsed.title === "string" && parsed.title.trim() ? { title: parsed.title.trim() } : {}),
    ...(typeof parsed.summary === "string" && parsed.summary.trim() ? { summary: parsed.summary.trim() } : {}),
    widgets: widgets.map((widget, index) => parseAdapterWidget(widget, index)),
    ...(parsed.notes === undefined ? {} : { notes: parseAdapterNotes(parsed.notes) }),
  };
}

export function parseAdapterReportOutput(raw: string): AdapterReportOutput {
  const parsed = parseAdapterJsonObject(raw, "report");
  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
    throw new Error("Adapter report output must include a non-empty summary.");
  }

  return {
    ...(typeof parsed.title === "string" && parsed.title.trim() ? { title: parsed.title.trim() } : {}),
    summary: parsed.summary.trim(),
    ...(parsed.sections === undefined ? {} : { sections: parseAdapterReportSections(parsed.sections) }),
    ...(parsed.notes === undefined ? {} : { notes: parseAdapterNotes(parsed.notes) }),
  };
}

export function parseAdapterTableOutput(raw: string): AdapterTableOutput {
  const parsed = parseAdapterJsonObject(raw, "table");
  if (!Array.isArray(parsed.columns) || parsed.columns.length === 0) {
    throw new Error("Adapter table output must include a non-empty columns array.");
  }
  if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
    throw new Error("Adapter table output must include a non-empty rows array.");
  }

  const columns = parsed.columns.map((column, index) => {
    if (typeof column !== "string" || !column.trim()) {
      throw new Error(`Adapter table output column ${index + 1} must be a non-empty string.`);
    }
    return column.trim();
  });

  return {
    ...(typeof parsed.title === "string" && parsed.title.trim() ? { title: parsed.title.trim() } : {}),
    ...(typeof parsed.summary === "string" && parsed.summary.trim() ? { summary: parsed.summary.trim() } : {}),
    columns,
    rows: parsed.rows.map((row, index) => parseAdapterTableRow(row, index, columns)),
    ...(parsed.notes === undefined ? {} : { notes: parseAdapterNotes(parsed.notes) }),
  };
}

export function parseAdapterReferralPacketOutput(raw: string): AdapterReferralPacketOutput {
  const parsed = parseAdapterJsonObject(raw, "referral_packet");
  return {
    ...(typeof parsed.title === "string" && parsed.title.trim() ? { title: parsed.title.trim() } : {}),
    patientReference: requiredString(parsed.patientReference, "Adapter referral packet output patientReference"),
    referralReason: requiredString(parsed.referralReason, "Adapter referral packet output referralReason"),
    clinicalSummary: requiredString(parsed.clinicalSummary, "Adapter referral packet output clinicalSummary"),
    labSnapshot: requiredString(parsed.labSnapshot, "Adapter referral packet output labSnapshot"),
    medications: parseStringArray(parsed.medications, "Adapter referral packet output medications"),
    imagingStatus: requiredString(parsed.imagingStatus, "Adapter referral packet output imagingStatus"),
    consent: parseReferralConsent(parsed.consent),
    ...(parsed.attachments === undefined ? {} : { attachments: parseReferralAttachments(parsed.attachments) }),
    ...(parsed.notes === undefined ? {} : { notes: parseAdapterNotes(parsed.notes) }),
  };
}

function parseAdapterWidget(value: unknown, index: number): DashboardWidget {
  if (!isRecord(value)) {
    throw new Error(`Adapter dashboard widget ${index + 1} must be an object.`);
  }
  if (!isWidgetKind(value.kind)) {
    throw new Error(`Adapter dashboard widget ${index + 1} has an unsupported kind.`);
  }
  if (typeof value.label !== "string" || !value.label.trim()) {
    throw new Error(`Adapter dashboard widget ${index + 1} must include a label.`);
  }
  if (typeof value.value !== "string" && typeof value.value !== "number") {
    throw new Error(`Adapter dashboard widget ${index + 1} must include a string or number value.`);
  }

  return {
    kind: value.kind,
    label: value.label.trim(),
    value: value.value,
  };
}

function parseAdapterNotes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error("Adapter dashboard output notes must be an array of strings.");
  }
  return value.map((note, index) => {
    if (typeof note !== "string" || !note.trim()) {
      throw new Error(`Adapter dashboard output note ${index + 1} must be a non-empty string.`);
    }
    return note.trim();
  });
}

function parseAdapterReportSections(value: unknown): readonly AdapterReportSection[] {
  if (!Array.isArray(value)) {
    throw new Error("Adapter report output sections must be an array.");
  }
  return value.map((section, index) => {
    if (!isRecord(section)) {
      throw new Error(`Adapter report section ${index + 1} must be an object.`);
    }
    if (typeof section.heading !== "string" || !section.heading.trim()) {
      throw new Error(`Adapter report section ${index + 1} must include a heading.`);
    }
    if (typeof section.body !== "string" || !section.body.trim()) {
      throw new Error(`Adapter report section ${index + 1} must include a body.`);
    }
    return {
      heading: section.heading.trim(),
      body: section.body.trim(),
    };
  });
}

function parseAdapterTableRow(value: unknown, index: number, columns: readonly string[]): AdapterTableRow {
  if (!isRecord(value)) {
    throw new Error(`Adapter table output row ${index + 1} must be an object.`);
  }
  const row: Record<string, AdapterTableCell> = {};
  for (const column of columns) {
    const cell = value[column];
    if (!isTableCell(cell)) {
      throw new Error(`Adapter table output row ${index + 1} column "${column}" has an unsupported value.`);
    }
    row[column] = cell;
  }
  return row;
}

function parseReferralConsent(value: unknown): AdapterReferralPacketOutput["consent"] {
  if (!isRecord(value)) {
    throw new Error("Adapter referral packet output consent must be an object.");
  }
  const expiresAt = requiredString(value.expiresAt, "Adapter referral packet output consent.expiresAt");
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new Error("Adapter referral packet output consent.expiresAt must be an ISO timestamp.");
  }
  return {
    expiresAt,
    revocationReason: requiredString(value.revocationReason, "Adapter referral packet output consent.revocationReason"),
  };
}

function parseReferralAttachments(value: unknown): readonly AdapterReferralAttachment[] {
  if (!Array.isArray(value)) {
    throw new Error("Adapter referral packet output attachments must be an array.");
  }
  return value.map((attachment, index) => {
    if (!isRecord(attachment)) {
      throw new Error(`Adapter referral packet attachment ${index + 1} must be an object.`);
    }
    return {
      label: requiredString(attachment.label, `Adapter referral packet attachment ${index + 1} label`),
      status: requiredString(attachment.status, `Adapter referral packet attachment ${index + 1} status`),
    };
  });
}

function parseStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array of strings.`);
  }
  return value.map((entry, index) => requiredString(entry, `${label} item ${index + 1}`));
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function isTableCell(value: unknown): value is AdapterTableCell {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function parseAdapterJsonObject(raw: string, kind: AdapterOutputKind): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Adapter ${kind} output must be valid JSON.`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Adapter ${kind} output must be a JSON object.`);
  }
  return parsed;
}

function isWidgetKind(value: unknown): value is DashboardWidget["kind"] {
  return value === "metric" || value === "risk" || value === "trend";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
