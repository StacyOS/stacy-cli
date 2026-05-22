import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type { BrainDb, QueryResult } from "../brain/brain-store.js";
import { canonicalize } from "../crypto/canonical.js";

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
  readonly previousReceiptHash?: string;
  readonly receiptHash: string;
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

export interface VerifyReceiptChainOptions {
  readonly db: BrainDb;
  readonly koId?: string;
}

export interface VerifyReceiptChainResult {
  readonly valid: boolean;
  readonly checked: number;
  readonly firstInvalidReceiptId?: string;
  readonly reason?: string;
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
  readonly previous_receipt_hash: string | null;
  readonly receipt_hash: string | null;
}

const ensuredReceiptDbs = new WeakSet<BrainDb>();

export async function ensureReceiptTables(db: BrainDb): Promise<void> {
  if (ensuredReceiptDbs.has(db)) return;

  await db.execute(sql`SET client_min_messages TO warning`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_receipts (
      id text PRIMARY KEY,
      event_type text NOT NULL,
      tenant text NOT NULL,
      ko_id text NOT NULL,
      actor_install_id text NOT NULL,
      counterparty_install_id text,
      payload_json jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      previous_receipt_hash text,
      receipt_hash text
    )
  `);

  await db.execute(sql`
    ALTER TABLE federation_receipts
      ADD COLUMN IF NOT EXISTS previous_receipt_hash text
  `);

  await db.execute(sql`
    ALTER TABLE federation_receipts
      ADD COLUMN IF NOT EXISTS receipt_hash text
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_receipts_ko_idx
      ON federation_receipts (ko_id, created_at)
  `);
  ensuredReceiptDbs.add(db);
}

export async function appendReceipt(options: AppendReceiptOptions): Promise<FederationReceipt> {
  await ensureReceiptTables(options.db);

  const previousReceiptHash = await readReceiptChainTailHash({
    db: options.db,
    koId: options.koId,
  });
  const payload = normalizeReceiptPayload(options.payload ?? {});
  const unsignedReceipt = {
    id: options.idGenerator?.() ?? `receipt_${randomUUID()}`,
    eventType: options.eventType,
    tenant: options.tenant,
    koId: options.koId,
    actorInstallId: options.actorInstallId,
    counterpartyInstallId: options.counterpartyInstallId,
    payload,
    createdAt: (options.createdAt ?? new Date()).toISOString(),
    previousReceiptHash: previousReceiptHash ?? undefined,
  };
  const receipt: FederationReceipt = {
    ...unsignedReceipt,
    receiptHash: hashReceipt(unsignedReceipt),
  };

  await options.db.execute(sql`
    INSERT INTO federation_receipts (
      id,
      event_type,
      tenant,
      ko_id,
      actor_install_id,
      counterparty_install_id,
      payload_json,
      created_at,
      previous_receipt_hash,
      receipt_hash
    )
    VALUES (
      ${receipt.id},
      ${receipt.eventType},
      ${receipt.tenant},
      ${receipt.koId},
      ${receipt.actorInstallId},
      ${receipt.counterpartyInstallId ?? null},
      ${JSON.stringify(receipt.payload)}::jsonb,
      ${receipt.createdAt},
      ${receipt.previousReceiptHash ?? null},
      ${receipt.receiptHash}
    )
  `);

  return receipt;
}

function normalizeReceiptPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function normalizeReceiptTimestamp(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return value;
}

export async function listReceipts(options: ListReceiptsOptions): Promise<readonly FederationReceipt[]> {
  await ensureReceiptTables(options.db);

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
              created_at,
              previous_receipt_hash,
              receipt_hash
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
              created_at,
              previous_receipt_hash,
              receipt_hash
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

  return rows.map((row) => {
    const payload = row.payload_json as Record<string, unknown>;
    const createdAt = normalizeReceiptTimestamp(row.created_at);
    return {
      id: row.id,
      eventType: row.event_type,
      tenant: row.tenant,
      koId: row.ko_id,
      actorInstallId: row.actor_install_id,
      counterpartyInstallId: row.counterparty_install_id ?? undefined,
      payload,
      createdAt,
      previousReceiptHash: row.previous_receipt_hash ?? undefined,
      receiptHash: row.receipt_hash ?? hashReceipt({
        id: row.id,
        eventType: row.event_type,
        tenant: row.tenant,
        koId: row.ko_id,
        actorInstallId: row.actor_install_id,
        counterpartyInstallId: row.counterparty_install_id ?? undefined,
        payload,
        createdAt,
        previousReceiptHash: row.previous_receipt_hash ?? undefined,
      }),
    };
  });
}

export async function verifyReceiptChain(
  options: VerifyReceiptChainOptions,
): Promise<VerifyReceiptChainResult> {
  const receipts = await listReceipts({ db: options.db, koId: options.koId });
  const receiptsByPreviousHash = new Map<string, FederationReceipt[]>();
  const receiptsByHash = new Map<string, FederationReceipt>();
  for (const receipt of receipts) {
    const expectedReceiptHash = computeExpectedReceiptHash(receipt);
    if (receipt.receiptHash !== expectedReceiptHash) {
      return {
        valid: false,
        checked: 0,
        firstInvalidReceiptId: receipt.id,
        reason: "receipt hash mismatch",
      };
    }

    if (receiptsByHash.has(receipt.receiptHash)) {
      return {
        valid: false,
        checked: 0,
        firstInvalidReceiptId: receipt.id,
        reason: "duplicate receipt hash",
      };
    }

    receiptsByHash.set(receipt.receiptHash, receipt);
    const previousKey = receipt.previousReceiptHash ?? "";
    receiptsByPreviousHash.set(previousKey, [...(receiptsByPreviousHash.get(previousKey) ?? []), receipt]);
  }

  const heads = receiptsByPreviousHash.get("") ?? [];
  if (receipts.length > 0 && heads.length !== 1) {
    return {
      valid: false,
      checked: 0,
      firstInvalidReceiptId: heads[0]?.id,
      reason: heads.length === 0 ? "missing chain head" : "multiple chain heads",
    };
  }

  let checked = 0;
  let cursor = heads[0];
  while (cursor) {
    checked += 1;
    const nextReceipts = receiptsByPreviousHash.get(cursor.receiptHash) ?? [];
    if (nextReceipts.length > 1) {
      return {
        valid: false,
        checked,
        firstInvalidReceiptId: nextReceipts[0]?.id,
        reason: "receipt chain fork",
      };
    }
    cursor = nextReceipts[0];
  }

  if (checked !== receipts.length) {
    const firstUnlinked = receipts.find(
      (receipt) => receipt.previousReceiptHash && !receiptsByHash.has(receipt.previousReceiptHash),
    );
    return {
      valid: false,
      checked,
      firstInvalidReceiptId: firstUnlinked?.id,
      reason: firstUnlinked
        ? `expected previous hash ${firstUnlinked.previousReceiptHash}`
        : "unlinked receipt chain",
    };
  }

  return { valid: true, checked };
}

function computeExpectedReceiptHash(receipt: FederationReceipt): string {
  return hashReceipt({
    id: receipt.id,
    eventType: receipt.eventType,
    tenant: receipt.tenant,
    koId: receipt.koId,
    actorInstallId: receipt.actorInstallId,
    counterpartyInstallId: receipt.counterpartyInstallId,
    payload: receipt.payload,
    createdAt: receipt.createdAt,
    previousReceiptHash: receipt.previousReceiptHash,
  });
}

interface HashableReceipt {
  readonly id: string;
  readonly eventType: FederationReceiptEventType;
  readonly tenant: string;
  readonly koId: string;
  readonly actorInstallId: string;
  readonly counterpartyInstallId?: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly previousReceiptHash?: string;
}

export function hashReceipt(receipt: HashableReceipt): string {
  const canonicalReceipt = canonicalize({
    actorInstallId: receipt.actorInstallId,
    counterpartyInstallId: receipt.counterpartyInstallId ?? null,
    createdAt: receipt.createdAt,
    eventType: receipt.eventType,
    id: receipt.id,
    koId: receipt.koId,
    payload: receipt.payload,
    previousReceiptHash: receipt.previousReceiptHash ?? null,
    tenant: receipt.tenant,
  });
  return `sha256:${createHash("sha256").update(canonicalReceipt).digest("hex")}`;
}

async function readReceiptChainTailHash(options: {
  readonly db: BrainDb;
  readonly koId: string;
}): Promise<string | undefined> {
  const rows = normalizeRows<{
    readonly previous_receipt_hash: string | null;
    readonly receipt_hash: string | null;
  }>(
    await options.db.execute(sql`
      SELECT previous_receipt_hash, receipt_hash
      FROM federation_receipts
      WHERE ko_id = ${options.koId}
    `),
  );
  const receiptHashes = new Set(rows.map((row) => row.receipt_hash).filter((hash): hash is string => typeof hash === "string"));
  const predecessorHashes = new Set(rows.map((row) => row.previous_receipt_hash).filter((hash): hash is string => typeof hash === "string"));
  const tails = [...receiptHashes].filter((hash) => !predecessorHashes.has(hash));
  if (tails.length > 1) {
    throw new Error("Cannot append receipt because the existing receipt chain has multiple tails.");
  }
  return tails[0];
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
