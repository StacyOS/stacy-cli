import { sql } from "drizzle-orm";

import type { BrainDb } from "../brain/brain-store.js";
import {
  type SignedRevocationTombstone,
  verifyRevocationTombstone,
} from "./revocation.js";

export interface StoreRevocationTombstoneOptions {
  readonly db: BrainDb;
  readonly tombstone: SignedRevocationTombstone;
  readonly storedAt?: Date;
}

export interface ReadRevocationTombstoneOptions {
  readonly db: BrainDb;
  readonly koId: string;
  readonly grantId?: string;
}

interface RevocationTombstoneRow {
  readonly id: string;
  readonly signed_payload_json: unknown;
  readonly signer_json: unknown;
  readonly signature: string;
}

const ensuredRevocationTombstoneDbs = new WeakSet<BrainDb>();

export async function ensureRevocationTombstoneTables(db: BrainDb): Promise<void> {
  if (ensuredRevocationTombstoneDbs.has(db)) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_revocation_tombstones (
      id text PRIMARY KEY,
      tenant text NOT NULL,
      ko_id text NOT NULL,
      ko_content_hash text NOT NULL,
      revoked_grant_id text,
      issuer_install_id text NOT NULL,
      signed_payload_json jsonb NOT NULL,
      signer_json jsonb NOT NULL,
      signature text NOT NULL,
      stored_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_revocation_tombstones_ko_idx
      ON federation_revocation_tombstones (ko_id, stored_at)
  `);
  ensuredRevocationTombstoneDbs.add(db);
}

export async function storeRevocationTombstone(
  options: StoreRevocationTombstoneOptions,
): Promise<{ readonly id: string; readonly tombstoneHash: string }> {
  const verification = verifyRevocationTombstone(options.tombstone);
  if (!verification.ok) {
    throw new Error(`Cannot store invalid revocation tombstone: ${verification.reason}`);
  }

  await ensureRevocationTombstoneTables(options.db);
  await options.db.execute(sql`
    INSERT INTO federation_revocation_tombstones (
      id,
      tenant,
      ko_id,
      ko_content_hash,
      revoked_grant_id,
      issuer_install_id,
      signed_payload_json,
      signer_json,
      signature,
      stored_at
    )
    VALUES (
      ${options.tombstone.id},
      ${options.tombstone.signedPayload.tenant},
      ${options.tombstone.signedPayload.koId},
      ${options.tombstone.signedPayload.koContentHash},
      ${options.tombstone.signedPayload.revokedGrantId ?? null},
      ${options.tombstone.signedPayload.issuerInstallId},
      ${JSON.stringify(options.tombstone.signedPayload)}::jsonb,
      ${JSON.stringify(options.tombstone.signer)}::jsonb,
      ${options.tombstone.signature},
      ${(options.storedAt ?? new Date()).toISOString()}
    )
    ON CONFLICT (id) DO NOTHING
  `);

  return { id: options.tombstone.id, tombstoneHash: verification.tombstoneHash };
}

export async function readRevocationTombstone(
  options: ReadRevocationTombstoneOptions,
): Promise<SignedRevocationTombstone | null> {
  await ensureRevocationTombstoneTables(options.db);
  let rows: readonly RevocationTombstoneRow[];
  try {
    rows = normalizeRows<RevocationTombstoneRow>(
      options.grantId
        ? await options.db.execute(sql`
            SELECT id, signed_payload_json, signer_json, signature
            FROM federation_revocation_tombstones
            WHERE ko_id = ${options.koId}
              AND (revoked_grant_id IS NULL OR revoked_grant_id = ${options.grantId})
            ORDER BY stored_at DESC
            LIMIT 1
          `)
        : await options.db.execute(sql`
            SELECT id, signed_payload_json, signer_json, signature
            FROM federation_revocation_tombstones
            WHERE ko_id = ${options.koId}
            ORDER BY stored_at DESC
            LIMIT 1
          `),
    );
  } catch (error) {
    if (isUndefinedTableError(error)) {
      return null;
    }

    throw error;
  }

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    signedPayload: row.signed_payload_json as SignedRevocationTombstone["signedPayload"],
    signer: row.signer_json as SignedRevocationTombstone["signer"],
    signature: row.signature,
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
