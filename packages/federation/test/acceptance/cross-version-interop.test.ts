import { describe, expect, it } from "vitest";

import {
  CONTENT_CONTRACT_COMPATIBILITY,
  validateKnowledgeContentContractWithCompatibility,
  type ContentContractCompatibility,
} from "../../src/verification/content-contract.js";

const v1ConsumerCompatibility: ContentContractCompatibility = {
  ...CONTENT_CONTRACT_COMPATIBILITY,
  referral_packet: [1],
};

const v2ConsumerCompatibility: ContentContractCompatibility = {
  ...CONTENT_CONTRACT_COMPATIBILITY,
  referral_packet: [1, 2],
};

describe("cross-version referral packet contract interop", () => {
  it("allows a v1 producer to interoperate with a v1 consumer", () => {
    expect(
      validateKnowledgeContentContractWithCompatibility(referralPacket({ schemaVersion: 1 }), v1ConsumerCompatibility),
    ).toMatchObject({
      kind: "referral_packet",
      schemaVersion: 1,
      valid: true,
    });
  });

  it("allows a v1 producer to interoperate with a v2 consumer", () => {
    expect(
      validateKnowledgeContentContractWithCompatibility(referralPacket({ schemaVersion: 1 }), v2ConsumerCompatibility),
    ).toMatchObject({
      kind: "referral_packet",
      schemaVersion: 1,
      valid: true,
    });
  });

  it("rejects a v2 producer when the consumer only supports v1", () => {
    expect(
      validateKnowledgeContentContractWithCompatibility(
        referralPacket({ schemaVersion: 2, carePriority: "urgent" }),
        v1ConsumerCompatibility,
      ),
    ).toEqual({
      kind: "referral_packet",
      schemaVersion: 2,
      supportedVersions: [1],
      valid: false,
      reason: "Unsupported referral_packet schema version 2.",
    });
  });

  it("rejects unknown referral packet schema versions clearly", () => {
    expect(
      validateKnowledgeContentContractWithCompatibility(referralPacket({ schemaVersion: 99 }), v2ConsumerCompatibility),
    ).toEqual({
      kind: "referral_packet",
      schemaVersion: 99,
      supportedVersions: [1, 2],
      valid: false,
      reason: "Unsupported referral_packet schema version 99.",
    });
  });
});

function referralPacket(overrides: Record<string, unknown> = {}) {
  return {
    kind: "referral_packet",
    schemaVersion: 1,
    title: "Northstar Clinic Referral Packet",
    patientReference: "N.P.",
    referralReason: "Second opinion after abnormal ECG",
    clinicalSummary: "Intermittent chest tightness.",
    labSnapshot: "LDL 162 mg/dL; troponin negative",
    medications: ["Atorvastatin 20mg", "aspirin 81mg"],
    imagingStatus: "ECG attached",
    consent: {
      expiresAt: "2026-06-22T23:59:59Z",
      revocationReason: "Patient withdrew consent",
    },
    attachments: [{ label: "ECG", status: "attached" }],
    ...overrides,
  };
}
