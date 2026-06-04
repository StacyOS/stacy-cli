import { sql, type SQL } from "drizzle-orm";

import {
  type SignedKnowledgeObject,
  verifyKnowledgeObject,
} from "../ko/knowledge-object.js";
import type { ConsentGrantRecipient } from "../consent/grant.js";

export type BrainKnowledgeObjectSource = "local" | "federated";

export interface BrainDb {
  execute(query: SQL): Promise<unknown>;
}

export type QueryResult<T> = readonly T[] | { readonly rows: readonly T[] };

export interface StoredKnowledgeObjectProvenance {
  readonly source: BrainKnowledgeObjectSource;
  readonly creatorInstallId: string;
  readonly receivedFromInstallId?: string;
  readonly storedAt: string;
}

export interface StoreKnowledgeObjectOptions {
  readonly db: BrainDb;
  readonly ko: SignedKnowledgeObject;
  readonly source: BrainKnowledgeObjectSource;
  readonly receivedFromInstallId?: string;
  readonly storedAt?: Date;
}

export interface ReadKnowledgeObjectOptions {
  readonly db: BrainDb;
  readonly koId: string;
}

export type ReadKnowledgeObjectResult =
  | {
      readonly ok: true;
      readonly ko: SignedKnowledgeObject;
      readonly provenance: StoredKnowledgeObjectProvenance;
      readonly verification: { readonly contentHash: string };
      readonly consent?: {
        readonly grantId: string;
        readonly recipient?: ConsentGrantRecipient;
      };
    }
  | { readonly ok: false; readonly reason: string };

interface KnowledgeObjectRow {
  readonly id: string;
  readonly signed_payload_json: unknown;
  readonly signer_json: unknown;
  readonly signature: string;
  readonly provenance_json: unknown;
}

export async function ensureBrainTables(db: BrainDb): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS federation_knowledge_objects (
      id text PRIMARY KEY,
      tenant text NOT NULL,
      source text NOT NULL,
      creator_install_id text NOT NULL,
      content_hash text NOT NULL,
      content_type text NOT NULL,
      signed_payload_json jsonb NOT NULL,
      signer_json jsonb NOT NULL,
      signature text NOT NULL,
      provenance_json jsonb NOT NULL,
      read_only boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      stored_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_knowledge_objects_tenant_idx
      ON federation_knowledge_objects (tenant)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS federation_knowledge_objects_content_hash_idx
      ON federation_knowledge_objects (content_hash)
  `);
}

export async function storeKnowledgeObject(
  options: StoreKnowledgeObjectOptions,
): Promise<{ readonly id: string; readonly contentHash: string }> {
  const verification = verifyKnowledgeObject(options.ko);
  if (!verification.ok) {
    throw new Error(`Cannot store invalid Knowledge Object: ${verification.reason}`);
  }

  const storedAt = (options.storedAt ?? new Date()).toISOString();
  const provenance: StoredKnowledgeObjectProvenance = {
    source: options.source,
    creatorInstallId: options.ko.signedPayload.creatorInstallId,
    receivedFromInstallId: options.receivedFromInstallId,
    storedAt,
  };

  await ensureBrainTables(options.db);
  await options.db.execute(sql`
    INSERT INTO federation_knowledge_objects (
      id,
      tenant,
      source,
      creator_install_id,
      content_hash,
      content_type,
      signed_payload_json,
      signer_json,
      signature,
      provenance_json,
      read_only,
      created_at,
      stored_at
    )
    VALUES (
      ${options.ko.id},
      ${options.ko.signedPayload.tenant},
      ${options.source},
      ${options.ko.signedPayload.creatorInstallId},
      ${verification.contentHash},
      ${options.ko.signedPayload.contentType},
      ${JSON.stringify(options.ko.signedPayload)}::jsonb,
      ${JSON.stringify(options.ko.signer)}::jsonb,
      ${options.ko.signature},
      ${JSON.stringify(provenance)}::jsonb,
      ${options.source === "federated"},
      ${options.ko.signedPayload.createdAt},
      ${storedAt}
    )
    ON CONFLICT (id) DO UPDATE SET
      tenant = EXCLUDED.tenant,
      source = EXCLUDED.source,
      creator_install_id = EXCLUDED.creator_install_id,
      content_hash = EXCLUDED.content_hash,
      content_type = EXCLUDED.content_type,
      signed_payload_json = EXCLUDED.signed_payload_json,
      signer_json = EXCLUDED.signer_json,
      signature = EXCLUDED.signature,
      provenance_json = EXCLUDED.provenance_json,
      read_only = EXCLUDED.read_only,
      created_at = EXCLUDED.created_at,
      stored_at = EXCLUDED.stored_at
  `);

  return { id: options.ko.id, contentHash: verification.contentHash };
}

export async function readKnowledgeObject(
  options: ReadKnowledgeObjectOptions,
): Promise<ReadKnowledgeObjectResult> {
  let rows: readonly KnowledgeObjectRow[];
  try {
    rows = normalizeRows<KnowledgeObjectRow>(
      await options.db.execute(sql`
        SELECT
          id,
          signed_payload_json,
          signer_json,
          signature,
          provenance_json
        FROM federation_knowledge_objects
        WHERE id = ${options.koId}
        LIMIT 1
      `),
    );
  } catch (error) {
    if (isUndefinedTableError(error)) {
      return { ok: false, reason: `Knowledge Object not found: ${options.koId}` };
    }

    throw error;
  }

  const row = rows[0];
  if (!row) {
    return { ok: false, reason: `Knowledge Object not found: ${options.koId}` };
  }

  const ko: SignedKnowledgeObject = {
    id: row.id,
    signedPayload: row.signed_payload_json as SignedKnowledgeObject["signedPayload"],
    signer: row.signer_json as SignedKnowledgeObject["signer"],
    signature: row.signature,
  };
  const verification = verifyKnowledgeObject(ko);

  if (!verification.ok) {
    return { ok: false, reason: verification.reason };
  }

  return {
    ok: true,
    ko,
    provenance: row.provenance_json as StoredKnowledgeObjectProvenance,
    verification: { contentHash: verification.contentHash },
  };
}

export interface ListKnowledgeObjectsOptions {
  readonly db: BrainDb;
  readonly tenant?: string;
  readonly contentType?: string;
  readonly source?: BrainKnowledgeObjectSource;
  readonly limit?: number;
}

export interface KnowledgeObjectSummary {
  readonly id: string;
  readonly tenant: string;
  readonly source: BrainKnowledgeObjectSource;
  readonly creatorInstallId: string;
  readonly contentHash: string;
  readonly contentType: string;
  readonly createdAt: string;
  readonly storedAt: string;
}

interface KnowledgeObjectSummaryRow {
  readonly id: string;
  readonly tenant: string;
  readonly source: string;
  readonly creator_install_id: string;
  readonly content_hash: string;
  readonly content_type: string;
  readonly created_at: string;
  readonly stored_at: string;
}

export async function listKnowledgeObjects(
  options: ListKnowledgeObjectsOptions,
): Promise<readonly KnowledgeObjectSummary[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 100);
  const filters: SQL[] = [];
  if (options.tenant !== undefined) {
    filters.push(sql`tenant = ${options.tenant}`);
  }
  if (options.contentType !== undefined) {
    filters.push(sql`content_type = ${options.contentType}`);
  }
  if (options.source !== undefined) {
    filters.push(sql`source = ${options.source}`);
  }
  const whereClause =
    filters.length > 0 ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

  let rows: readonly KnowledgeObjectSummaryRow[];
  try {
    rows = normalizeRows<KnowledgeObjectSummaryRow>(
      await options.db.execute(sql`
        SELECT
          id,
          tenant,
          source,
          creator_install_id,
          content_hash,
          content_type,
          created_at,
          stored_at
        FROM federation_knowledge_objects
        ${whereClause}
        ORDER BY stored_at DESC
        LIMIT ${limit}
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
    tenant: row.tenant,
    source: row.source === "federated" ? "federated" : "local",
    creatorInstallId: row.creator_install_id,
    contentHash: row.content_hash,
    contentType: row.content_type,
    createdAt: String(row.created_at),
    storedAt: String(row.stored_at),
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
