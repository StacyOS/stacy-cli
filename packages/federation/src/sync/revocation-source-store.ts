import { sql } from "drizzle-orm";

import type { BrainDb } from "../brain/brain-store.js";

export interface StoreRevocationSourceOptions {
  readonly db: BrainDb;
  readonly koId: string;
  readonly producerInstallId: string;
  readonly lookupUrl: string;
  readonly storedAt?: Date;
}

export interface ReadRevocationSourceOptions {
  readonly db: BrainDb;
  readonly koId: string;
}

export interface StoredRevocationSource {
  readonly koId: string;
  readonly producerInstallId: string;
  readonly lookupUrl: string;
}

interface RevocationSourceRow {
  readonly ko_id: string;
  readonly producer_install_id: string;
  readonly lookup_url: string;
}

const ensuredRevocationSourceDbs = new WeakSet<BrainDb>();

export async function ensureRevocationSourceTables(db: BrainDb): Promise<void> {
  if (ensuredRevocationSourceDbs.has(db)) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_revocation_sources (
      ko_id text PRIMARY KEY,
      producer_install_id text NOT NULL,
      lookup_url text NOT NULL,
      stored_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  ensuredRevocationSourceDbs.add(db);
}

export async function storeRevocationSource(options: StoreRevocationSourceOptions): Promise<void> {
  await ensureRevocationSourceTables(options.db);
  await options.db.execute(sql`
    INSERT INTO federation_revocation_sources (
      ko_id,
      producer_install_id,
      lookup_url,
      stored_at
    )
    VALUES (
      ${options.koId},
      ${options.producerInstallId},
      ${options.lookupUrl},
      ${(options.storedAt ?? new Date()).toISOString()}
    )
    ON CONFLICT (ko_id) DO UPDATE SET
      producer_install_id = EXCLUDED.producer_install_id,
      lookup_url = EXCLUDED.lookup_url,
      stored_at = EXCLUDED.stored_at
  `);
}

export async function readRevocationSource(
  options: ReadRevocationSourceOptions,
): Promise<StoredRevocationSource | null> {
  await ensureRevocationSourceTables(options.db);
  let rows: readonly RevocationSourceRow[];
  try {
    rows = normalizeRows<RevocationSourceRow>(
      await options.db.execute(sql`
        SELECT ko_id, producer_install_id, lookup_url
        FROM federation_revocation_sources
        WHERE ko_id = ${options.koId}
        LIMIT 1
      `),
    );
  } catch (error) {
    if (isUndefinedTableError(error)) return null;
    throw error;
  }

  const row = rows[0];
  if (!row) return null;

  return {
    koId: row.ko_id,
    producerInstallId: row.producer_install_id,
    lookupUrl: row.lookup_url,
  };
}

function normalizeRows<T>(result: unknown): readonly T[] {
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
