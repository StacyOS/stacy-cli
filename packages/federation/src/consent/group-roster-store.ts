import { sql } from "drizzle-orm";

import type { BrainDb } from "../brain/brain-store.js";
import {
  type SignedGroupRoster,
  verifyGroupRoster,
} from "./group-roster.js";

export interface StoreGroupRosterOptions {
  readonly db: BrainDb;
  readonly roster: SignedGroupRoster;
  readonly storedAt?: Date;
}

export interface ReadGroupRosterOptions {
  readonly db: BrainDb;
  readonly groupId: string;
}

interface GroupRosterRow {
  readonly id: string;
  readonly signed_payload_json: unknown;
  readonly signer_json: unknown;
  readonly signature: string;
}

export async function ensureGroupRosterTables(db: BrainDb): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_group_rosters (
      id text PRIMARY KEY,
      tenant text NOT NULL,
      group_id text NOT NULL,
      label text NOT NULL,
      roster_hash text NOT NULL,
      issuer_install_id text NOT NULL,
      signed_payload_json jsonb NOT NULL,
      signer_json jsonb NOT NULL,
      signature text NOT NULL,
      stored_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_group_rosters_group_idx
      ON federation_group_rosters (group_id, stored_at)
  `);
}

export async function storeGroupRoster(
  options: StoreGroupRosterOptions,
): Promise<{ readonly id: string; readonly rosterHash: string }> {
  const verification = verifyGroupRoster(options.roster);
  if (!verification.ok) {
    throw new Error(`Cannot store invalid group roster: ${verification.reason}`);
  }

  await ensureGroupRosterTables(options.db);
  await options.db.execute(sql`
    INSERT INTO federation_group_rosters (
      id,
      tenant,
      group_id,
      label,
      roster_hash,
      issuer_install_id,
      signed_payload_json,
      signer_json,
      signature,
      stored_at
    )
    VALUES (
      ${options.roster.id},
      ${options.roster.signedPayload.tenant},
      ${options.roster.signedPayload.groupId},
      ${options.roster.signedPayload.label},
      ${verification.rosterHash},
      ${options.roster.signer.installId},
      ${JSON.stringify(options.roster.signedPayload)}::jsonb,
      ${JSON.stringify(options.roster.signer)}::jsonb,
      ${options.roster.signature},
      ${(options.storedAt ?? new Date()).toISOString()}
    )
    ON CONFLICT (id) DO UPDATE SET
      tenant = EXCLUDED.tenant,
      group_id = EXCLUDED.group_id,
      label = EXCLUDED.label,
      roster_hash = EXCLUDED.roster_hash,
      issuer_install_id = EXCLUDED.issuer_install_id,
      signed_payload_json = EXCLUDED.signed_payload_json,
      signer_json = EXCLUDED.signer_json,
      signature = EXCLUDED.signature,
      stored_at = EXCLUDED.stored_at
  `);

  return { id: options.roster.id, rosterHash: verification.rosterHash };
}

export async function readGroupRoster(
  options: ReadGroupRosterOptions,
): Promise<SignedGroupRoster | null> {
  await ensureGroupRosterTables(options.db);
  let rows: readonly GroupRosterRow[];
  try {
    rows = normalizeRows<GroupRosterRow>(
      await options.db.execute(sql`
        SELECT id, signed_payload_json, signer_json, signature
        FROM federation_group_rosters
        WHERE group_id = ${options.groupId}
        ORDER BY stored_at DESC
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
    id: row.id,
    signedPayload: row.signed_payload_json as SignedGroupRoster["signedPayload"],
    signer: row.signer_json as SignedGroupRoster["signer"],
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
