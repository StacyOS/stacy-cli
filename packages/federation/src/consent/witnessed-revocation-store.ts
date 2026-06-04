import { sql } from "drizzle-orm";

import type { BrainDb } from "../brain/brain-store.js";
import type { SignedRevocationTombstone } from "./revocation.js";
import {
  type SignedWitnessedRevocation,
  verifyWitnessedRevocation,
} from "./witnessed-revocation.js";

export interface StoreWitnessedRevocationOptions {
  readonly db: BrainDb;
  readonly witnessed: SignedWitnessedRevocation;
  readonly tombstone: SignedRevocationTombstone;
  readonly storedAt?: Date;
}

export interface ListWitnessedRevocationsOptions {
  readonly db: BrainDb;
  readonly tombstoneId: string;
}

interface WitnessedRevocationRow {
  readonly id: string;
  readonly signed_payload_json: unknown;
  readonly witness_json: unknown;
  readonly signature: string;
}

export async function ensureWitnessedRevocationTables(db: BrainDb): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_witnessed_revocations (
      id text PRIMARY KEY,
      tenant text NOT NULL,
      ko_id text NOT NULL,
      tombstone_id text NOT NULL,
      witness_id text NOT NULL,
      signed_payload_json jsonb NOT NULL,
      witness_json jsonb NOT NULL,
      signature text NOT NULL,
      stored_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_witnessed_revocations_tombstone_idx
      ON federation_witnessed_revocations (tombstone_id, stored_at)
  `);
}

export async function storeWitnessedRevocation(
  options: StoreWitnessedRevocationOptions,
): Promise<{ readonly id: string }> {
  const verification = verifyWitnessedRevocation(options.witnessed, options.tombstone);
  if (!verification.ok) {
    throw new Error(`Cannot store invalid witnessed revocation: ${verification.reason}`);
  }

  await ensureWitnessedRevocationTables(options.db);
  await options.db.execute(sql`
    INSERT INTO federation_witnessed_revocations (
      id,
      tenant,
      ko_id,
      tombstone_id,
      witness_id,
      signed_payload_json,
      witness_json,
      signature,
      stored_at
    )
    VALUES (
      ${options.witnessed.id},
      ${options.witnessed.signedPayload.tenant},
      ${options.witnessed.signedPayload.koId},
      ${options.witnessed.signedPayload.tombstoneId},
      ${options.witnessed.witness.witnessId},
      ${JSON.stringify(options.witnessed.signedPayload)}::jsonb,
      ${JSON.stringify(options.witnessed.witness)}::jsonb,
      ${options.witnessed.signature},
      ${(options.storedAt ?? new Date()).toISOString()}
    )
    ON CONFLICT (id) DO NOTHING
  `);

  return { id: options.witnessed.id };
}

export async function listWitnessedRevocations(
  options: ListWitnessedRevocationsOptions,
): Promise<readonly SignedWitnessedRevocation[]> {
  await ensureWitnessedRevocationTables(options.db);
  let rows: readonly WitnessedRevocationRow[];
  try {
    rows = normalizeRows<WitnessedRevocationRow>(
      await options.db.execute(sql`
        SELECT id, signed_payload_json, witness_json, signature
        FROM federation_witnessed_revocations
        WHERE tombstone_id = ${options.tombstoneId}
        ORDER BY stored_at ASC, id ASC
      `),
    );
  } catch (error) {
    if (isUndefinedTableError(error)) return [];
    throw error;
  }

  return rows.map((row) => ({
    id: row.id,
    signedPayload: row.signed_payload_json as SignedWitnessedRevocation["signedPayload"],
    witness: row.witness_json as SignedWitnessedRevocation["witness"],
    signature: row.signature,
  }));
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
