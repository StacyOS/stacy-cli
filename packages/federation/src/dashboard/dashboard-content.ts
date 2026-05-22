import { basename } from "node:path";

import type { CanonicalJsonValue } from "../crypto/canonical.js";
import { sha256Hex } from "../util/hash.js";

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
}): DashboardContent & CanonicalJsonValue {
  const schema = options.schema ?? inferDashboardSchema(options.input);
  const title = schema.title?.trim() || titleFromTask(options.task);
  const widgets = schema.widgets.map((widget) => createWidget(options.input.records, widget));

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
    summary: createDashboardSummary(title, options.input.rows, widgets),
    generator: options.adapterOutput ? "adapter_command" : "deterministic_dashboard",
    generatedAt: new Date(0).toISOString(),
    ...(options.adapterOutput ? { adapterOutput: options.adapterOutput } : {}),
  } as unknown as DashboardContent & CanonicalJsonValue;
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
  const rows = parseCsvRows(raw.trim());
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
  return rows;
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
