import { sql } from "drizzle-orm";

import type { BrainDb, QueryResult } from "../brain/brain-store.js";

export interface ClaimReceivedNonceOptions {
  readonly db: BrainDb;
  readonly producerInstallId: string;
  readonly nonce: string;
  readonly receivedAt: Date;
  readonly expiresAt: Date;
}

interface ReceivedNonceRow {
  readonly nonce: string;
}

const ensuredReceivedNonceDbs = new WeakSet<BrainDb>();

export async function ensureReceivedNonceTables(db: BrainDb): Promise<void> {
  if (ensuredReceivedNonceDbs.has(db)) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_received_nonces (
      producer_install_id text NOT NULL,
      nonce text NOT NULL,
      received_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (producer_install_id, nonce)
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_received_nonces_expires_at_idx
      ON federation_received_nonces (expires_at)
  `);

  ensuredReceivedNonceDbs.add(db);
}

export async function claimReceivedNonce(options: ClaimReceivedNonceOptions): Promise<boolean> {
  await ensureReceivedNonceTables(options.db);

  await options.db.execute(sql`
    DELETE FROM federation_received_nonces
    WHERE expires_at <= ${options.receivedAt.toISOString()}
  `);

  const rows = normalizeRows<ReceivedNonceRow>(
    await options.db.execute(sql`
      INSERT INTO federation_received_nonces (
        producer_install_id,
        nonce,
        received_at,
        expires_at
      )
      VALUES (
        ${options.producerInstallId},
        ${options.nonce},
        ${options.receivedAt.toISOString()},
        ${options.expiresAt.toISOString()}
      )
      ON CONFLICT (producer_install_id, nonce) DO NOTHING
      RETURNING nonce
    `),
  );

  return rows.length === 1;
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
