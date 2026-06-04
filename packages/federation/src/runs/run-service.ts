import { createLocalKnowledgeObject } from "../brain/local-brain.js";
import type { BrainDb } from "../brain/brain-store.js";
import { appendReceipt } from "../receipts/receipt-store.js";
import type { SignedKnowledgeObject } from "../ko/knowledge-object.js";
import type { AgentOutputContent } from "./agent-output.js";
import type { CanonicalJsonValue } from "../crypto/canonical.js";

export interface StoreAgentRunOutputOptions {
  readonly db: BrainDb;
  readonly identityPath: string;
  readonly content: AgentOutputContent & CanonicalJsonValue;
  readonly adapter: string;
  readonly model: string;
  readonly inputKoIds: readonly string[];
  readonly tenant?: string;
  readonly createdAt?: Date;
  readonly storedAt?: Date;
  readonly idGenerator?: () => string;
}

export interface StoreAgentRunOutputResult {
  readonly ko: SignedKnowledgeObject;
  readonly contentHash: string;
  readonly creatorInstallId: string;
}

/**
 * Persists an `agent_output` Knowledge Object produced by `stacy run` and
 * records its full receipt set: `create` + `sign` (from the local Brain write)
 * plus a `run` receipt capturing the adapter, model, and input KO provenance.
 */
export async function storeAgentRunOutput(
  options: StoreAgentRunOutputOptions,
): Promise<StoreAgentRunOutputResult> {
  const created = await createLocalKnowledgeObject({
    db: options.db,
    identityPath: options.identityPath,
    tenant: options.tenant,
    contentType: "application/json",
    content: options.content,
    createdAt: options.createdAt,
    storedAt: options.storedAt,
    idGenerator: options.idGenerator,
  });

  await appendReceipt({
    db: options.db,
    eventType: "run",
    tenant: created.ko.signedPayload.tenant,
    koId: created.ko.id,
    actorInstallId: created.creatorInstallId,
    payload: {
      adapter: options.adapter,
      model: options.model,
      inputKoIds: [...options.inputKoIds],
      outputContentHash: created.contentHash,
    },
    createdAt: options.storedAt ?? options.createdAt,
  });

  return {
    ko: created.ko,
    contentHash: created.contentHash,
    creatorInstallId: created.creatorInstallId,
  };
}
