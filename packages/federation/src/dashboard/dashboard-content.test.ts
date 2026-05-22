import { describe, expect, it } from "vitest";
import {
  createDeterministicDashboardContent,
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
        expect.objectContaining({ label: "Active customers", value: 12 }),
      ]),
      generator: "deterministic_dashboard",
    });
    expect(content.input.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
