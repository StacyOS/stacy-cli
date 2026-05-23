import { describe, expect, it } from "vitest";
import {
  createDeterministicDashboardContent,
  createDeterministicReferralPacketContent,
  normalizeRedactedColumns,
  parseDashboardSchema,
  parseCsvDashboardInput,
  redactDashboardInputForAdapter,
} from "./dashboard-content.js";

describe("public demo dashboard content", () => {
  it("derives stable dashboard content from CSV input", () => {
    const input = parseCsvDashboardInput("acme-q2-revenue.csv", [
      "month,revenue,pipeline,active_customers,churn_risk",
      "2026-04,100,200,10,0.1",
      "2026-05,150,250,12,0.2",
    ].join("\n"));

    const content = createDeterministicDashboardContent({
      task: "build a quarterly revenue dashboard from this CSV",
      input,
    });

    expect(content).toMatchObject({
      kind: "dashboard",
      input: {
        fileName: "acme-q2-revenue.csv",
        rows: 2,
      },
      widgets: expect.arrayContaining([
        expect.objectContaining({ label: "Revenue", value: 250 }),
        expect.objectContaining({ label: "Pipeline", value: 450 }),
        expect.objectContaining({ label: "Active Customers", value: 12 }),
      ]),
      generator: "deterministic_dashboard",
    });
    expect(content.input.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("uses schema-defined widgets for arbitrary CSV columns", () => {
    const input = parseCsvDashboardInput("usage.csv", [
      "week,signups,activation_rate",
      "2026-W20,12,0.4",
      "2026-W21,18,0.5",
    ].join("\n"));
    const schema = parseDashboardSchema(JSON.stringify({
      title: "Usage Dashboard",
      widgets: [
        { label: "Signups", column: "signups", aggregate: "sum", format: "number" },
        { kind: "risk", label: "Activation", column: "activation_rate", aggregate: "average", format: "percent" },
      ],
    }));

    const content = createDeterministicDashboardContent({
      task: "build usage dashboard",
      input,
      schema,
    });

    expect(content).toMatchObject({
      title: "Usage Dashboard",
      widgets: [
        { kind: "metric", label: "Signups", value: 30 },
        { kind: "risk", label: "Activation", value: 0.45 },
      ],
    });
  });

  it("rejects invalid dashboard schemas", () => {
    expect(() => parseDashboardSchema(JSON.stringify({ widgets: [] }))).toThrow(
      "Dashboard schema must include a non-empty widgets array.",
    );
    expect(() =>
      parseDashboardSchema(JSON.stringify({
        widgets: [{ label: "Bad", column: "revenue", aggregate: "median" }],
      })),
    ).toThrow("Dashboard schema widget 1 has an unsupported aggregate.");
  });

  it("redacts selected columns only from adapter input records", () => {
    const input = parseCsvDashboardInput("customers.csv", [
      "customer_email,revenue,notes",
      "a@example.com,100,keep",
      "b@example.com,150,also keep",
    ].join("\n"));

    const redacted = redactDashboardInputForAdapter(input, ["customer_email"]);

    expect(redacted).toMatchObject({
      fileName: "customers.csv",
      contentHash: input.contentHash,
      rows: 2,
      columns: ["revenue", "notes"],
      records: [
        { revenue: "100", notes: "keep" },
        { revenue: "150", notes: "also keep" },
      ],
    });
    expect(input.records[0]).toHaveProperty("customer_email", "a@example.com");
  });

  it("normalizes redaction requests against CSV header casing", () => {
    expect(normalizeRedactedColumns(["Customer Email", "Revenue"], ["customer email", "missing", "REVENUE"])).toEqual([
      "Customer Email",
      "Revenue",
    ]);
  });

  it("parses BOM-prefixed CSV with CRLF line endings", () => {
    const input = parseCsvDashboardInput("bom.csv", "\uFEFFmonth,revenue\r\n2026-04,100\r\n2026-05,150\r\n");

    expect(input).toMatchObject({
      rows: 2,
      columns: ["month", "revenue"],
      records: [
        { month: "2026-04", revenue: "100" },
        { month: "2026-05", revenue: "150" },
      ],
    });
  });

  it("parses quoted commas and escaped quotes", () => {
    const input = parseCsvDashboardInput("quoted.csv", [
      "name,notes,revenue",
      "\"Acme, Inc.\",\"Said \"\"yes\"\"\",100",
    ].join("\n"));

    expect(input.records).toEqual([
      { name: "Acme, Inc.", notes: "Said \"yes\"", revenue: "100" },
    ]);
  });

  it("parses multiline quoted cells", () => {
    const input = parseCsvDashboardInput("multiline.csv", [
      "name,notes,revenue",
      "\"Acme\",\"line one",
      "line two\",100",
    ].join("\n"));

    expect(input.records).toEqual([
      { name: "Acme", notes: "line one\nline two", revenue: "100" },
    ]);
  });

  it("ignores blank trailing lines", () => {
    const input = parseCsvDashboardInput("trailing.csv", "month,revenue\n2026-04,100\n\n");

    expect(input.records).toEqual([{ month: "2026-04", revenue: "100" }]);
  });

  it("rejects unclosed quoted CSV cells", () => {
    expect(() => parseCsvDashboardInput("bad.csv", "name,notes\nAcme,\"unterminated")).toThrow(
      "CSV input has an unclosed quoted field.",
    );
  });

  it("derives deterministic referral packet content from healthcare CSV input", () => {
    const input = parseCsvDashboardInput("referral-packet.csv", [
      "patient_ref,referral_reason,clinical_summary,lab_snapshot,medications,imaging_status,consent_expires,revocation_reason",
      "N.P.,Second opinion after abnormal ECG,Chest tightness,LDL 162 mg/dL,\"Atorvastatin 20mg; aspirin 81mg\",ECG attached,2026-06-22T23:59:59Z,Patient withdrew consent",
    ].join("\n"));

    const content = createDeterministicReferralPacketContent({
      task: "Northstar Clinic Referral Packet",
      input,
    });

    expect(content).toMatchObject({
      kind: "referral_packet",
      schemaVersion: 1,
      patientReference: "N.P.",
      referralReason: "Second opinion after abnormal ECG",
      clinicalSummary: "Chest tightness",
      labSnapshot: "LDL 162 mg/dL",
      medications: ["Atorvastatin 20mg", "aspirin 81mg"],
      imagingStatus: "ECG attached",
      consent: {
        expiresAt: "2026-06-22T23:59:59Z",
        revocationReason: "Patient withdrew consent",
      },
      generator: "deterministic_referral_packet",
    });
  });
});
