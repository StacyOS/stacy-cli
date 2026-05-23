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
  | "revoke"
  | "derive"
  | "verify";

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

export interface FederationReceiptAnchor {
  readonly id: string;
  readonly previousAnchorHash?: string;
  readonly receiptId: string;
  readonly receiptHash: string;
  readonly anchorHash: string;
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

export interface VerifyGlobalReceiptAnchorOptions {
  readonly db: BrainDb;
}

export interface VerifyGlobalReceiptAnchorResult {
  readonly valid: boolean;
  readonly checked: number;
  readonly firstInvalidAnchorId?: string;
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

interface ReceiptAnchorRow {
  readonly id: string;
  readonly previous_anchor_hash: string | null;
  readonly receipt_id: string;
  readonly receipt_hash: string;
  readonly anchor_hash: string | null;
  readonly created_at: string | Date;
}

interface ReceiptChainHeadRow {
  readonly id: string;
  readonly anchor_hash: string;
  readonly updated_at: string | Date;
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

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_receipt_anchors (
      id text PRIMARY KEY,
      previous_anchor_hash text,
      receipt_id text NOT NULL,
      receipt_hash text NOT NULL,
      anchor_hash text,
      created_at timestamptz NOT NULL
    )
  `);

  await db.execute(sql`
    ALTER TABLE federation_receipt_anchors
      ADD COLUMN IF NOT EXISTS anchor_hash text
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_receipt_anchors_created_at_idx
      ON federation_receipt_anchors (created_at, id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_receipt_anchors_receipt_id_idx
      ON federation_receipt_anchors (receipt_id)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_receipt_chain_head (
      id text PRIMARY KEY,
      anchor_hash text NOT NULL,
      updated_at timestamptz NOT NULL
    )
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

  await appendReceiptAnchor({
    db: options.db,
    receipt,
  });

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

export async function verifyGlobalReceiptAnchor(
  options: VerifyGlobalReceiptAnchorOptions,
): Promise<VerifyGlobalReceiptAnchorResult> {
  const anchors = await listReceiptAnchors(options.db);
  const receiptRows = normalizeRows<{ readonly id: string; readonly receipt_hash: string | null }>(
    await options.db.execute(sql`
      SELECT id, receipt_hash
      FROM federation_receipts
    `),
  );
  const head = await readReceiptChainHead(options.db);
  const receiptHashesById = new Map(
    receiptRows
      .filter((row) => typeof row.receipt_hash === "string")
      .map((row) => [row.id, row.receipt_hash as string]),
  );
  const anchorsByPreviousHash = new Map<string, FederationReceiptAnchor[]>();
  const anchorsByHash = new Map<string, FederationReceiptAnchor>();

  for (const anchor of anchors) {
    const expectedAnchorHash = computeExpectedReceiptAnchorHash(anchor);
    if (anchor.anchorHash !== expectedAnchorHash) {
      return {
        valid: false,
        checked: 0,
        firstInvalidAnchorId: anchor.id,
        reason: "anchor hash mismatch",
      };
    }

    if (anchorsByHash.has(anchor.anchorHash)) {
      return {
        valid: false,
        checked: 0,
        firstInvalidAnchorId: anchor.id,
        reason: "duplicate anchor hash",
      };
    }

    const anchoredReceiptHash = receiptHashesById.get(anchor.receiptId);
    if (!anchoredReceiptHash) {
      return {
        valid: false,
        checked: 0,
        firstInvalidAnchorId: anchor.id,
        reason: `anchored receipt ${anchor.receiptId} is missing`,
      };
    }

    if (anchoredReceiptHash !== anchor.receiptHash) {
      return {
        valid: false,
        checked: 0,
        firstInvalidAnchorId: anchor.id,
        reason: `anchored receipt ${anchor.receiptId} hash mismatch`,
      };
    }

    anchorsByHash.set(anchor.anchorHash, anchor);
    const previousKey = anchor.previousAnchorHash ?? "";
    anchorsByPreviousHash.set(previousKey, [...(anchorsByPreviousHash.get(previousKey) ?? []), anchor]);
  }

  if (anchors.length === 0) {
    if (receiptRows.some((row) => typeof row.receipt_hash === "string")) {
      return {
        valid: false,
        checked: 0,
        reason: "missing global receipt anchors",
      };
    }
    if (head) {
      return {
        valid: false,
        checked: 0,
        reason: "global chain head exists without anchors",
      };
    }
    return { valid: true, checked: 0 };
  }

  if (!head) {
    return {
      valid: false,
      checked: 0,
      reason: "missing global chain head",
    };
  }

  const heads = anchorsByPreviousHash.get("") ?? [];
  if (anchors.length > 0 && heads.length !== 1) {
    return {
      valid: false,
      checked: 0,
      firstInvalidAnchorId: heads[0]?.id,
      reason: heads.length === 0 ? "missing global anchor head" : "multiple global anchor heads",
    };
  }

  let checked = 0;
  let cursor = heads[0];
  let tail: FederationReceiptAnchor | undefined;
  while (cursor) {
    checked += 1;
    tail = cursor;
    const nextAnchors = anchorsByPreviousHash.get(cursor.anchorHash) ?? [];
    if (nextAnchors.length > 1) {
      return {
        valid: false,
        checked,
        firstInvalidAnchorId: nextAnchors[0]?.id,
        reason: "global anchor chain fork",
      };
    }
    cursor = nextAnchors[0];
  }

  if (checked !== anchors.length) {
    const firstUnlinked = anchors.find(
      (anchor) => anchor.previousAnchorHash && !anchorsByHash.has(anchor.previousAnchorHash),
    );
    return {
      valid: false,
      checked,
      firstInvalidAnchorId: firstUnlinked?.id,
      reason: firstUnlinked
        ? `expected previous anchor hash ${firstUnlinked.previousAnchorHash}`
        : "unlinked global anchor chain",
    };
  }

  if (tail?.anchorHash !== head.anchor_hash) {
    return {
      valid: false,
      checked,
      firstInvalidAnchorId: tail?.id,
      reason: `global chain head expected ${head.anchor_hash}`,
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

function computeExpectedReceiptAnchorHash(anchor: FederationReceiptAnchor): string {
  return hashReceiptAnchor({
    id: anchor.id,
    previousAnchorHash: anchor.previousAnchorHash,
    receiptId: anchor.receiptId,
    receiptHash: anchor.receiptHash,
    createdAt: anchor.createdAt,
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

interface HashableReceiptAnchor {
  readonly id: string;
  readonly previousAnchorHash?: string;
  readonly receiptId: string;
  readonly receiptHash: string;
  readonly createdAt: string;
}

export function hashReceiptAnchor(anchor: HashableReceiptAnchor): string {
  const canonicalAnchor = canonicalize({
    createdAt: anchor.createdAt,
    id: anchor.id,
    previousAnchorHash: anchor.previousAnchorHash ?? null,
    receiptHash: anchor.receiptHash,
    receiptId: anchor.receiptId,
  });
  return `sha256:${createHash("sha256").update(canonicalAnchor).digest("hex")}`;
}

async function appendReceiptAnchor(options: {
  readonly db: BrainDb;
  readonly receipt: FederationReceipt;
}): Promise<FederationReceiptAnchor> {
  const previousAnchorHash = await readReceiptAnchorTailHash(options.db);
  const unsignedAnchor = {
    id: `anchor_${options.receipt.id}`,
    previousAnchorHash: previousAnchorHash ?? undefined,
    receiptId: options.receipt.id,
    receiptHash: options.receipt.receiptHash,
    createdAt: options.receipt.createdAt,
  };
  const anchor: FederationReceiptAnchor = {
    ...unsignedAnchor,
    anchorHash: hashReceiptAnchor(unsignedAnchor),
  };

  await options.db.execute(sql`
    INSERT INTO federation_receipt_anchors (
      id,
      previous_anchor_hash,
      receipt_id,
      receipt_hash,
      anchor_hash,
      created_at
    )
    VALUES (
      ${anchor.id},
      ${anchor.previousAnchorHash ?? null},
      ${anchor.receiptId},
      ${anchor.receiptHash},
      ${anchor.anchorHash},
      ${anchor.createdAt}
    )
  `);

  await options.db.execute(sql`
    INSERT INTO federation_receipt_chain_head (
      id,
      anchor_hash,
      updated_at
    )
    VALUES (
      ${"instance"},
      ${anchor.anchorHash},
      ${anchor.createdAt}
    )
    ON CONFLICT (id)
    DO UPDATE SET
      anchor_hash = EXCLUDED.anchor_hash,
      updated_at = EXCLUDED.updated_at
  `);

  return anchor;
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

async function readReceiptAnchorTailHash(db: BrainDb): Promise<string | undefined> {
  const rows = normalizeRows<{
    readonly previous_anchor_hash: string | null;
    readonly anchor_hash: string | null;
  }>(
    await db.execute(sql`
      SELECT previous_anchor_hash, anchor_hash
      FROM federation_receipt_anchors
    `),
  );
  const anchorHashes = new Set(rows.map((row) => row.anchor_hash).filter((hash): hash is string => typeof hash === "string"));
  const predecessorHashes = new Set(rows.map((row) => row.previous_anchor_hash).filter((hash): hash is string => typeof hash === "string"));
  const tails = [...anchorHashes].filter((hash) => !predecessorHashes.has(hash));
  if (tails.length > 1) {
    throw new Error("Cannot append receipt because the global receipt anchor chain has multiple tails.");
  }
  return tails[0];
}

async function listReceiptAnchors(db: BrainDb): Promise<readonly FederationReceiptAnchor[]> {
  await ensureReceiptTables(db);

  let rows: readonly ReceiptAnchorRow[];
  try {
    rows = normalizeRows<ReceiptAnchorRow>(
      await db.execute(sql`
        SELECT
          id,
          previous_anchor_hash,
          receipt_id,
          receipt_hash,
          anchor_hash,
          created_at
        FROM federation_receipt_anchors
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
    const createdAt = normalizeReceiptTimestamp(row.created_at);
    return {
      id: row.id,
      previousAnchorHash: row.previous_anchor_hash ?? undefined,
      receiptId: row.receipt_id,
      receiptHash: row.receipt_hash,
      anchorHash: row.anchor_hash ?? hashReceiptAnchor({
        id: row.id,
        previousAnchorHash: row.previous_anchor_hash ?? undefined,
        receiptId: row.receipt_id,
        receiptHash: row.receipt_hash,
        createdAt,
      }),
      createdAt,
    };
  });
}

async function readReceiptChainHead(db: BrainDb): Promise<ReceiptChainHeadRow | undefined> {
  try {
    const rows = normalizeRows<ReceiptChainHeadRow>(
      await db.execute(sql`
        SELECT id, anchor_hash, updated_at
        FROM federation_receipt_chain_head
        WHERE id = ${"instance"}
      `),
    );
    return rows[0];
  } catch (error) {
    if (isUndefinedTableError(error)) {
      return undefined;
    }

    throw error;
  }
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
