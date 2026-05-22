import { describe, expect, it } from "vitest";

import { parseAdapterDashboardOutput } from "./adapter-output.js";

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
});
