import type { BrainDb } from "../brain/brain-store.js";
import { readRevocationTombstone, storeRevocationTombstone } from "../consent/revocation-store.js";
import type { SignedRevocationTombstone } from "../consent/revocation.js";
import { readRevocationSource } from "./revocation-source-store.js";

type FetchLike = (url: string, init?: { readonly method?: "GET" }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface LookupRevocationHttpOptions {
  readonly db: BrainDb;
  readonly koId: string;
  readonly grantId?: string;
}

export interface LookupRevocationHttpResult {
  readonly revoked: boolean;
  readonly tombstone: SignedRevocationTombstone | null;
}

export interface SyncRevocationFromProducerOptions {
  readonly db: BrainDb;
  readonly koId: string;
  readonly grantId?: string;
  readonly fetch?: FetchLike;
}

export async function lookupRevocationHttp(
  options: LookupRevocationHttpOptions,
): Promise<LookupRevocationHttpResult> {
  const tombstone = await readRevocationTombstone({
    db: options.db,
    koId: options.koId,
    grantId: options.grantId,
  });

  return {
    revoked: tombstone !== null,
    tombstone,
  };
}

export async function syncRevocationFromProducer(
  options: SyncRevocationFromProducerOptions,
): Promise<SignedRevocationTombstone | null> {
  const source = await readRevocationSource({ db: options.db, koId: options.koId });
  if (!source) return null;

  const url = new URL(source.lookupUrl);
  url.searchParams.set("koId", options.koId);
  if (options.grantId) {
    url.searchParams.set("grantId", options.grantId);
  }

  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(url.toString(), { method: "GET" });
  if (!response.ok) {
    throw new Error(`Revocation lookup failed with HTTP ${response.status}: ${await safeResponseText(response)}`);
  }

  const body = await response.json();
  const tombstone = parseLookupResponse(body);
  if (!tombstone) return null;

  await storeRevocationTombstone({
    db: options.db,
    tombstone,
  });
  return tombstone;
}

function parseLookupResponse(body: unknown): SignedRevocationTombstone | null {
  if (!isRecord(body)) {
    throw new Error("Revocation lookup response must be an object");
  }

  if (body.tombstone === null || body.tombstone === undefined) {
    return null;
  }

  if (!isRecord(body.tombstone)) {
    throw new Error("Revocation lookup tombstone must be an object");
  }

  return body.tombstone as unknown as SignedRevocationTombstone;
}

async function safeResponseText(response: { text(): Promise<string> }): Promise<string> {
  try {
    return (await response.text()) || "(empty response)";
  } catch {
    return "(unreadable response)";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
