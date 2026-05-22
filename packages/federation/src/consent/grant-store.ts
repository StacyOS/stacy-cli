import { sql } from "drizzle-orm";

import type { BrainDb } from "../brain/brain-store.js";
import { type SignedConsentGrant, verifyConsentGrant } from "./grant.js";

export interface StoreConsentGrantOptions {
  readonly db: BrainDb;
  readonly grant: SignedConsentGrant;
  readonly storedAt?: Date;
}

export interface ReadConsentGrantOptions {
  readonly db: BrainDb;
  readonly koId: string;
  readonly consumerInstallId: string;
}

interface ConsentGrantRow {
  readonly id: string;
  readonly signed_payload_json: unknown;
  readonly signer_json: unknown;
  readonly signature: string;
}

export async function ensureConsentGrantTables(db: BrainDb): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_consent_grants (
      id text PRIMARY KEY,
      tenant text NOT NULL,
      ko_id text NOT NULL,
      ko_content_hash text NOT NULL,
      producer_install_id text NOT NULL,
      consumer_install_id text NOT NULL,
      scope text NOT NULL,
      expires_at timestamptz NOT NULL,
      signed_payload_json jsonb NOT NULL,
      signer_json jsonb NOT NULL,
      signature text NOT NULL,
      stored_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_consent_grants_ko_consumer_idx
      ON federation_consent_grants (ko_id, consumer_install_id)
  `);
}

export async function storeConsentGrant(
  options: StoreConsentGrantOptions,
): Promise<{ readonly id: string; readonly grantHash: string }> {
  const verification = verifyConsentGrant(options.grant);
  if (!verification.ok) {
    throw new Error(`Cannot store invalid consent grant: ${verification.reason}`);
  }

  await ensureConsentGrantTables(options.db);
  await options.db.execute(sql`
    INSERT INTO federation_consent_grants (
      id,
      tenant,
      ko_id,
      ko_content_hash,
      producer_install_id,
      consumer_install_id,
      scope,
      expires_at,
      signed_payload_json,
      signer_json,
      signature,
      stored_at
    )
    VALUES (
      ${options.grant.id},
      ${options.grant.signedPayload.tenant},
      ${options.grant.signedPayload.koId},
      ${options.grant.signedPayload.koContentHash},
      ${options.grant.signedPayload.producerInstallId},
      ${options.grant.signedPayload.consumerInstallId},
      ${options.grant.signedPayload.scope},
      ${options.grant.signedPayload.expiresAt},
      ${JSON.stringify(options.grant.signedPayload)}::jsonb,
      ${JSON.stringify(options.grant.signer)}::jsonb,
      ${options.grant.signature},
      ${(options.storedAt ?? new Date()).toISOString()}
    )
    ON CONFLICT (id) DO UPDATE SET
      tenant = EXCLUDED.tenant,
      ko_id = EXCLUDED.ko_id,
      ko_content_hash = EXCLUDED.ko_content_hash,
      producer_install_id = EXCLUDED.producer_install_id,
      consumer_install_id = EXCLUDED.consumer_install_id,
      scope = EXCLUDED.scope,
      expires_at = EXCLUDED.expires_at,
      signed_payload_json = EXCLUDED.signed_payload_json,
      signer_json = EXCLUDED.signer_json,
      signature = EXCLUDED.signature,
      stored_at = EXCLUDED.stored_at
  `);

  return { id: options.grant.id, grantHash: verification.grantHash };
}

export async function readConsentGrant(
  options: ReadConsentGrantOptions,
): Promise<SignedConsentGrant | null> {
  let rows: readonly ConsentGrantRow[];
  try {
    rows = normalizeRows<ConsentGrantRow>(
      await options.db.execute(sql`
        SELECT id, signed_payload_json, signer_json, signature
        FROM federation_consent_grants
        WHERE ko_id = ${options.koId}
          AND consumer_install_id = ${options.consumerInstallId}
        ORDER BY expires_at DESC
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
    signedPayload: row.signed_payload_json as SignedConsentGrant["signedPayload"],
    signer: row.signer_json as SignedConsentGrant["signer"],
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
