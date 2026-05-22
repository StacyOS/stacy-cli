import { createDb } from "@arpanstacy/stacy-db";

import type { BrainDb } from "../src/brain/brain-store.js";
import { listReceipts } from "../src/receipts/receipt-store.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface ReceiptsListOptions extends LocalRuntimeOptions {
  readonly ko?: string;
  readonly json?: boolean;
}

export interface ReceiptsDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly stdout?: Pick<typeof console, "log">;
}

export async function receiptsListCommand(
  options: ReceiptsListOptions,
  dependencies: ReceiptsDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);
  try {
    const receipts = await listReceipts({ db, koId: options.ko });
    if (options.json) {
      stdout.log(JSON.stringify({ receipts }, null, 2));
      return;
    }
    stdout.log(formatReceipts(receipts));
  } finally {
    if (ownsDb) await closeDb(db);
  }
}

function formatReceipts(
  receipts: readonly {
    readonly eventType: string;
    readonly koId?: string;
    readonly actorInstallId?: string;
    readonly counterpartyInstallId?: string;
    readonly createdAt: string;
  }[],
): string {
  if (receipts.length === 0) return "No federation receipts.";
  const counts = new Map<string, number>();
  for (const receipt of receipts) {
    counts.set(receipt.eventType, (counts.get(receipt.eventType) ?? 0) + 1);
  }
  const eventLines = receipts.map((receipt) => {
    const counterparty = receipt.counterpartyInstallId ? ` -> ${receipt.counterpartyInstallId}` : "";
    const actor = receipt.actorInstallId ? ` by ${receipt.actorInstallId}${counterparty}` : "";
    const ko = receipt.koId ? ` (${receipt.koId})` : "";
    return `  - ${receipt.createdAt}: ${receipt.eventType}${ko}${actor}`;
  });
  return [
    "Federation receipts:",
    "By event:",
    ...[...counts.entries()].map(([event, count]) => `  ${event}: ${count}`),
    "Events:",
    ...eventLines,
    `Total: ${receipts.length}`,
  ].join("\n");
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
