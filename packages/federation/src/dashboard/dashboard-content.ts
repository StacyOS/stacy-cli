import { basename } from "node:path";

import type { CanonicalJsonValue } from "../crypto/canonical.js";
import { sha256Hex } from "../util/hash.js";
import type { AdapterDashboardOutput, AdapterReportOutput, AdapterTableOutput } from "./adapter-output.js";

export interface DashboardInput {
  readonly fileName: string;
  readonly contentHash: string;
  readonly rows: number;
  readonly columns: readonly string[];
  readonly records: readonly Record<string, string>[];
}

export interface DashboardContent {
  readonly kind: "dashboard";
  readonly title: string;
  readonly task: string;
  readonly input: {
    readonly fileName: string;
    readonly contentHash: string;
    readonly rows: number;
  };
  readonly widgets: readonly DashboardWidget[];
  readonly summary: string;
  readonly generator: "adapter_command" | "deterministic_dashboard";
  readonly generatedAt: string;
  readonly adapterOutput?: string;
  readonly adapterNotes?: readonly string[];
  readonly redactedColumns?: readonly string[];
}

export interface DashboardSchema {
  readonly title?: string;
  readonly widgets: readonly DashboardSchemaWidget[];
}

export interface DashboardSchemaWidget {
  readonly kind?: "metric" | "risk" | "trend";
  readonly label: string;
  readonly column: string;
  readonly aggregate: "sum" | "average" | "last" | "count";
  readonly format?: "currency" | "number" | "percent";
}

export interface DashboardWidget {
  readonly kind: "metric" | "risk" | "trend";
  readonly label: string;
  readonly value: string | number;
}

export interface ReportContent {
  readonly kind: "report";
  readonly title: string;
  readonly task: string;
  readonly input: {
    readonly fileName: string;
    readonly contentHash: string;
    readonly rows: number;
  };
  readonly summary: string;
  readonly sections: readonly ReportSection[];
  readonly generator: "adapter_command" | "deterministic_report";
  readonly generatedAt: string;
  readonly adapterNotes?: readonly string[];
  readonly redactedColumns?: readonly string[];
}

export interface ReportSection {
  readonly heading: string;
  readonly body: string;
}

export interface TableContent {
  readonly kind: "table";
  readonly title: string;
  readonly task: string;
  readonly input: {
    readonly fileName: string;
    readonly contentHash: string;
    readonly rows: number;
  };
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, string | number | boolean | null>[];
  readonly summary: string;
  readonly generator: "adapter_command" | "deterministic_table";
  readonly generatedAt: string;
  readonly adapterNotes?: readonly string[];
  readonly redactedColumns?: readonly string[];
}

export function parseCsvDashboardInput(filePath: string, raw: string): DashboardInput {
  const records = parseCsv(raw);
  return {
    fileName: basename(filePath),
    contentHash: `sha256:${sha256Hex(Buffer.from(raw, "utf8"))}`,
    rows: records.length,
    columns: records[0] ? Object.keys(records[0]) : [],
    records,
  };
}

export function createDeterministicDashboardContent(options: {
  readonly task: string;
  readonly input: DashboardInput;
  readonly schema?: DashboardSchema;
  readonly adapterOutput?: string;
  readonly adapterDashboard?: AdapterDashboardOutput;
  readonly redactedColumns?: readonly string[];
}): DashboardContent & CanonicalJsonValue {
  const schema = options.schema ?? inferDashboardSchema(options.input);
  const title = options.adapterDashboard?.title ?? schema.title?.trim() ?? titleFromTask(options.task);
  const widgets = options.adapterDashboard?.widgets ?? schema.widgets.map((widget) => createWidget(options.input.records, widget));
  const summary = options.adapterDashboard?.summary ?? createDashboardSummary(title, options.input.rows, widgets);

  return {
    kind: "dashboard",
    title,
    task: options.task,
    input: {
      fileName: options.input.fileName,
      contentHash: options.input.contentHash,
      rows: options.input.rows,
    },
    widgets,
    summary,
    generator: options.adapterOutput || options.adapterDashboard ? "adapter_command" : "deterministic_dashboard",
    generatedAt: new Date(0).toISOString(),
    ...(options.adapterOutput ? { adapterOutput: options.adapterOutput } : {}),
    ...(options.adapterDashboard?.notes?.length ? { adapterNotes: options.adapterDashboard.notes } : {}),
    ...(options.redactedColumns?.length ? { redactedColumns: options.redactedColumns } : {}),
  } as unknown as DashboardContent & CanonicalJsonValue;
}

export function createDeterministicReportContent(options: {
  readonly task: string;
  readonly input: DashboardInput;
  readonly adapterReport?: AdapterReportOutput;
  readonly redactedColumns?: readonly string[];
}): ReportContent & CanonicalJsonValue {
  const title = options.adapterReport?.title ?? titleFromTask(options.task);
  const sections = options.adapterReport?.sections ?? createDeterministicReportSections(options.input);
  const summary = options.adapterReport?.summary ?? createReportSummary(title, options.input.rows, options.input.columns);

  return {
    kind: "report",
    title,
    task: options.task,
    input: {
      fileName: options.input.fileName,
      contentHash: options.input.contentHash,
      rows: options.input.rows,
    },
    summary,
    sections,
    generator: options.adapterReport ? "adapter_command" : "deterministic_report",
    generatedAt: new Date(0).toISOString(),
    ...(options.adapterReport?.notes?.length ? { adapterNotes: options.adapterReport.notes } : {}),
    ...(options.redactedColumns?.length ? { redactedColumns: options.redactedColumns } : {}),
  } as unknown as ReportContent & CanonicalJsonValue;
}

export function createDeterministicTableContent(options: {
  readonly task: string;
  readonly input: DashboardInput;
  readonly adapterTable?: AdapterTableOutput;
  readonly redactedColumns?: readonly string[];
}): TableContent & CanonicalJsonValue {
  const title = options.adapterTable?.title ?? titleFromTask(options.task);
  const columns = options.adapterTable?.columns ?? options.input.columns;
  const rows = options.adapterTable?.rows ?? options.input.records;
  const summary = options.adapterTable?.summary ?? `${title}: ${rows.length} row(s), ${columns.length} column(s).`;

  return {
    kind: "table",
    title,
    task: options.task,
    input: {
      fileName: options.input.fileName,
      contentHash: options.input.contentHash,
      rows: options.input.rows,
    },
    columns,
    rows,
    summary,
    generator: options.adapterTable ? "adapter_command" : "deterministic_table",
    generatedAt: new Date(0).toISOString(),
    ...(options.adapterTable?.notes?.length ? { adapterNotes: options.adapterTable.notes } : {}),
    ...(options.redactedColumns?.length ? { redactedColumns: options.redactedColumns } : {}),
  } as unknown as TableContent & CanonicalJsonValue;
}

export function redactDashboardInputForAdapter(
  input: DashboardInput,
  columns: readonly string[],
): DashboardInput {
  const redactedColumns = normalizeRedactedColumns(input.columns, columns);
  if (redactedColumns.length === 0) return input;
  const redacted = new Set(redactedColumns);
  return {
    ...input,
    columns: input.columns.filter((column) => !redacted.has(column)),
    records: input.records.map((record) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(record)) {
        if (!redacted.has(key)) {
          next[key] = value;
        }
      }
      return next;
    }),
  };
}

export function normalizeRedactedColumns(
  inputColumns: readonly string[],
  requestedColumns: readonly string[],
): readonly string[] {
  const columnsByLowercase = new Map(inputColumns.map((column) => [column.toLowerCase(), column]));
  const redacted: string[] = [];
  for (const requested of requestedColumns) {
    const normalized = requested.trim().toLowerCase();
    if (!normalized) continue;
    const column = columnsByLowercase.get(normalized);
    if (column && !redacted.includes(column)) {
      redacted.push(column);
    }
  }
  return redacted;
}

export function parseDashboardSchema(raw: string): DashboardSchema {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Dashboard schema must be a JSON object.");
  }
  const widgets = parsed.widgets;
  if (!Array.isArray(widgets) || widgets.length === 0) {
    throw new Error("Dashboard schema must include a non-empty widgets array.");
  }

  return {
    ...(typeof parsed.title === "string" && parsed.title.trim() ? { title: parsed.title.trim() } : {}),
    widgets: widgets.map((widget, index) => parseSchemaWidget(widget, index)),
  };
}

export function parseCsv(raw: string): readonly Record<string, string>[] {
  const rows = parseCsvRows(stripBom(raw).trimEnd());
  if (rows.length === 0) return [];
  const headers = rows[0]!.map((header) => header.trim());
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index]?.trim() ?? "";
    });
    return record;
  });
}

function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    const next = raw[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  if (quoted) {
    throw new Error("CSV input has an unclosed quoted field.");
  }
  return rows;
}

function stripBom(raw: string): string {
  return raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
}

function sumNumericColumn(records: readonly Record<string, string>[], column: string): number {
  return records.reduce((sum, record) => sum + numberFrom(record[column]), 0);
}

function lastNumericColumn(records: readonly Record<string, string>[], column: string): number {
  return numberFrom(records.at(-1)?.[column]);
}

function averageNumericColumn(records: readonly Record<string, string>[], column: string): number {
  if (records.length === 0) return 0;
  return sumNumericColumn(records, column) / records.length;
}

function countPresentColumn(records: readonly Record<string, string>[], column: string): number {
  return records.filter((record) => String(record[column] ?? "").trim().length > 0).length;
}

function createWidget(
  records: readonly Record<string, string>[],
  widget: DashboardSchemaWidget,
): DashboardWidget {
  const rawValue = aggregateColumn(records, widget);
  return {
    kind: widget.kind ?? "metric",
    label: widget.label,
    value: formatWidgetValue(rawValue, widget.format),
  };
}

function aggregateColumn(records: readonly Record<string, string>[], widget: DashboardSchemaWidget): number {
  if (widget.aggregate === "sum") return sumNumericColumn(records, widget.column);
  if (widget.aggregate === "average") return averageNumericColumn(records, widget.column);
  if (widget.aggregate === "last") return lastNumericColumn(records, widget.column);
  return countPresentColumn(records, widget.column);
}

function formatWidgetValue(value: number, format: DashboardSchemaWidget["format"]): string | number {
  if (format === "currency") return formatCurrency(value);
  if (format === "percent") return Number(value.toFixed(2));
  return Number(value.toFixed(2));
}

function inferDashboardSchema(input: DashboardInput): DashboardSchema {
  const numericColumns = input.columns.filter((column) =>
    input.records.some((record) => isNumericCell(record[column])),
  );
  const widgets = numericColumns.slice(0, 4).map((column): DashboardSchemaWidget => ({
    kind: column.toLowerCase().includes("risk") ? "risk" : "metric",
    label: labelFromColumn(column),
    column,
    aggregate: inferAggregateForColumn(column),
    format: column.toLowerCase().includes("risk") ? "percent" : "number",
  }));

  return {
    widgets: widgets.length > 0
      ? widgets
      : [{
          kind: "metric",
          label: "Rows",
          column: input.columns[0] ?? "",
          aggregate: "count",
          format: "number",
        }],
  };
}

function parseSchemaWidget(value: unknown, index: number): DashboardSchemaWidget {
  if (!isRecord(value)) {
    throw new Error(`Dashboard schema widget ${index + 1} must be an object.`);
  }
  if (typeof value.label !== "string" || !value.label.trim()) {
    throw new Error(`Dashboard schema widget ${index + 1} must include a label.`);
  }
  if (typeof value.column !== "string" || !value.column.trim()) {
    throw new Error(`Dashboard schema widget ${index + 1} must include a column.`);
  }
  if (!isAggregate(value.aggregate)) {
    throw new Error(`Dashboard schema widget ${index + 1} has an unsupported aggregate.`);
  }
  if (value.kind !== undefined && !isWidgetKind(value.kind)) {
    throw new Error(`Dashboard schema widget ${index + 1} has an unsupported kind.`);
  }
  if (value.format !== undefined && !isWidgetFormat(value.format)) {
    throw new Error(`Dashboard schema widget ${index + 1} has an unsupported format.`);
  }
  return {
    label: value.label.trim(),
    column: value.column.trim(),
    aggregate: value.aggregate,
    ...(value.kind ? { kind: value.kind } : {}),
    ...(value.format ? { format: value.format } : {}),
  };
}

function createDashboardSummary(
  title: string,
  rows: number,
  widgets: readonly DashboardWidget[],
): string {
  const widgetSummary = widgets.slice(0, 2).map((widget) => `${widget.label}: ${widget.value}`).join(", ");
  return widgetSummary ? `${title}: ${rows} rows, ${widgetSummary}.` : `${title}: ${rows} rows.`;
}

function createDeterministicReportSections(input: DashboardInput): readonly ReportSection[] {
  return [
    {
      heading: "Input",
      body: `${input.fileName} contains ${input.rows} row(s) and ${input.columns.length} column(s).`,
    },
    {
      heading: "Columns",
      body: input.columns.length > 0 ? input.columns.join(", ") : "No columns were detected.",
    },
  ];
}

function createReportSummary(title: string, rows: number, columns: readonly string[]): string {
  return `${title}: analyzed ${rows} row(s) across ${columns.length} column(s).`;
}

function numberFrom(value: string | undefined): number {
  const parsed = Number(String(value ?? "").replaceAll(/[$,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNumericCell(value: string | undefined): boolean {
  if (String(value ?? "").trim().length === 0) return false;
  const parsed = Number(String(value ?? "").replaceAll(/[$,%\s]/g, ""));
  return Number.isFinite(parsed);
}

function inferAggregateForColumn(column: string): DashboardSchemaWidget["aggregate"] {
  const normalized = column.toLowerCase();
  if (normalized.includes("risk") || normalized.includes("rate") || normalized.includes("ratio")) return "average";
  if (normalized.includes("active") || normalized.includes("current") || normalized.includes("customer")) return "last";
  return "sum";
}

function titleFromTask(task: string): string {
  const cleaned = task.trim().replace(/[.?!]+$/, "");
  return cleaned.length > 0 ? cleaned[0]!.toUpperCase() + cleaned.slice(1) : "Dashboard";
}

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function labelFromColumn(column: string): string {
  return column
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAggregate(value: unknown): value is DashboardSchemaWidget["aggregate"] {
  return value === "sum" || value === "average" || value === "last" || value === "count";
}

function isWidgetKind(value: unknown): value is DashboardWidget["kind"] {
  return value === "metric" || value === "risk" || value === "trend";
}

function isWidgetFormat(value: unknown): value is NonNullable<DashboardSchemaWidget["format"]> {
  return value === "currency" || value === "number" || value === "percent";
}
