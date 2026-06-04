import { describe, expect, it } from "vitest";

import { createInstallIdentity } from "../identity/install-identity.js";
import {
  createSignedContactCard,
  verifySignedContactCard,
  type SignedContactCard,
} from "./contact-card.js";

describe("signed contact cards", () => {
  it("exports a signed contact card that verifies into a contact", () => {
    const identity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const card = createSignedContactCard({
      identity,
      name: "Meera",
      label: "Meera's Stacy install",
      federationEndpointUrl: "http://127.0.0.1:3102/api/federation",
      revocationUrl: "http://127.0.0.1:3101/api/federation/revocations",
      createdAt: new Date("2026-05-22T00:00:01.000Z"),
    });

    expect(card.signedPayload).toMatchObject({
      name: "meera",
      installId: identity.record.installId,
      publicKeyPem: identity.record.publicKeyPem,
    });
    expect(verifySignedContactCard(card)).toEqual({
      ok: true,
      contact: {
        name: "meera",
        label: "Meera's Stacy install",
        installId: identity.record.installId,
        federationEndpointUrl: "http://127.0.0.1:3102/api/federation",
        revocationUrl: "http://127.0.0.1:3101/api/federation/revocations",
      },
    });
  });

  it("rejects tampered signed contact cards", () => {
    const identity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const card = createSignedContactCard({
      identity,
      name: "meera",
      federationEndpointUrl: "http://127.0.0.1:3102/api/federation",
      revocationUrl: "http://127.0.0.1:3101/api/federation/revocations",
    });
    const tampered: SignedContactCard = {
      ...card,
      signedPayload: {
        ...card.signedPayload,
        federationEndpointUrl: "http://127.0.0.1:9999/api/federation",
      },
    };

    expect(verifySignedContactCard(tampered)).toEqual({
      ok: false,
      reason: "Contact card signature verification failed",
    });
  });

  it("rejects cards whose signer key does not match the payload key", () => {
    const identity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const otherIdentity = createInstallIdentity(new Date("2026-05-22T00:00:01.000Z"));
    const card = createSignedContactCard({
      identity,
      name: "meera",
      federationEndpointUrl: "http://127.0.0.1:3102/api/federation",
      revocationUrl: "http://127.0.0.1:3102/api/federation/revocations",
    });
    const forgedSigner: SignedContactCard = {
      ...card,
      signer: {
        installId: card.signer.installId,
        publicKeyPem: otherIdentity.record.publicKeyPem,
      },
    };

    expect(verifySignedContactCard(forgedSigner)).toEqual({
      ok: false,
      reason: "Contact card signer key does not match payload key",
    });
  });

  it("rejects cards with malformed contact names before import", () => {
    const identity = createInstallIdentity(new Date("2026-05-22T00:00:00.000Z"));
    const card = createSignedContactCard({
      identity,
      name: "meera",
      federationEndpointUrl: "http://127.0.0.1:3102/api/federation",
      revocationUrl: "http://127.0.0.1:3102/api/federation/revocations",
    });
    const malformed: SignedContactCard = {
      ...card,
      signedPayload: {
        ...card.signedPayload,
        name: "meera invalid",
      },
    };

    expect(verifySignedContactCard(malformed)).toEqual({
      ok: false,
      reason: "Contact name must use lowercase letters, numbers, dashes, or underscores.",
    });
  });
});
