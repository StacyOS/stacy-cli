import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "../identity/install-identity.js";
import { createKnowledgeObject } from "../ko/knowledge-object.js";
import {
  createDelegationGrant,
  enforceDelegationChainDepth,
  enforceDelegationGrant,
  MAX_DELEGATION_DEPTH,
  verifyDelegationGrant,
} from "./delegation.js";
import { createRevocationTombstone } from "./revocation.js";

describe("delegation grants", () => {
  it("creates and verifies a signed delegation grant", () => {
    const producer = createInstallIdentity();
    const delegate = createInstallIdentity();
    const recipient = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/clinic",
      contentType: "application/json",
      content: { title: "Referral" },
      identity: producer,
      idGenerator: () => "ko_referral",
    });
    const delegation = createDelegationGrant({
      tenant: "stacy/clinic",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerInstallId: producer.record.installId,
      delegateIdentity: delegate,
      recipient: { type: "install", id: recipient.record.installId },
      sourceGrantId: "grant_write_source",
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "delegation_referral",
    });

    expect(verifyDelegationGrant(delegation)).toEqual({
      ok: true,
      delegationHash: delegation.signedPayload.delegationHash,
    });
    expect(
      enforceDelegationGrant({
        delegation,
        producerInstallId: producer.record.installId,
        delegateInstallId: delegate.record.installId,
        koId: ko.id,
        koContentHash: ko.signedPayload.contentHash,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).toEqual({ ok: true, delegationId: "delegation_referral" });
  });

  it("rejects forged delegation signatures", () => {
    const producer = createInstallIdentity();
    const delegate = createInstallIdentity();
    const recipient = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/clinic",
      contentType: "application/json",
      content: { title: "Referral" },
      identity: producer,
    });
    const delegation = createDelegationGrant({
      tenant: "stacy/clinic",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerInstallId: producer.record.installId,
      delegateIdentity: delegate,
      recipient: { type: "install", id: recipient.record.installId },
      sourceGrantId: "grant_write_source",
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
    });

    expect(
      verifyDelegationGrant({
        ...delegation,
        signedPayload: {
          ...delegation.signedPayload,
          recipient: { type: "install", id: "install_attacker" },
        },
      }),
    ).toEqual({ ok: false, reason: "Delegation grant hash mismatch" });
  });

  it("denies revoked delegation grants", () => {
    const producer = createInstallIdentity();
    const delegate = createInstallIdentity();
    const recipient = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/clinic",
      contentType: "application/json",
      content: { title: "Referral" },
      identity: producer,
    });
    const delegation = createDelegationGrant({
      tenant: "stacy/clinic",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerInstallId: producer.record.installId,
      delegateIdentity: delegate,
      recipient: { type: "install", id: recipient.record.installId },
      sourceGrantId: "grant_write_source",
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      idGenerator: () => "delegation_referral",
    });
    const revocation = createRevocationTombstone({
      tenant: "stacy/clinic",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      revokedGrantId: delegation.id,
      issuerIdentity: producer,
      reason: "Delegation withdrawn",
    });

    expect(
      enforceDelegationGrant({
        delegation,
        producerInstallId: producer.record.installId,
        delegateInstallId: delegate.record.installId,
        koId: ko.id,
        koContentHash: ko.signedPayload.contentHash,
        revocation,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).toEqual({ ok: false, reason: "Delegation grant has been revoked" });
  });

  it("allows delegation chains within the documented depth limit", () => {
    const chain = createDelegationChain(3);

    expect(MAX_DELEGATION_DEPTH).toBe(4);
    expect(enforceDelegationChainDepth(chain)).toEqual({
      ok: true,
      delegationId: chain[2].id,
    });
    expect(
      enforceDelegationGrant({
        delegation: chain[2],
        delegationChain: chain,
        producerInstallId: chain[2].signedPayload.producerInstallId,
        delegateInstallId: chain[2].signedPayload.delegateInstallId,
        koId: chain[2].signedPayload.koId,
        koContentHash: chain[2].signedPayload.koContentHash,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).toEqual({ ok: true, delegationId: chain[2].id });
  });

  it("rejects delegation chains beyond the documented depth limit", () => {
    const chain = createDelegationChain(5);

    expect(enforceDelegationChainDepth(chain)).toEqual({
      ok: false,
      reason: "Delegation chain depth 5 exceeds the limit of 4.",
    });
    expect(
      enforceDelegationGrant({
        delegation: chain[4],
        delegationChain: chain,
        producerInstallId: chain[4].signedPayload.producerInstallId,
        delegateInstallId: chain[4].signedPayload.delegateInstallId,
        koId: chain[4].signedPayload.koId,
        koContentHash: chain[4].signedPayload.koContentHash,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).toEqual({
      ok: false,
      reason: "Delegation chain depth 5 exceeds the limit of 4.",
    });
  });
});

function createDelegationChain(depth: number) {
  const producer = createInstallIdentity();
  const ko = createKnowledgeObject({
    tenant: "stacy/clinic",
    contentType: "application/json",
    content: { title: "Referral" },
    identity: producer,
    idGenerator: () => "ko_referral",
  });
  const identities = Array.from({ length: depth + 1 }, () => createInstallIdentity());
  return Array.from({ length: depth }, (_, index) => createDelegationGrant({
    tenant: "stacy/clinic",
    koId: ko.id,
    koContentHash: ko.signedPayload.contentHash,
    producerInstallId: producer.record.installId,
    delegateIdentity: identities[index],
    recipient: { type: "install", id: identities[index + 1].record.installId },
    sourceGrantId: index === 0 ? "grant_admin_source" : `delegation_${index - 1}`,
    expiresAt: new Date("2026-06-21T00:00:00.000Z"),
    revocable: true,
    createdAt: new Date(`2026-05-22T00:00:0${index}.000Z`),
    idGenerator: () => `delegation_${index}`,
  }));
}
