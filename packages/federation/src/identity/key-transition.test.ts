import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "./install-identity.js";
import { createKnowledgeObject, verifyKnowledgeObject } from "../ko/knowledge-object.js";
import {
  createKeyTransition,
  verifyKeyTransition,
  verifyKeyTransitionChain,
  type SignedKeyTransition,
} from "./key-transition.js";

describe("install key transitions", () => {
  it("creates a dual-signed key transition from old identity to new identity", () => {
    const oldIdentity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const newIdentity = createInstallIdentity(new Date("2026-05-23T00:00:00.000Z"));

    const transition = createKeyTransition({
      oldIdentity,
      newIdentity,
      now: new Date("2026-05-23T01:00:00.000Z"),
      reason: "scheduled rotation",
    });

    expect(transition.signedPayload.oldInstallId).toBe(oldIdentity.record.installId);
    expect(transition.signedPayload.newInstallId).toBe(newIdentity.record.installId);
    expect(verifyKeyTransition(transition)).toMatchObject({ ok: true });
  });

  it("rejects a forged transition countersignature", () => {
    const oldIdentity = createInstallIdentity();
    const newIdentity = createInstallIdentity();
    const transition = createKeyTransition({ oldIdentity, newIdentity });

    const forged: SignedKeyTransition = {
      ...transition,
      newSignature: transition.oldSignature,
    };

    expect(verifyKeyTransition(forged)).toEqual({
      ok: false,
      reason: "New key countersignature is invalid",
    });
  });

  it("verifies a multi-step identity chain", () => {
    const first = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const second = createInstallIdentity(new Date("2026-05-23T00:00:00.000Z"));
    const third = createInstallIdentity(new Date("2026-05-24T00:00:00.000Z"));
    const one = createKeyTransition({
      oldIdentity: first,
      newIdentity: second,
      effectiveAt: new Date("2026-05-23T00:00:00.000Z"),
      now: new Date("2026-05-23T00:00:00.000Z"),
    });
    const two = createKeyTransition({
      oldIdentity: second,
      newIdentity: third,
      effectiveAt: new Date("2026-05-24T00:00:00.000Z"),
      now: new Date("2026-05-24T00:00:00.000Z"),
    });

    expect(verifyKeyTransitionChain([two, one])).toEqual({
      ok: true,
      checked: 2,
      rootInstallId: first.record.installId,
      currentInstallId: third.record.installId,
    });
  });

  it("preserves verification for old and new signed Knowledge Objects", () => {
    const oldIdentity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const newIdentity = createInstallIdentity(new Date("2026-05-23T00:00:00.000Z"));
    const transition = createKeyTransition({ oldIdentity, newIdentity });
    const oldKo = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "Before rotation" },
      identity: oldIdentity,
      createdAt: new Date("2026-05-22T01:00:00.000Z"),
      idGenerator: () => "ko_before_rotation",
    });
    const newKo = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { title: "After rotation" },
      identity: newIdentity,
      createdAt: new Date("2026-05-23T01:00:00.000Z"),
      idGenerator: () => "ko_after_rotation",
    });

    expect(verifyKeyTransition(transition)).toMatchObject({ ok: true });
    expect(verifyKnowledgeObject(oldKo)).toMatchObject({ ok: true });
    expect(verifyKnowledgeObject(newKo)).toMatchObject({ ok: true });
  });

  it("rejects a broken identity chain", () => {
    const first = createInstallIdentity();
    const second = createInstallIdentity();
    const unrelated = createInstallIdentity();
    const third = createInstallIdentity();

    const one = createKeyTransition({
      oldIdentity: first,
      newIdentity: second,
      effectiveAt: new Date("2026-05-23T00:00:00.000Z"),
      now: new Date("2026-05-23T00:00:00.000Z"),
    });
    const two = createKeyTransition({
      oldIdentity: unrelated,
      newIdentity: third,
      effectiveAt: new Date("2026-05-24T00:00:00.000Z"),
      now: new Date("2026-05-24T00:00:00.000Z"),
    });

    expect(verifyKeyTransitionChain([one, two])).toMatchObject({
      ok: false,
      checked: 1,
      firstInvalidTransitionId: two.id,
      reason: `Broken key transition chain: expected old install ${second.record.installId}`,
    });
  });
});
