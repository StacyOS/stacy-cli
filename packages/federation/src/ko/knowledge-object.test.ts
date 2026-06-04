import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "../identity/install-identity.js";
import {
  createKnowledgeObject,
  type SignedKnowledgeObject,
  verifyKnowledgeObject,
} from "./knowledge-object.js";

describe("signed Knowledge Objects", () => {
  it("creates a content-addressed signed KO that verifies", () => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/vnd.stacy.dashboard+json",
      content: { title: "Revenue", widgets: [{ kind: "metric", value: 42 }] },
      identity,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "ko_test",
    });

    const result = verifyKnowledgeObject(ko);

    expect(ko.id).toBe("ko_test");
    expect(ko.signedPayload.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result).toEqual({ ok: true, contentHash: ko.signedPayload.contentHash });
  });

  it("uses the content hash as the default KO id", () => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { answer: 42 },
      identity,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    });

    expect(ko.id).toBe(`ko_${ko.signedPayload.contentHash.replace("sha256:", "")}`);
  });

  it("uses canonical bytes so logically identical content produces the same hash", () => {
    const identity = createInstallIdentity();
    const common = {
      tenant: "stacy/acme",
      contentType: "application/json",
      identity,
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
    };

    const left = createKnowledgeObject({
      ...common,
      content: { b: 2, a: { y: true, x: false } },
    });
    const right = createKnowledgeObject({
      ...common,
      content: { a: { x: false, y: true }, b: 2 },
    });

    expect(left.signedPayload.contentHash).toBe(right.signedPayload.contentHash);
  });

  it.each([
    [
      "content",
      (ko: SignedKnowledgeObject): SignedKnowledgeObject => ({
        ...ko,
        signedPayload: {
          ...ko.signedPayload,
          content: { tampered: true },
        },
      }),
    ],
    [
      "metadata",
      (ko: SignedKnowledgeObject): SignedKnowledgeObject => ({
        ...ko,
        signedPayload: {
          ...ko.signedPayload,
          tenant: "stacy/evil",
        },
      }),
    ],
    [
      "hash",
      (ko: SignedKnowledgeObject): SignedKnowledgeObject => ({
        ...ko,
        signedPayload: {
          ...ko.signedPayload,
          contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
      }),
    ],
    [
      "signature",
      (ko: SignedKnowledgeObject): SignedKnowledgeObject => ({
        ...ko,
        signature: Buffer.from("not the real signature").toString("base64"),
      }),
    ],
  ])("rejects tampered %s", (_label, mutate) => {
    const identity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { answer: 42 },
      identity,
    });

    expect(verifyKnowledgeObject(mutate(ko)).ok).toBe(false);
  });

  it("rejects verification with a wrong public key", () => {
    const identity = createInstallIdentity();
    const wrongIdentity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { answer: 42 },
      identity,
    });

    const forgedKo = {
      ...ko,
      signer: {
        installId: identity.record.installId,
        publicKeyPem: wrongIdentity.record.publicKeyPem,
      },
    };

    expect(verifyKnowledgeObject(forgedKo)).toEqual({
      ok: false,
      reason: "Knowledge Object signature verification failed",
    });
  });

  it("rejects a signer install that does not match the signed creator", () => {
    const identity = createInstallIdentity();
    const wrongIdentity = createInstallIdentity();
    const ko = createKnowledgeObject({
      tenant: "stacy/acme",
      contentType: "application/json",
      content: { answer: 42 },
      identity,
    });

    expect(
      verifyKnowledgeObject({
        ...ko,
        signer: {
          installId: wrongIdentity.record.installId,
          publicKeyPem: identity.record.publicKeyPem,
        },
      }),
    ).toEqual({
      ok: false,
      reason: "Signer install does not match creator install",
    });
  });
});
