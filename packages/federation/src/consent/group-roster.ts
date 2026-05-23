import { randomUUID, sign, verify } from "node:crypto";

import { canonicalBytes } from "../crypto/canonical.js";
import type { InstallIdentity } from "../identity/install-identity.js";
import { sha256Hex } from "../util/hash.js";

export const GROUP_ROSTER_SCHEMA_VERSION = 1;

export interface GroupRosterMember {
  readonly installId: string;
  readonly label?: string;
  readonly role?: string;
}

export interface GroupRosterUnsignedPayload {
  readonly kind: "group_roster";
  readonly schemaVersion: typeof GROUP_ROSTER_SCHEMA_VERSION;
  readonly tenant: string;
  readonly groupId: string;
  readonly label: string;
  readonly members: readonly GroupRosterMember[];
  readonly createdAt: string;
}

export interface GroupRosterSignedPayload extends GroupRosterUnsignedPayload {
  readonly rosterHash: string;
}

export interface SignedGroupRoster {
  readonly id: string;
  readonly signedPayload: GroupRosterSignedPayload;
  readonly signer: {
    readonly installId: string;
    readonly publicKeyPem: string;
  };
  readonly signature: string;
}

export interface CreateGroupRosterOptions {
  readonly tenant: string;
  readonly groupId: string;
  readonly label: string;
  readonly members: readonly GroupRosterMember[];
  readonly issuerIdentity: InstallIdentity;
  readonly createdAt?: Date;
  readonly idGenerator?: () => string;
}

export type GroupRosterVerificationResult =
  | { readonly ok: true; readonly rosterHash: string }
  | { readonly ok: false; readonly reason: string };

export function createGroupRoster(options: CreateGroupRosterOptions): SignedGroupRoster {
  const unsignedPayload: GroupRosterUnsignedPayload = {
    kind: "group_roster",
    schemaVersion: GROUP_ROSTER_SCHEMA_VERSION,
    tenant: options.tenant,
    groupId: normalizeGroupId(options.groupId),
    label: options.label.trim(),
    members: normalizeMembers(options.members),
    createdAt: (options.createdAt ?? new Date()).toISOString(),
  };
  const rosterHash = formatRosterHash(sha256Hex(canonicalBytes(unsignedPayload)));
  const signedPayload: GroupRosterSignedPayload = {
    ...unsignedPayload,
    rosterHash,
  };
  const signature = sign(null, canonicalBytes(signedPayload), options.issuerIdentity.privateKey);

  return {
    id: options.idGenerator?.() ?? defaultRosterId(rosterHash),
    signedPayload,
    signer: {
      installId: options.issuerIdentity.record.installId,
      publicKeyPem: options.issuerIdentity.record.publicKeyPem,
    },
    signature: signature.toString("base64"),
  };
}

export function verifyGroupRoster(roster: SignedGroupRoster): GroupRosterVerificationResult {
  try {
    if (roster.signedPayload.kind !== "group_roster") {
      return { ok: false, reason: "Group roster has the wrong kind" };
    }
    if (roster.signedPayload.schemaVersion !== GROUP_ROSTER_SCHEMA_VERSION) {
      return {
        ok: false,
        reason: `Unsupported group roster schema version ${roster.signedPayload.schemaVersion}`,
      };
    }
    if (roster.signedPayload.groupId !== normalizeGroupId(roster.signedPayload.groupId)) {
      return { ok: false, reason: "Group roster id is invalid" };
    }
    if (!roster.signedPayload.label.trim()) {
      return { ok: false, reason: "Group roster label is required" };
    }
    if (normalizeMembers(roster.signedPayload.members).length !== roster.signedPayload.members.length) {
      return { ok: false, reason: "Group roster members are invalid" };
    }

    const unsignedPayload: GroupRosterUnsignedPayload = {
      kind: roster.signedPayload.kind,
      schemaVersion: roster.signedPayload.schemaVersion,
      tenant: roster.signedPayload.tenant,
      groupId: roster.signedPayload.groupId,
      label: roster.signedPayload.label,
      members: roster.signedPayload.members,
      createdAt: roster.signedPayload.createdAt,
    };
    const expectedRosterHash = formatRosterHash(sha256Hex(canonicalBytes(unsignedPayload)));
    if (roster.signedPayload.rosterHash !== expectedRosterHash) {
      return { ok: false, reason: "Group roster hash mismatch" };
    }

    const signatureOk = verify(
      null,
      canonicalBytes(roster.signedPayload),
      roster.signer.publicKeyPem,
      Buffer.from(roster.signature, "base64"),
    );
    if (!signatureOk) {
      return { ok: false, reason: "Group roster signature verification failed" };
    }

    return { ok: true, rosterHash: expectedRosterHash };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Group roster verification failed",
    };
  }
}

export function groupRosterIncludesInstall(
  roster: SignedGroupRoster,
  installId: string,
  role?: string,
): boolean {
  const expectedRole = role?.trim();
  return roster.signedPayload.members.some((member) => (
    member.installId === installId &&
    (!expectedRole || member.role === expectedRole)
  ));
}

export function normalizeGroupId(groupId: string): string {
  const normalized = groupId.trim().toLowerCase();
  if (!/^group_[a-z0-9_-]+$/.test(normalized)) {
    throw new Error("Group id must start with group_ and contain only lowercase letters, numbers, underscores, or dashes.");
  }
  return normalized;
}

function normalizeMembers(members: readonly GroupRosterMember[]): readonly GroupRosterMember[] {
  const seen = new Set<string>();
  return members.map((member) => {
    const installId = member.installId.trim();
    if (!installId) {
      throw new Error("Group roster member install id is required.");
    }
    if (seen.has(installId)) {
      throw new Error(`Duplicate group roster member: ${installId}`);
    }
    seen.add(installId);
    return {
      installId,
      ...(member.label?.trim() ? { label: member.label.trim() } : {}),
      ...(member.role?.trim() ? { role: member.role.trim() } : {}),
    };
  });
}

function formatRosterHash(hash: string): string {
  return `sha256:${hash}`;
}

function defaultRosterId(rosterHash: string): string {
  const hash = rosterHash.replace(/^sha256:/, "");
  return hash.length > 0 ? `roster_${hash}` : `roster_${randomUUID()}`;
}
