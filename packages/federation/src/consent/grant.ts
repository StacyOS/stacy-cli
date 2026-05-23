import { randomUUID, sign, verify } from "node:crypto";

import { canonicalBytes } from "../crypto/canonical.js";
import type { InstallIdentity } from "../identity/install-identity.js";
import { sha256Hex } from "../util/hash.js";

export const CONSENT_GRANT_SCHEMA_VERSION = 1;
export const CONSENT_GRANT_SCOPE_READ = "read";
export const CONSENT_GRANT_SCOPE_WRITE = "write";
export const CONSENT_GRANT_SCOPE_ADMIN = "admin";
export const CONSENT_GRANT_SCOPES = [
  CONSENT_GRANT_SCOPE_READ,
  CONSENT_GRANT_SCOPE_WRITE,
  CONSENT_GRANT_SCOPE_ADMIN,
] as const;

export type ConsentGrantScope = typeof CONSENT_GRANT_SCOPES[number];

export interface ConsentGrantUnsignedPayload {
  readonly kind: "consent_grant";
  readonly schemaVersion: typeof CONSENT_GRANT_SCHEMA_VERSION;
  readonly tenant: string;
  readonly koId: string;
  readonly koContentHash: string;
  readonly producerInstallId: string;
  readonly consumerInstallId: string;
  readonly scope: ConsentGrantScope;
  readonly expiresAt: string;
  readonly revocable: boolean;
  readonly createdAt: string;
}

export interface ConsentGrantSignedPayload extends ConsentGrantUnsignedPayload {
  readonly grantHash: string;
}

export interface SignedConsentGrant {
  readonly id: string;
  readonly signedPayload: ConsentGrantSignedPayload;
  readonly signer: {
    readonly installId: string;
    readonly publicKeyPem: string;
  };
  readonly signature: string;
}

export interface CreateConsentGrantOptions {
  readonly tenant: string;
  readonly koId: string;
  readonly koContentHash: string;
  readonly producerIdentity: InstallIdentity;
  readonly consumerInstallId: string;
  readonly scope?: ConsentGrantScope;
  readonly expiresAt: Date;
  readonly revocable: boolean;
  readonly createdAt?: Date;
  readonly idGenerator?: () => string;
}

export type ConsentGrantVerificationResult =
  | { readonly ok: true; readonly grantHash: string }
  | { readonly ok: false; readonly reason: string };

export function createConsentGrant(
  options: CreateConsentGrantOptions,
): SignedConsentGrant {
  const unsignedPayload: ConsentGrantUnsignedPayload = {
    kind: "consent_grant",
    schemaVersion: CONSENT_GRANT_SCHEMA_VERSION,
    tenant: options.tenant,
    koId: options.koId,
    koContentHash: options.koContentHash,
    producerInstallId: options.producerIdentity.record.installId,
    consumerInstallId: options.consumerInstallId,
    scope: options.scope ?? CONSENT_GRANT_SCOPE_READ,
    expiresAt: options.expiresAt.toISOString(),
    revocable: options.revocable,
    createdAt: (options.createdAt ?? new Date()).toISOString(),
  };
  const grantHash = formatGrantHash(sha256Hex(canonicalBytes(unsignedPayload)));
  const signedPayload: ConsentGrantSignedPayload = {
    ...unsignedPayload,
    grantHash,
  };
  const signature = sign(
    null,
    canonicalBytes(signedPayload),
    options.producerIdentity.privateKey,
  );

  return {
    id: options.idGenerator?.() ?? defaultConsentGrantId(grantHash),
    signedPayload,
    signer: {
      installId: options.producerIdentity.record.installId,
      publicKeyPem: options.producerIdentity.record.publicKeyPem,
    },
    signature: signature.toString("base64"),
  };
}

export function verifyConsentGrant(
  grant: SignedConsentGrant,
): ConsentGrantVerificationResult {
  try {
    if (grant.signedPayload.kind !== "consent_grant") {
      return { ok: false, reason: "Consent grant has the wrong kind" };
    }

    if (grant.signedPayload.schemaVersion !== CONSENT_GRANT_SCHEMA_VERSION) {
      return {
        ok: false,
        reason: `Unsupported consent grant schema version ${grant.signedPayload.schemaVersion}`,
      };
    }

    if (!isConsentGrantScope(grant.signedPayload.scope)) {
      return { ok: false, reason: "Consent grant has unsupported scope" };
    }

    if (grant.signer.installId !== grant.signedPayload.producerInstallId) {
      return { ok: false, reason: "Signer install does not match producer install" };
    }

    const unsignedPayload: ConsentGrantUnsignedPayload = {
      kind: grant.signedPayload.kind,
      schemaVersion: grant.signedPayload.schemaVersion,
      tenant: grant.signedPayload.tenant,
      koId: grant.signedPayload.koId,
      koContentHash: grant.signedPayload.koContentHash,
      producerInstallId: grant.signedPayload.producerInstallId,
      consumerInstallId: grant.signedPayload.consumerInstallId,
      scope: grant.signedPayload.scope,
      expiresAt: grant.signedPayload.expiresAt,
      revocable: grant.signedPayload.revocable,
      createdAt: grant.signedPayload.createdAt,
    };
    const expectedGrantHash = formatGrantHash(sha256Hex(canonicalBytes(unsignedPayload)));

    if (grant.signedPayload.grantHash !== expectedGrantHash) {
      return { ok: false, reason: "Consent grant hash mismatch" };
    }

    const signatureOk = verify(
      null,
      canonicalBytes(grant.signedPayload),
      grant.signer.publicKeyPem,
      Buffer.from(grant.signature, "base64"),
    );

    if (!signatureOk) {
      return { ok: false, reason: "Consent grant signature verification failed" };
    }

    return { ok: true, grantHash: expectedGrantHash };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Consent grant verification failed",
    };
  }
}

export function isConsentGrantScope(value: unknown): value is ConsentGrantScope {
  return typeof value === "string" && CONSENT_GRANT_SCOPES.includes(value as ConsentGrantScope);
}

export function consentGrantScopeIncludesRead(scope: ConsentGrantScope): boolean {
  return (
    scope === CONSENT_GRANT_SCOPE_READ ||
    scope === CONSENT_GRANT_SCOPE_WRITE ||
    scope === CONSENT_GRANT_SCOPE_ADMIN
  );
}

export function consentGrantScopeIncludesWrite(scope: ConsentGrantScope): boolean {
  return scope === CONSENT_GRANT_SCOPE_WRITE || scope === CONSENT_GRANT_SCOPE_ADMIN;
}

function formatGrantHash(hash: string): string {
  return `sha256:${hash}`;
}

function defaultConsentGrantId(grantHash: string): string {
  const hash = grantHash.replace(/^sha256:/, "");
  return hash.length > 0 ? `grant_${hash}` : `grant_${randomUUID()}`;
}
