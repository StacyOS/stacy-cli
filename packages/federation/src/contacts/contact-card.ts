import { sign, verify } from "node:crypto";

import { canonicalBytes } from "../crypto/canonical.js";
import type { InstallIdentity } from "../identity/install-identity.js";
import { sha256Hex } from "../util/hash.js";
import { normalizeContactName, type FederationContact } from "./contact-store.js";

export const CONTACT_CARD_SCHEMA_VERSION = 1;
export const DEFAULT_FEDERATION_TENANT = "stacy/acme";

export interface ContactCardPayload {
  readonly kind: "federation_contact_card";
  readonly schemaVersion: typeof CONTACT_CARD_SCHEMA_VERSION;
  readonly tenant: string;
  readonly name: string;
  readonly label: string;
  readonly installId: string;
  readonly publicKeyPem: string;
  readonly federationEndpointUrl: string;
  readonly revocationUrl: string;
  readonly createdAt: string;
}

export interface SignedContactCard {
  readonly signedPayload: ContactCardPayload;
  readonly signer: {
    readonly installId: string;
    readonly publicKeyPem: string;
  };
  readonly signature: string;
}

export type ContactCardVerificationResult =
  | { readonly ok: true; readonly contact: FederationContact }
  | { readonly ok: false; readonly reason: string };

export function createSignedContactCard(options: {
  readonly identity: InstallIdentity;
  readonly name: string;
  readonly label?: string;
  readonly federationEndpointUrl: string;
  readonly revocationUrl: string;
  readonly tenant?: string;
  readonly createdAt?: Date;
}): SignedContactCard {
  const normalizedName = normalizeContactName(options.name);
  const payload: ContactCardPayload = {
    kind: "federation_contact_card",
    schemaVersion: CONTACT_CARD_SCHEMA_VERSION,
    tenant: options.tenant ?? DEFAULT_FEDERATION_TENANT,
    name: normalizedName,
    label: options.label?.trim() || normalizedName,
    installId: options.identity.record.installId,
    publicKeyPem: options.identity.record.publicKeyPem,
    federationEndpointUrl: options.federationEndpointUrl.trim(),
    revocationUrl: options.revocationUrl.trim(),
    createdAt: (options.createdAt ?? new Date()).toISOString(),
  };
  const signature = sign(null, canonicalBytes(payload), options.identity.privateKey);

  return {
    signedPayload: payload,
    signer: {
      installId: options.identity.record.installId,
      publicKeyPem: options.identity.record.publicKeyPem,
    },
    signature: signature.toString("base64"),
  };
}

export function verifySignedContactCard(
  card: SignedContactCard,
): ContactCardVerificationResult {
  try {
    const payload = card.signedPayload;
    if (payload.kind !== "federation_contact_card") {
      return { ok: false, reason: "Contact card has the wrong kind" };
    }
    if (payload.schemaVersion !== CONTACT_CARD_SCHEMA_VERSION) {
      return { ok: false, reason: `Unsupported contact card schema version ${payload.schemaVersion}` };
    }
    if (card.signer.installId !== payload.installId) {
      return { ok: false, reason: "Contact card signer does not match install" };
    }
    if (card.signer.publicKeyPem !== payload.publicKeyPem) {
      return { ok: false, reason: "Contact card signer key does not match payload key" };
    }
    const expectedInstallId = `install_${sha256Hex(payload.publicKeyPem).slice(0, 32)}`;
    if (payload.installId !== expectedInstallId) {
      return { ok: false, reason: "Contact card install id does not match public key" };
    }
    normalizeContactName(payload.name);

    const signatureOk = verify(
      null,
      canonicalBytes(payload),
      payload.publicKeyPem,
      Buffer.from(card.signature, "base64"),
    );
    if (!signatureOk) {
      return { ok: false, reason: "Contact card signature verification failed" };
    }

    return {
      ok: true,
      contact: {
        name: payload.name,
        label: payload.label,
        installId: payload.installId,
        federationEndpointUrl: payload.federationEndpointUrl,
        revocationUrl: payload.revocationUrl,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Contact card verification failed",
    };
  }
}

export function parseSignedContactCard(serialized: string): SignedContactCard {
  const parsed = JSON.parse(serialized) as unknown;
  if (!isSignedContactCard(parsed)) {
    throw new Error("Invalid signed contact card.");
  }
  return parsed;
}

function isSignedContactCard(value: unknown): value is SignedContactCard {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    isContactCardPayload(record.signedPayload) &&
    typeof record.signature === "string" &&
    typeof record.signer === "object" &&
    record.signer !== null &&
    !Array.isArray(record.signer) &&
    typeof (record.signer as { installId?: unknown }).installId === "string" &&
    typeof (record.signer as { publicKeyPem?: unknown }).publicKeyPem === "string"
  );
}

function isContactCardPayload(value: unknown): value is ContactCardPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === "federation_contact_card" &&
    record.schemaVersion === CONTACT_CARD_SCHEMA_VERSION &&
    typeof record.tenant === "string" &&
    typeof record.name === "string" &&
    typeof record.label === "string" &&
    typeof record.installId === "string" &&
    typeof record.publicKeyPem === "string" &&
    typeof record.federationEndpointUrl === "string" &&
    typeof record.revocationUrl === "string" &&
    typeof record.createdAt === "string"
  );
}
