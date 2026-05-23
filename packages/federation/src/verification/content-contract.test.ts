import { describe, expect, it } from "vitest";

import {
  CONTENT_CONTRACT_COMPATIBILITY,
  validateKnowledgeContentContract,
} from "./content-contract.js";

describe("content contract versioning", () => {
  it("keeps v1 referral packet KOs verifiable", () => {
    expect(validateKnowledgeContentContract(referralPacket({ schemaVersion: 1 }))).toMatchObject({
      kind: "referral_packet",
      schemaVersion: 1,
      supportedVersions: [1, 2],
      valid: true,
    });
  });

  it("supports v2 referral packet KOs without breaking v1", () => {
    expect(validateKnowledgeContentContract(referralPacket({
      schemaVersion: 2,
      carePriority: "urgent",
    }))).toMatchObject({
      kind: "referral_packet",
      schemaVersion: 2,
      valid: true,
      details: {
        hasCarePriority: true,
      },
    });
  });

  it("fails unknown schema versions clearly", () => {
    expect(validateKnowledgeContentContract(referralPacket({ schemaVersion: 99 }))).toEqual({
      kind: "referral_packet",
      schemaVersion: 99,
      supportedVersions: [1, 2],
      valid: false,
      reason: "Unsupported referral_packet schema version 99.",
    });
  });

  it("documents the compatibility matrix", () => {
    expect(CONTENT_CONTRACT_COMPATIBILITY).toEqual({
      dashboard: [1],
      report: [1],
      table: [1],
      referral_packet: [1, 2],
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
