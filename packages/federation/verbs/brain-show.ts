import { createDb } from "@arpanstacy/stacy-db";

import {
  readKnowledgeObject,
  type BrainDb,
  type ReadKnowledgeObjectResult,
} from "../src/brain/brain-store.js";
import { readKnowledgeObjectWithConsent } from "../src/brain/read-with-consent.js";
import { syncRevocationFromProducer } from "../src/sync/revocation-lookup.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface BrainShowOptions extends LocalRuntimeOptions {
  readonly asConsumer?: string;
  readonly json?: boolean;
}

export interface BrainShowDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly readKnowledgeObject?: typeof readKnowledgeObject;
  readonly stdout?: Pick<typeof console, "log">;
  readonly fetch?: Parameters<typeof syncRevocationFromProducer>[0]["fetch"];
}

export async function brainShowCommand(
  koId: string,
  options: BrainShowOptions,
  dependencies: BrainShowDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  const read = dependencies.readKnowledgeObject ?? readKnowledgeObject;
  try {
    const consumerInstallId = options.asConsumer?.trim();
    if (consumerInstallId) {
      await syncRevocationFromProducer({
        db,
        koId,
        fetch: dependencies.fetch,
      });
    }
    const result = consumerInstallId
      ? await readKnowledgeObjectWithConsent({
          db,
          koId,
          consumerInstallId,
        })
      : await read({ db, koId });

    if (!result.ok) {
      throw new Error(result.reason);
    }

    if (options.json) {
      stdout.log(JSON.stringify(formatBrainShowJson(result), null, 2));
      return;
    }

    stdout.log(formatBrainShowText(result));
  } finally {
    if (ownsDb) {
      await closeDb(db);
    }
  }
}

function formatBrainShowJson(result: Extract<ReadKnowledgeObjectResult, { ok: true }>) {
  return {
    id: result.ko.id,
    tenant: result.ko.signedPayload.tenant,
    contentType: result.ko.signedPayload.contentType,
    contentHash: result.verification.contentHash,
    creatorInstallId: result.ko.signedPayload.creatorInstallId,
    signerInstallId: result.ko.signer.installId,
    provenance: result.provenance,
    content: result.ko.signedPayload.content,
    verified: true,
  };
}

function formatBrainShowText(result: Extract<ReadKnowledgeObjectResult, { ok: true }>): string {
  const renderedContent = renderContent(result.ko.signedPayload.content);

  return [
    `Knowledge Object: ${result.ko.id}`,
    `Tenant: ${result.ko.signedPayload.tenant}`,
    `Content hash: ${result.verification.contentHash}`,
    `Content type: ${result.ko.signedPayload.contentType}`,
    `Creator install: ${result.ko.signedPayload.creatorInstallId}`,
    `Source: ${result.provenance.source}`,
    `Signature: verified`,
    `Consent: ${result.provenance.source === "federated" ? "enforced on read" : "local owner read"}`,
    "",
    renderedContent,
  ].join("\n");
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}

function renderContent(content: unknown): string {
  if (isDashboardContent(content)) {
    return renderDashboardContent(content);
  }
  if (isReportContent(content)) {
    return renderReportContent(content);
  }
  if (isTableContent(content)) {
    return renderTableContent(content);
  }
  if (isReferralPacketContent(content)) {
    return renderReferralPacketContent(content);
  }
  if (isDerivedKnowledgeObjectContent(content)) {
    return renderDerivedKnowledgeObjectContent(content);
  }

  return JSON.stringify(content, null, 2);
}

interface ReportContent {
  readonly kind: "report";
  readonly title?: string;
  readonly summary?: string;
  readonly generator?: string;
  readonly sections?: readonly unknown[];
  readonly adapterNotes?: readonly string[];
  readonly redactedColumns?: readonly string[];
  readonly input?: unknown;
}

function isReportContent(content: unknown): content is ReportContent {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    (content as { kind?: unknown }).kind === "report"
  );
}

function renderReportContent(content: ReportContent): string {
  const title = typeof content.title === "string" ? content.title : "Report";
  const lines = [`Report: ${title}`];
  if (typeof content.summary === "string") {
    lines.push(`Summary: ${content.summary}`);
  }
  if (typeof content.generator === "string") {
    lines.push(`Generator: ${content.generator}`);
  }
  if (isDashboardInput(content.input)) {
    lines.push(`Input: ${content.input.fileName} (${content.input.rows} rows, ${content.input.contentHash})`);
  }
  if (Array.isArray(content.sections) && content.sections.length > 0) {
    lines.push("Sections:");
    for (const section of content.sections) {
      if (typeof section === "object" && section !== null && !Array.isArray(section)) {
        const record = section as Record<string, unknown>;
        const heading = typeof record.heading === "string" ? record.heading : "Section";
        const body = typeof record.body === "string" ? record.body : JSON.stringify(record);
        lines.push(`  - ${heading}: ${body}`);
      }
    }
  }
  if (Array.isArray(content.adapterNotes) && content.adapterNotes.length > 0) {
    lines.push("Adapter notes:", ...content.adapterNotes.map((note) => `  - ${String(note)}`));
  }
  if (Array.isArray(content.redactedColumns) && content.redactedColumns.length > 0) {
    lines.push(`Adapter redactions: ${content.redactedColumns.join(", ")}`);
  }
  return lines.join("\n");
}

interface TableContent {
  readonly kind: "table";
  readonly title?: string;
  readonly summary?: string;
  readonly generator?: string;
  readonly columns?: readonly string[];
  readonly rows?: readonly unknown[];
  readonly adapterNotes?: readonly string[];
  readonly input?: unknown;
}

function isTableContent(content: unknown): content is TableContent {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    (content as { kind?: unknown }).kind === "table"
  );
}

function renderTableContent(content: TableContent): string {
  const title = typeof content.title === "string" ? content.title : "Table";
  const lines = [`Table: ${title}`];
  if (typeof content.summary === "string") {
    lines.push(`Summary: ${content.summary}`);
  }
  if (typeof content.generator === "string") {
    lines.push(`Generator: ${content.generator}`);
  }
  if (isDashboardInput(content.input)) {
    lines.push(`Input: ${content.input.fileName} (${content.input.rows} rows, ${content.input.contentHash})`);
  }
  if (Array.isArray(content.columns)) {
    lines.push(`Columns: ${content.columns.join(", ")}`);
  }
  if (Array.isArray(content.rows)) {
    lines.push(`Rows: ${content.rows.length}`);
  }
  if (Array.isArray(content.adapterNotes) && content.adapterNotes.length > 0) {
    lines.push("Adapter notes:", ...content.adapterNotes.map((note) => `  - ${String(note)}`));
  }
  return lines.join("\n");
}

interface ReferralPacketContent {
  readonly kind: "referral_packet";
  readonly title?: string;
  readonly summary?: string;
  readonly generator?: string;
  readonly patientReference?: string;
  readonly referralReason?: string;
  readonly clinicalSummary?: string;
  readonly labSnapshot?: string;
  readonly medications?: readonly string[];
  readonly imagingStatus?: string;
  readonly consent?: {
    readonly expiresAt?: string;
    readonly revocationReason?: string;
  };
  readonly attachments?: readonly { readonly label?: string; readonly status?: string }[];
  readonly adapterNotes?: readonly string[];
  readonly redactedColumns?: readonly string[];
  readonly input?: unknown;
}

function isReferralPacketContent(content: unknown): content is ReferralPacketContent {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    (content as { kind?: unknown }).kind === "referral_packet"
  );
}

function renderReferralPacketContent(content: ReferralPacketContent): string {
  const title = typeof content.title === "string" ? content.title : "Referral Packet";
  const lines = [`Referral packet: ${title}`];
  if (typeof content.summary === "string") {
    lines.push(`Summary: ${content.summary}`);
  }
  if (typeof content.generator === "string") {
    lines.push(`Generator: ${content.generator}`);
  }
  if (isDashboardInput(content.input)) {
    lines.push(`Input: ${content.input.fileName} (${content.input.rows} rows, ${content.input.contentHash})`);
  }
  lines.push(
    `Patient reference: ${content.patientReference ?? "unknown"}`,
    `Referral reason: ${content.referralReason ?? "unknown"}`,
    `Clinical summary: ${content.clinicalSummary ?? "unknown"}`,
    `Labs: ${content.labSnapshot ?? "unknown"}`,
    `Medications: ${content.medications?.join("; ") || "unknown"}`,
    `Imaging: ${content.imagingStatus ?? "unknown"}`,
    `Consent expires: ${content.consent?.expiresAt ?? "unknown"}`,
    `Revocation reason: ${content.consent?.revocationReason ?? "unknown"}`,
  );
  if (Array.isArray(content.attachments) && content.attachments.length > 0) {
    lines.push("Attachments:", ...content.attachments.map((attachment) => `  - ${attachment.label ?? "Attachment"}: ${attachment.status ?? "unknown"}`));
  }
  if (Array.isArray(content.adapterNotes) && content.adapterNotes.length > 0) {
    lines.push("Adapter notes:", ...content.adapterNotes.map((note) => `  - ${String(note)}`));
  }
  if (Array.isArray(content.redactedColumns) && content.redactedColumns.length > 0) {
    lines.push(`Adapter redactions: ${content.redactedColumns.join(", ")}`);
  }
  return lines.join("\n");
}

interface DashboardContent {
  readonly title?: string;
  readonly summary?: string;
  readonly generator?: string;
  readonly adapterOutput?: string;
  readonly adapterNotes?: readonly string[];
  readonly redactedColumns?: readonly string[];
  readonly widgets: readonly unknown[];
  readonly input?: unknown;
}

function isDashboardContent(content: unknown): content is DashboardContent {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    Array.isArray((content as { widgets?: unknown }).widgets)
  );
}

function renderDashboardContent(content: DashboardContent): string {
  const widgetLines = content.widgets.map((widget, index) => {
    if (typeof widget !== "object" || widget === null || Array.isArray(widget)) {
      return `  ${index + 1}. ${JSON.stringify(widget)}`;
    }

    const record = widget as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label : `Widget ${index + 1}`;
    const kind = typeof record.kind === "string" ? record.kind : "unknown";
    const value = record.value === undefined ? "" : `: ${String(record.value)}`;
    return `  ${index + 1}. [${kind}] ${label}${value}`;
  });

  const title = typeof content.title === "string" ? content.title : "Dashboard";
  const lines = [`Dashboard: ${title}`];
  if (typeof content.summary === "string") {
    lines.push(`Summary: ${content.summary}`);
  }
  if (typeof content.generator === "string") {
    lines.push(`Generator: ${content.generator}`);
  }
  if (typeof content.adapterOutput === "string" && content.adapterOutput.trim()) {
    lines.push(`Adapter output: ${content.adapterOutput.trim()}`);
  }
  if (Array.isArray(content.adapterNotes) && content.adapterNotes.length > 0) {
    lines.push("Adapter notes:", ...content.adapterNotes.map((note) => `  - ${String(note)}`));
  }
  if (Array.isArray(content.redactedColumns) && content.redactedColumns.length > 0) {
    lines.push(`Adapter redactions: ${content.redactedColumns.join(", ")}`);
  }
  if (isDashboardInput(content.input)) {
    lines.push(`Input: ${content.input.fileName} (${content.input.rows} rows, ${content.input.contentHash})`);
  }
  lines.push("Widgets:", ...widgetLines);
  return lines.join("\n");
}

function isDashboardInput(input: unknown): input is { readonly fileName: string; readonly rows: number; readonly contentHash: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    typeof (input as { fileName?: unknown }).fileName === "string" &&
    typeof (input as { rows?: unknown }).rows === "number" &&
    typeof (input as { contentHash?: unknown }).contentHash === "string"
  );
}

interface DerivedKnowledgeObjectContent {
  readonly kind: "derived_knowledge_object";
  readonly source?: {
    readonly koId?: string;
    readonly koContentHash?: string;
    readonly producerInstallId?: string;
    readonly grantId?: string;
    readonly grantScope?: string;
  };
  readonly createdByConsumerInstallId?: string;
  readonly derivedContent?: unknown;
}

function isDerivedKnowledgeObjectContent(content: unknown): content is DerivedKnowledgeObjectContent {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    (content as { kind?: unknown }).kind === "derived_knowledge_object"
  );
}

function renderDerivedKnowledgeObjectContent(content: DerivedKnowledgeObjectContent): string {
  const source = content.source ?? {};
  return [
    "Derived Knowledge Object",
    `Source KO: ${source.koId ?? "unknown"}`,
    `Source content hash: ${source.koContentHash ?? "unknown"}`,
    `Producer install: ${source.producerInstallId ?? "unknown"}`,
    `Grant: ${source.grantId ?? "unknown"} (${source.grantScope ?? "unknown"})`,
    `Consumer install: ${content.createdByConsumerInstallId ?? "unknown"}`,
    "Derived content:",
    JSON.stringify(content.derivedContent ?? null, null, 2),
  ].join("\n");
}
