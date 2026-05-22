import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type { BrainDb, QueryResult } from "../brain/brain-store.js";

export type FederationReceiptEventType =
  | "create"
  | "sign"
  | "share"
  | "receive"
  | "store"
  | "read"
  | "deny"
  | "revoke";

export interface FederationReceipt {
  readonly id: string;
  readonly eventType: FederationReceiptEventType;
  readonly tenant: string;
  readonly koId: string;
  readonly actorInstallId: string;
  readonly counterpartyInstallId?: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

export interface AppendReceiptOptions {
  readonly db: BrainDb;
  readonly eventType: FederationReceiptEventType;
  readonly tenant: string;
  readonly koId: string;
  readonly actorInstallId: string;
  readonly counterpartyInstallId?: string;
  readonly payload?: Record<string, unknown>;
  readonly createdAt?: Date;
  readonly idGenerator?: () => string;
}

export interface ListReceiptsOptions {
  readonly db: BrainDb;
  readonly koId?: string;
}

interface ReceiptRow {
  readonly id: string;
  readonly event_type: FederationReceiptEventType;
  readonly tenant: string;
  readonly ko_id: string;
  readonly actor_install_id: string;
  readonly counterparty_install_id: string | null;
  readonly payload_json: unknown;
  readonly created_at: string | Date;
}

const ensuredReceiptDbs = new WeakSet<BrainDb>();

export async function ensureReceiptTables(db: BrainDb): Promise<void> {
  if (ensuredReceiptDbs.has(db)) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_receipts (
      id text PRIMARY KEY,
      event_type text NOT NULL,
      tenant text NOT NULL,
      ko_id text NOT NULL,
      actor_install_id text NOT NULL,
      counterparty_install_id text,
      payload_json jsonb NOT NULL,
      created_at timestamptz NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_receipts_ko_idx
      ON federation_receipts (ko_id, created_at)
  `);
  ensuredReceiptDbs.add(db);
}

export async function appendReceipt(options: AppendReceiptOptions): Promise<FederationReceipt> {
  const receipt: FederationReceipt = {
    id: options.idGenerator?.() ?? `receipt_${randomUUID()}`,
    eventType: options.eventType,
    tenant: options.tenant,
    koId: options.koId,
    actorInstallId: options.actorInstallId,
    counterpartyInstallId: options.counterpartyInstallId,
    payload: options.payload ?? {},
    createdAt: (options.createdAt ?? new Date()).toISOString(),
  };

  await ensureReceiptTables(options.db);
  await options.db.execute(sql`
    INSERT INTO federation_receipts (
      id,
      event_type,
      tenant,
      ko_id,
      actor_install_id,
      counterparty_install_id,
      payload_json,
      created_at
    )
    VALUES (
      ${receipt.id},
      ${receipt.eventType},
      ${receipt.tenant},
      ${receipt.koId},
      ${receipt.actorInstallId},
      ${receipt.counterpartyInstallId ?? null},
      ${JSON.stringify(receipt.payload)}::jsonb,
      ${receipt.createdAt}
    )
  `);

  return receipt;
}

export async function listReceipts(options: ListReceiptsOptions): Promise<readonly FederationReceipt[]> {
  let rows: readonly ReceiptRow[];
  try {
    rows = normalizeRows<ReceiptRow>(
      options.koId
        ? await options.db.execute(sql`
            SELECT
              id,
              event_type,
              tenant,
              ko_id,
              actor_install_id,
              counterparty_install_id,
              payload_json,
              created_at
            FROM federation_receipts
            WHERE ko_id = ${options.koId}
            ORDER BY created_at ASC, id ASC
          `)
        : await options.db.execute(sql`
            SELECT
              id,
              event_type,
              tenant,
              ko_id,
              actor_install_id,
              counterparty_install_id,
              payload_json,
              created_at
            FROM federation_receipts
            ORDER BY created_at ASC, id ASC
          `),
    );
  } catch (error) {
    if (isUndefinedTableError(error)) {
      return [];
    }

    throw error;
  }

  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    tenant: row.tenant,
    koId: row.ko_id,
    actorInstallId: row.actor_install_id,
    counterpartyInstallId: row.counterparty_install_id ?? undefined,
    payload: row.payload_json as Record<string, unknown>,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

function normalizeRows<T>(result: QueryResult<T> | unknown): readonly T[] {
  if (typeof result === "object" && result !== null && "rows" in result) {
    return (result as { readonly rows: readonly T[] }).rows;
  }

  if (Array.isArray(result)) {
    return result as readonly T[];
  }

  return [];
}

function isUndefinedTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "42P01"
  );
}
