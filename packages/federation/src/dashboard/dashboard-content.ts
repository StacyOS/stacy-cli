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
  readonly adapterOutput?: string;
}): DashboardContent & CanonicalJsonValue {
  const revenue = sumNumericColumn(options.input.records, "revenue");
  const pipeline = sumNumericColumn(options.input.records, "pipeline");
  const customers = lastNumericColumn(options.input.records, "active_customers");
  const churnRisk = averageNumericColumn(options.input.records, "churn_risk");
  const title = titleFromTask(options.task);
  const widgets: DashboardWidget[] = [
    { kind: "metric", label: "Revenue", value: revenue },
    { kind: "metric", label: "Pipeline", value: pipeline },
    { kind: "metric", label: "Active customers", value: customers },
    { kind: "risk", label: "Average churn risk", value: Number(churnRisk.toFixed(2)) },
  ];

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
    summary: `${title}: ${options.input.rows} rows, ${formatCurrency(revenue)} revenue, ${formatCurrency(pipeline)} pipeline.`,
    generator: options.adapterOutput ? "adapter_command" : "deterministic_dashboard",
    generatedAt: new Date(0).toISOString(),
    ...(options.adapterOutput ? { adapterOutput: options.adapterOutput } : {}),
  } as unknown as DashboardContent & CanonicalJsonValue;
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

function numberFrom(value: string | undefined): number {
  const parsed = Number(String(value ?? "").replaceAll(/[$,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function titleFromTask(task: string): string {
  const cleaned = task.trim().replace(/[.?!]+$/, "");
  return cleaned.length > 0 ? cleaned[0]!.toUpperCase() + cleaned.slice(1) : "Acme dashboard";
}

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
