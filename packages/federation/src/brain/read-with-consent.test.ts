import { describe, expect, it } from "vitest";

import type { BrainDb } from "./brain-store.js";
import { readKnowledgeObjectWithConsent } from "./read-with-consent.js";
import { createConsentGrant } from "../consent/grant.js";
import { createGroupRoster } from "../consent/group-roster.js";
import { createRevocationTombstone } from "../consent/revocation.js";
import { createInstallIdentity } from "../identity/install-identity.js";
import { createKnowledgeObject, type SignedKnowledgeObject } from "../ko/knowledge-object.js";

describe("Brain read-time consent enforcement", () => {
  it("allows local reads without a consent grant", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Local" },
      identity: producer,
      idGenerator: () => "ko_local",
    });
    const db = dbForRows([
      koRow(ko, {
        source: "local",
        creatorInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
      }),
    ).resolves.toMatchObject({ ok: true, ko });
  });

  it("denies federated reads without a grant", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Federated" },
      identity: producer,
      idGenerator: () => "ko_federated",
    });
    const db = dbForRows([
      koRow(ko, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [],
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
      }),
    ).resolves.toEqual({ ok: false, reason: "Missing consent grant" });
  });

  it("allows federated reads with a valid grant", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Federated" },
      identity: producer,
      idGenerator: () => "ko_federated",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
    });
    const db = dbForRows([
      koRow(ko, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [
        {
          id: grant.id,
          signed_payload_json: grant.signedPayload,
          signer_json: grant.signer,
          signature: grant.signature,
        },
      ],
      [],
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ ok: true, ko });
  });

  it("denies federated reads with an expired grant", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Federated" },
      identity: producer,
      idGenerator: () => "ko_federated",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-05-21T00:00:00.000Z"),
      revocable: true,
    });
    const db = dbForRows([
      koRow(ko, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [
        {
          id: grant.id,
          signed_payload_json: grant.signedPayload,
          signer_json: grant.signer,
          signature: grant.signature,
        },
      ],
      [],
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, reason: "Consent grant is expired" });
  });

  it("denies federated reads when a matching revocation tombstone exists", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Federated" },
      identity: producer,
      idGenerator: () => "ko_federated_revoked",
    });
    const grant = createConsentGrant({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: consumer.record.installId,
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      idGenerator: () => "grant_federated_revoked",
    });
    const revocation = createRevocationTombstone({
      tenant: "stacy/acme",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      revokedGrantId: grant.id,
      issuerIdentity: producer,
      reason: "Access no longer permitted",
    });
    const db = dbForRows([
      koRow(ko, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [
        {
          id: grant.id,
          signed_payload_json: grant.signedPayload,
          signer_json: grant.signer,
          signature: grant.signature,
        },
      ],
      [],
      [],
      [
        {
          id: revocation.id,
          signed_payload_json: revocation.signedPayload,
          signer_json: revocation.signer,
          signature: revocation.signature,
        },
      ],
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, reason: "Consent grant has been revoked" });
  });

  it("allows federated reads through a group grant when the current roster includes the consumer", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/clinic",
      contentType: "application/json",
      content: { title: "Referral" },
      identity: producer,
      idGenerator: () => "ko_referral",
    });
    const roster = createGroupRoster({
      tenant: "stacy/clinic",
      groupId: "group_eastside_specialty",
      label: "Eastside Specialty",
      members: [{ installId: consumer.record.installId, role: "clinician" }],
      issuerIdentity: producer,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "roster_eastside",
    });
    const grant = createConsentGrant({
      tenant: "stacy/clinic",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: roster.signedPayload.groupId,
      recipient: { type: "group", id: roster.signedPayload.groupId, role: "clinician" },
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      idGenerator: () => "grant_group",
    });
    const db = dbForRows([
      koRow(ko, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [],
      [
        {
          id: grant.id,
          signed_payload_json: grant.signedPayload,
          signer_json: grant.signer,
          signature: grant.signature,
        },
      ],
      [],
      [],
      [
        {
          id: roster.id,
          signed_payload_json: roster.signedPayload,
          signer_json: roster.signer,
          signature: roster.signature,
        },
      ],
      [],
      [],
      [],
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ ok: true, ko });
  });

  it("denies federated group reads when the current roster no longer includes the consumer", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const otherMember = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/clinic",
      contentType: "application/json",
      content: { title: "Referral" },
      identity: producer,
      idGenerator: () => "ko_referral",
    });
    const roster = createGroupRoster({
      tenant: "stacy/clinic",
      groupId: "group_eastside_specialty",
      label: "Eastside Specialty",
      members: [{ installId: otherMember.record.installId, role: "clinician" }],
      issuerIdentity: producer,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "roster_eastside",
    });
    const grant = createConsentGrant({
      tenant: "stacy/clinic",
      koId: ko.id,
      koContentHash: ko.signedPayload.contentHash,
      producerIdentity: producer,
      consumerInstallId: roster.signedPayload.groupId,
      recipient: { type: "group", id: roster.signedPayload.groupId, role: "clinician" },
      expiresAt: new Date("2026-06-21T00:00:00.000Z"),
      revocable: true,
      idGenerator: () => "grant_group",
    });
    const db = dbForRows([
      koRow(ko, {
        source: "federated",
        creatorInstallId: producer.record.installId,
        receivedFromInstallId: producer.record.installId,
        storedAt: "2026-05-22T00:00:00.000Z",
      }),
      [],
      [
        {
          id: grant.id,
          signed_payload_json: grant.signedPayload,
          signer_json: grant.signer,
          signature: grant.signature,
        },
      ],
      [],
      [],
      [
        {
          id: roster.id,
          signed_payload_json: roster.signedPayload,
          signer_json: roster.signer,
          signature: roster.signature,
        },
      ],
      [],
      [],
      [],
    ]);

    await expect(
      readKnowledgeObjectWithConsent({
        db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, reason: "Consumer not in producer's latest group roster" });
  });

  it("uses the latest group roster when a member is removed between reads and appends a deny receipt", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const otherMember = createInstallIdentity();
    const { ko, grant, roster: rosterV1 } = createGroupReadFixture({
      producer,
      consumer,
      members: [{ installId: consumer.record.installId, role: "clinician" }],
    });
    const rosterV2 = createGroupRoster({
      tenant: "stacy/clinic",
      groupId: rosterV1.signedPayload.groupId,
      label: "Eastside Specialty",
      members: [{ installId: otherMember.record.installId, role: "clinician" }],
      issuerIdentity: producer,
      createdAt: new Date("2026-05-23T00:00:00.000Z"),
      idGenerator: () => "roster_eastside_v2",
    });
    const allowedDb = dbForRows(groupReadRows({ ko, grant, roster: rosterV1 }));
    const deniedDb = dbForRowsWithCalls(groupReadRows({ ko, grant, roster: rosterV2 }));

    await expect(
      readKnowledgeObjectWithConsent({
        db: allowedDb,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      readKnowledgeObjectWithConsent({
        db: deniedDb.db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-23T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, reason: "Consumer not in producer's latest group roster" });
    expect(deniedDb.calls.length).toBeGreaterThan(groupReadRows({ ko, grant, roster: rosterV2 }).length);
  });

  it("uses the latest group roster when a member is added between reads", async () => {
    const producer = createInstallIdentity();
    const consumer = createInstallIdentity();
    const otherMember = createInstallIdentity();
    const { ko, grant, roster: rosterV1 } = createGroupReadFixture({
      producer,
      consumer,
      members: [{ installId: otherMember.record.installId, role: "clinician" }],
    });
    const rosterV2 = createGroupRoster({
      tenant: "stacy/clinic",
      groupId: rosterV1.signedPayload.groupId,
      label: "Eastside Specialty",
      members: [{ installId: consumer.record.installId, role: "clinician" }],
      issuerIdentity: producer,
      createdAt: new Date("2026-05-23T00:00:00.000Z"),
      idGenerator: () => "roster_eastside_v2",
    });
    const deniedDb = dbForRowsWithCalls(groupReadRows({ ko, grant, roster: rosterV1 }));
    const allowedDb = dbForRows(groupReadRows({ ko, grant, roster: rosterV2 }));

    await expect(
      readKnowledgeObjectWithConsent({
        db: deniedDb.db,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-22T00:00:00.000Z"),
      }),
    ).resolves.toEqual({ ok: false, reason: "Consumer not in producer's latest group roster" });
    expect(deniedDb.calls.length).toBeGreaterThan(groupReadRows({ ko, grant, roster: rosterV1 }).length);

    await expect(
      readKnowledgeObjectWithConsent({
        db: allowedDb,
        koId: ko.id,
        consumerInstallId: consumer.record.installId,
        now: new Date("2026-05-23T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});

function dbForRows(rows: readonly unknown[]): BrainDb {
  let index = 0;
  return {
    execute: async () => rows[index++] ?? [],
  };
}

function dbForRowsWithCalls(rows: readonly unknown[]): { readonly db: BrainDb; readonly calls: unknown[] } {
  let index = 0;
  const calls: unknown[] = [];
  return {
    calls,
    db: {
      execute: async (query: unknown) => {
        calls.push(query);
        return rows[index++] ?? [];
      },
    },
  };
}

function createGroupReadFixture(options: {
  readonly producer: ReturnType<typeof createInstallIdentity>;
  readonly consumer: ReturnType<typeof createInstallIdentity>;
  readonly members: readonly { readonly installId: string; readonly role?: string }[];
}) {
  const ko = createKnowledgeObject({
    tenant: "stacy/clinic",
    contentType: "application/json",
    content: { title: "Referral" },
    identity: options.producer,
    idGenerator: () => "ko_referral",
  });
  const roster = createGroupRoster({
    tenant: "stacy/clinic",
    groupId: "group_eastside_specialty",
    label: "Eastside Specialty",
    members: options.members,
    issuerIdentity: options.producer,
    createdAt: new Date("2026-05-22T00:00:00.000Z"),
    idGenerator: () => "roster_eastside_v1",
  });
  const grant = createConsentGrant({
    tenant: "stacy/clinic",
    koId: ko.id,
    koContentHash: ko.signedPayload.contentHash,
    producerIdentity: options.producer,
    consumerInstallId: roster.signedPayload.groupId,
    recipient: { type: "group", id: roster.signedPayload.groupId, role: "clinician" },
    expiresAt: new Date("2026-06-21T00:00:00.000Z"),
    revocable: true,
    idGenerator: () => "grant_group",
  });
  return { ko, roster, grant };
}

function groupReadRows(options: {
  readonly ko: SignedKnowledgeObject;
  readonly grant: ReturnType<typeof createConsentGrant>;
  readonly roster: ReturnType<typeof createGroupRoster>;
}): readonly unknown[] {
  return [
    koRow(options.ko, {
      source: "federated",
      creatorInstallId: options.ko.signer.installId,
      receivedFromInstallId: options.ko.signer.installId,
      storedAt: "2026-05-22T00:00:00.000Z",
    }),
    [],
    [
      {
        id: options.grant.id,
        signed_payload_json: options.grant.signedPayload,
        signer_json: options.grant.signer,
        signature: options.grant.signature,
      },
    ],
    [],
    [],
    [
      {
        id: options.roster.id,
        signed_payload_json: options.roster.signedPayload,
        signer_json: options.roster.signer,
        signature: options.roster.signature,
      },
    ],
    [],
    [],
    [],
  ];
}

function koRow(ko: SignedKnowledgeObject, provenance: Record<string, unknown>) {
  return [
    {
      id: ko.id,
      signed_payload_json: ko.signedPayload,
      signer_json: ko.signer,
      signature: ko.signature,
      provenance_json: provenance,
    },
  ];
}
