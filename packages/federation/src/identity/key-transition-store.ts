import { sql } from "drizzle-orm";

import type { BrainDb } from "../brain/brain-store.js";
import {
  type SignedKeyTransition,
  verifyKeyTransition,
} from "./key-transition.js";

export interface StoreKeyTransitionOptions {
  readonly db: BrainDb;
  readonly transition: SignedKeyTransition;
  readonly storedAt?: Date;
}

export interface ListKeyTransitionsOptions {
  readonly db: BrainDb;
}

interface KeyTransitionRow {
  readonly id: string;
  readonly signed_payload_json: unknown;
  readonly old_signer_json: unknown;
  readonly new_signer_json: unknown;
  readonly old_signature: string;
  readonly new_signature: string;
}

export async function ensureKeyTransitionTables(db: BrainDb): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_key_transitions (
      id text PRIMARY KEY,
      old_install_id text NOT NULL,
      new_install_id text NOT NULL,
      effective_at timestamptz NOT NULL,
      signed_payload_json jsonb NOT NULL,
      old_signer_json jsonb NOT NULL,
      new_signer_json jsonb NOT NULL,
      old_signature text NOT NULL,
      new_signature text NOT NULL,
      stored_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_key_transitions_effective_at_idx
      ON federation_key_transitions (effective_at, id)
  `);
}

export async function storeKeyTransition(
  options: StoreKeyTransitionOptions,
): Promise<{ readonly id: string }> {
  const verification = verifyKeyTransition(options.transition);
  if (!verification.ok) {
    throw new Error(`Cannot store invalid key transition: ${verification.reason}`);
  }

  await ensureKeyTransitionTables(options.db);
  await options.db.execute(sql`
    INSERT INTO federation_key_transitions (
      id,
      old_install_id,
      new_install_id,
      effective_at,
      signed_payload_json,
      old_signer_json,
      new_signer_json,
      old_signature,
      new_signature,
      stored_at
    )
    VALUES (
      ${options.transition.id},
      ${options.transition.signedPayload.oldInstallId},
      ${options.transition.signedPayload.newInstallId},
      ${options.transition.signedPayload.effectiveAt},
      ${JSON.stringify(options.transition.signedPayload)}::jsonb,
      ${JSON.stringify(options.transition.oldSigner)}::jsonb,
      ${JSON.stringify(options.transition.newSigner)}::jsonb,
      ${options.transition.oldSignature},
      ${options.transition.newSignature},
      ${(options.storedAt ?? new Date()).toISOString()}
    )
    ON CONFLICT (id) DO NOTHING
  `);

  return { id: options.transition.id };
}

export async function listKeyTransitions(
  options: ListKeyTransitionsOptions,
): Promise<readonly SignedKeyTransition[]> {
  await ensureKeyTransitionTables(options.db);
  let rows: readonly KeyTransitionRow[];
  try {
    rows = normalizeRows<KeyTransitionRow>(
      await options.db.execute(sql`
        SELECT id, signed_payload_json, old_signer_json, new_signer_json, old_signature, new_signature
        FROM federation_key_transitions
        ORDER BY effective_at ASC, id ASC
      `),
    );
  } catch (error) {
    if (isUndefinedTableError(error)) return [];
    throw error;
  }

  return rows.map((row) => ({
    id: row.id,
    signedPayload: row.signed_payload_json as SignedKeyTransition["signedPayload"],
    oldSigner: row.old_signer_json as SignedKeyTransition["oldSigner"],
    newSigner: row.new_signer_json as SignedKeyTransition["newSigner"],
    oldSignature: row.old_signature,
    newSignature: row.new_signature,
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
