import type { BrainDb } from "../brain/brain-store.js";
import {
  receiveFederationMessage,
  type FederationKnowledgeObjectMessage,
} from "./federation-message.js";

export interface ReceiveFederationHttpOptions {
  readonly db: BrainDb;
  readonly body: unknown;
  readonly receivedAt?: Date;
}

export interface ReceiveFederationHttpResult {
  readonly accepted: true;
  readonly koId: string;
  readonly grantId: string;
  readonly contentHash: string;
  readonly producerInstallId: string;
  readonly consumerInstallId: string;
  readonly revocationLookupUrl?: string;
}

export async function receiveFederationHttpMessage(
  options: ReceiveFederationHttpOptions,
): Promise<ReceiveFederationHttpResult> {
  const message = parseFederationMessageBody(options.body);
  const stored = await receiveFederationMessage({
    db: options.db,
    message,
    receivedAt: options.receivedAt,
  });

  return {
    accepted: true,
    koId: stored.koId,
    grantId: stored.grantId,
    contentHash: stored.contentHash,
    producerInstallId: message.producerInstallId,
    consumerInstallId: message.consumerInstallId,
    revocationLookupUrl: message.revocationLookupUrl,
  };
}

function parseFederationMessageBody(body: unknown): FederationKnowledgeObjectMessage {
  if (!isRecord(body)) {
    throw new Error("Federation request body must be an object");
  }

  const candidate = "message" in body ? body.message : body;
  if (!isRecord(candidate)) {
    throw new Error("Federation request body must include a message object");
  }

  if (candidate.kind !== "federation_ko_message") {
    throw new Error("Federation message has the wrong kind");
  }

  return candidate as unknown as FederationKnowledgeObjectMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
