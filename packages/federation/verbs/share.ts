import { createDb } from "@arpanstacy/stacy-db";

import type { BrainDb } from "../src/brain/brain-store.js";
import { loadInstallIdentity } from "../src/identity/install-identity.js";
import {
  createFederationMessage,
  type FederationKnowledgeObjectMessage,
} from "../src/sync/federation-message.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface ShareOptions extends LocalRuntimeOptions {
  readonly with: string;
  readonly to?: string;
  readonly revocationUrl?: string;
  readonly scope?: string;
  readonly expires?: string;
  readonly revocable?: boolean;
  readonly json?: boolean;
}

type FetchLike = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}>;

export interface ShareDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly stdout?: Pick<typeof console, "log">;
  readonly now?: () => Date;
  readonly fetch?: FetchLike;
}

export async function shareCommand(
  koId: string,
  options: ShareOptions,
  dependencies: ShareDependencies = {},
): Promise<void> {
  if ((options.scope ?? "read") !== "read") {
    throw new Error("Phase 3 only supports --scope read");
  }

  const consumerInstallId = options.with.trim();
  if (!consumerInstallId) {
    throw new Error("Missing consumer install id");
  }

  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);

  try {
    const now = dependencies.now?.() ?? new Date();
    const producerIdentity = await loadInstallIdentity(runtime.identityPath);
    const message = await createFederationMessage({
      db,
      koId,
      producerIdentity,
      consumerInstallId,
      expiresAt: addDuration(now, options.expires ?? "30d"),
      revocable: options.revocable === true,
      revocationLookupUrl: options.revocationUrl,
      createdAt: now,
    });
    const delivery = options.to
      ? await deliverFederationMessage({
          endpointUrl: options.to,
          message,
          fetch: dependencies.fetch ?? fetch,
        })
      : null;

    if (options.json) {
      stdout.log(JSON.stringify(formatShareJson(message, delivery), null, 2));
      return;
    }

    stdout.log(formatShareText(message, delivery));
  } finally {
    if (ownsDb) {
      await closeDb(db);
    }
  }
}

interface ShareDeliveryResult {
  readonly endpointUrl: string;
  readonly status: number;
  readonly responseText: string;
}

async function deliverFederationMessage(options: {
  readonly endpointUrl: string;
  readonly message: FederationKnowledgeObjectMessage;
  readonly fetch: FetchLike;
}): Promise<ShareDeliveryResult> {
  const response = await options.fetch(options.endpointUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: options.message }),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Federation delivery failed with HTTP ${response.status}: ${responseText || "(empty response)"}`,
    );
  }

  return {
    endpointUrl: options.endpointUrl,
    status: response.status,
    responseText,
  };
}

function formatShareJson(
  message: FederationKnowledgeObjectMessage,
  delivery: ShareDeliveryResult | null,
) {
  return {
    message,
    koId: message.ko.id,
    grantId: message.grant.id,
    producerInstallId: message.producerInstallId,
    consumerInstallId: message.consumerInstallId,
    expiresAt: message.grant.signedPayload.expiresAt,
    delivery,
  };
}

function formatShareText(
  message: FederationKnowledgeObjectMessage,
  delivery: ShareDeliveryResult | null,
): string {
  const lines = [
    `Shared Knowledge Object: ${message.ko.id}`,
    `Grant: ${message.grant.id}`,
    `Producer: ${message.producerInstallId}`,
    `Consumer: ${message.consumerInstallId}`,
    `Expires: ${message.grant.signedPayload.expiresAt}`,
  ];

  if (delivery) {
    lines.push(`Delivered: ${delivery.endpointUrl} (${delivery.status})`);
  }

  return lines.join("\n");
}

function addDuration(now: Date, duration: string): Date {
  const match = duration.trim().match(/^(\d+)([dhm])$/);
  if (!match) {
    throw new Error("Invalid --expires duration. Use values like 30d, 12h, or 45m.");
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "d" ? 24 * 60 * 60 * 1000 : unit === "h" ? 60 * 60 * 1000 : 60 * 1000;
  return new Date(now.getTime() + amount * multiplier);
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
