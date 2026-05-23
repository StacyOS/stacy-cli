import { describe, expect, it } from "vitest";

import {
  parseAdapterDashboardOutput,
  parseAdapterOutput,
  parseAdapterReferralPacketOutput,
  parseAdapterReportOutput,
  parseAdapterTableOutput,
} from "./adapter-output.js";

describe("adapter dashboard output", () => {
  it("accepts a valid adapter-owned dashboard", () => {
    expect(
      parseAdapterDashboardOutput(JSON.stringify({
        title: "Adapter Dashboard",
        summary: "Adapter chose the metrics.",
        widgets: [
          { kind: "metric", label: "Revenue", value: "$423,750" },
          { kind: "risk", label: "Churn risk", value: 0.07 },
        ],
        notes: ["Generated from adapter JSON."],
      })),
    ).toEqual({
      title: "Adapter Dashboard",
      summary: "Adapter chose the metrics.",
      widgets: [
        { kind: "metric", label: "Revenue", value: "$423,750" },
        { kind: "risk", label: "Churn risk", value: 0.07 },
      ],
      notes: ["Generated from adapter JSON."],
    });
  });

  it("rejects malformed JSON", () => {
    expect(() => parseAdapterDashboardOutput("{")).toThrow("must be valid JSON");
  });

  it("rejects invalid widget shapes", () => {
    expect(() =>
      parseAdapterDashboardOutput(JSON.stringify({
        widgets: [{ kind: "metric", label: "Revenue" }],
      })),
    ).toThrow("must include a string or number value");
  });

  it("rejects unsupported widget kinds", () => {
    expect(() =>
      parseAdapterDashboardOutput(JSON.stringify({
        widgets: [{ kind: "table", label: "Rows", value: 3 }],
      })),
    ).toThrow("unsupported kind");
  });

  it("accepts a valid adapter-owned report", () => {
    expect(
      parseAdapterReportOutput(JSON.stringify({
        title: "Q2 Readout",
        summary: "Pipeline grew across the quarter.",
        sections: [{ heading: "Revenue", body: "Revenue increased month over month." }],
        notes: ["Adapter authored the report."],
      })),
    ).toEqual({
      title: "Q2 Readout",
      summary: "Pipeline grew across the quarter.",
      sections: [{ heading: "Revenue", body: "Revenue increased month over month." }],
      notes: ["Adapter authored the report."],
    });
  });

  it("rejects invalid adapter reports", () => {
    expect(() => parseAdapterReportOutput(JSON.stringify({ sections: [] }))).toThrow("non-empty summary");
    expect(() =>
      parseAdapterReportOutput(JSON.stringify({ summary: "ok", sections: [{ heading: "Missing body" }] })),
    ).toThrow("must include a body");
  });

  it("accepts a valid adapter-owned table", () => {
    expect(
      parseAdapterTableOutput(JSON.stringify({
        title: "Revenue Table",
        columns: ["month", "revenue", "flagged"],
        rows: [{ month: "2026-04", revenue: 124000, flagged: false }],
        summary: "One row.",
      })),
    ).toEqual({
      title: "Revenue Table",
      columns: ["month", "revenue", "flagged"],
      rows: [{ month: "2026-04", revenue: 124000, flagged: false }],
      summary: "One row.",
    });
  });

  it("rejects invalid adapter tables", () => {
    expect(() => parseAdapterTableOutput(JSON.stringify({ columns: [], rows: [] }))).toThrow("columns array");
    expect(() =>
      parseAdapterTableOutput(JSON.stringify({ columns: ["month"], rows: [{ month: { nested: true } }] })),
    ).toThrow("unsupported value");
  });

  it("dispatches by selected adapter output kind", () => {
    expect(parseAdapterOutput(JSON.stringify({ summary: "Report." }), "report")).toEqual({ summary: "Report." });
    expect(parseAdapterOutput(JSON.stringify({ columns: ["a"], rows: [{ a: null }] }), "table")).toEqual({
      columns: ["a"],
      rows: [{ a: null }],
    });
  });

  it("accepts a valid adapter-owned referral packet", () => {
    expect(
      parseAdapterReferralPacketOutput(JSON.stringify({
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
        notes: ["Referral contract validated."],
      })),
    ).toEqual({
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
      notes: ["Referral contract validated."],
    });
  });

  it("rejects invalid adapter referral packets", () => {
    expect(() => parseAdapterReferralPacketOutput(JSON.stringify({
      patientReference: "N.P.",
      referralReason: "Second opinion",
      clinicalSummary: "Summary",
      labSnapshot: "Labs",
      medications: [],
      imagingStatus: "ECG attached",
      consent: { expiresAt: "2026-06-22T23:59:59Z", revocationReason: "Patient withdrew consent" },
    }))).toThrow("medications must be a non-empty array");

    expect(() => parseAdapterReferralPacketOutput(JSON.stringify({
      patientReference: "N.P.",
      referralReason: "Second opinion",
      clinicalSummary: "Summary",
      labSnapshot: "Labs",
      medications: ["Atorvastatin"],
      imagingStatus: "ECG attached",
      consent: { expiresAt: "not-a-date", revocationReason: "Patient withdrew consent" },
    }))).toThrow("consent.expiresAt must be an ISO timestamp");
  });
});
