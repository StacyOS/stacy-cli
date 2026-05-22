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

  return JSON.stringify(content, null, 2);
}

interface DashboardContent {
  readonly title?: string;
  readonly summary?: string;
  readonly generator?: string;
  readonly adapterOutput?: string;
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
