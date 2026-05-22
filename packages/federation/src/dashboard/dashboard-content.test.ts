import { describe, expect, it } from "vitest";
import {
  createDeterministicDashboardContent,
  parseDashboardSchema,
  parseCsvDashboardInput,
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
});
