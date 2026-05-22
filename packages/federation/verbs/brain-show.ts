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
  readonly title: string;
  readonly widgets: readonly unknown[];
}

function isDashboardContent(content: unknown): content is DashboardContent {
  return (
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    typeof (content as { title?: unknown }).title === "string" &&
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

  return [`Dashboard: ${content.title}`, ...widgetLines].join("\n");
}
