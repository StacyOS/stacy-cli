import type { DashboardWidget } from "./dashboard-content.js";

export interface AdapterDashboardOutput {
  readonly title?: string;
  readonly summary?: string;
  readonly widgets: readonly DashboardWidget[];
  readonly notes?: readonly string[];
}

export function parseAdapterDashboardOutput(raw: string): AdapterDashboardOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Adapter dashboard output must be valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Adapter dashboard output must be a JSON object.");
  }

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

function isWidgetKind(value: unknown): value is DashboardWidget["kind"] {
  return value === "metric" || value === "risk" || value === "trend";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
