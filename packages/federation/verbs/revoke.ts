import { createDb } from "@arpanstacy/stacy-db";

import { readKnowledgeObject, type BrainDb } from "../src/brain/brain-store.js";
import { createRevocationTombstone } from "../src/consent/revocation.js";
import { storeRevocationTombstone } from "../src/consent/revocation-store.js";
import { loadInstallIdentity } from "../src/identity/install-identity.js";
import { appendReceipt } from "../src/receipts/receipt-store.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface RevokeOptions extends LocalRuntimeOptions {
  readonly reason: string;
  readonly grantId?: string;
  readonly json?: boolean;
}

export interface RevokeDependencies extends LocalRuntimeDependencies {
  readonly createDb?: (connectionString: string) => BrainDb;
  readonly stdout?: Pick<typeof console, "log">;
  readonly now?: () => Date;
}

export async function revokeCommand(
  koId: string,
  options: RevokeOptions,
  dependencies: RevokeDependencies = {},
): Promise<void> {
  const reason = options.reason.trim();
  if (!reason) {
    throw new Error("Revocation reason is required");
  }

  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const ownsDb = dependencies.createDb === undefined;
  const db = dependencies.createDb?.(runtime.connectionString) ?? createDb(runtime.connectionString);

  try {
    const read = await readKnowledgeObject({ db, koId });
    if (!read.ok) {
      throw new Error(read.reason);
    }

    if (read.provenance.source !== "local") {
      throw new Error("Only local Knowledge Objects can be revoked by this install");
    }

    const issuerIdentity = await loadInstallIdentity(runtime.identityPath);
    if (read.ko.signedPayload.creatorInstallId !== issuerIdentity.record.installId) {
      throw new Error("Revocation issuer does not own this Knowledge Object");
    }

    const now = dependencies.now?.() ?? new Date();
    const tombstone = createRevocationTombstone({
      tenant: read.ko.signedPayload.tenant,
      koId: read.ko.id,
      koContentHash: read.ko.signedPayload.contentHash,
      revokedGrantId: options.grantId,
      issuerIdentity,
      reason,
      createdAt: now,
    });
    await storeRevocationTombstone({ db, tombstone, storedAt: now });
    await appendReceipt({
      db,
      eventType: "revoke",
      tenant: read.ko.signedPayload.tenant,
      koId: read.ko.id,
      actorInstallId: issuerIdentity.record.installId,
      payload: {
        tombstoneId: tombstone.id,
        tombstoneHash: tombstone.signedPayload.tombstoneHash,
        revokedGrantId: options.grantId,
        reason,
      },
      createdAt: now,
    });

    if (options.json) {
      stdout.log(JSON.stringify(formatRevokeJson(tombstone), null, 2));
      return;
    }

    stdout.log(formatRevokeText(tombstone));
  } finally {
    if (ownsDb) {
      await closeDb(db);
    }
  }
}

function formatRevokeJson(tombstone: ReturnType<typeof createRevocationTombstone>) {
  return {
    tombstone,
    tombstoneId: tombstone.id,
    koId: tombstone.signedPayload.koId,
    tombstoneHash: tombstone.signedPayload.tombstoneHash,
    issuerInstallId: tombstone.signedPayload.issuerInstallId,
    revokedGrantId: tombstone.signedPayload.revokedGrantId,
    reason: tombstone.signedPayload.reason,
  };
}

function formatRevokeText(tombstone: ReturnType<typeof createRevocationTombstone>): string {
  return [
    `Revoked Knowledge Object: ${tombstone.signedPayload.koId}`,
    `Tombstone: ${tombstone.id}`,
    `Issuer: ${tombstone.signedPayload.issuerInstallId}`,
    `Reason: ${tombstone.signedPayload.reason}`,
  ].join("\n");
}

async function closeDb(db: BrainDb): Promise<void> {
  const maybeDb = db as { readonly $client?: { end?: () => Promise<unknown> } };
  await maybeDb.$client?.end?.();
}
