// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import type { AdapterEnvironmentTestResult } from "@arpanstacy/stacy-shared";
import { describe, expect, it, vi } from "vitest";
import {
  LocalAdapterConnectionPanel,
  describeLocalAdapterConnection,
  isLocalAccountAdapter,
} from "./LocalAdapterConnectionPanel";

function result(
  status: AdapterEnvironmentTestResult["status"],
  code: string,
  message = "Probe message",
): AdapterEnvironmentTestResult {
  return {
    adapterType: "codex_local",
    status,
    testedAt: "2026-05-05T10:00:00.000Z",
    checks: [
      {
        code,
        level: status === "fail" ? "error" : status === "warn" ? "warn" : "info",
        message,
      },
    ],
  };
}

describe("LocalAdapterConnectionPanel", () => {
  it("recognizes only local account adapters", () => {
    expect(isLocalAccountAdapter("claude_local")).toBe(true);
    expect(isLocalAccountAdapter("codex_local")).toBe(true);
    expect(isLocalAccountAdapter("http")).toBe(false);
  });

  it("describes an untested Codex adapter as a connect step", () => {
    const summary = describeLocalAdapterConnection("codex_local", null);

    expect(summary.state).toBe("not_tested");
    expect(summary.title).toBe("Connect Codex");
    expect(summary.body).toContain("No provider credentials are stored in Stacy");
  });

  it("classifies auth warnings as user login required", () => {
    const summary = describeLocalAdapterConnection(
      "claude_local",
      result("warn", "claude_hello_probe_auth_required", "Claude CLI is installed, but login is required."),
    );

    expect(summary.state).toBe("needs_auth");
    expect(summary.body).toContain("claude login");
  });

  it("classifies failed auth probes as user login required", () => {
    const summary = describeLocalAdapterConnection(
      "claude_local",
      result("fail", "claude_hello_probe_auth_required", "Claude authentication failed with 401."),
    );

    expect(summary.state).toBe("needs_auth");
    expect(summary.title).toBe("Claude needs login");
  });

  it("renders credential boundary and login command", () => {
    const html = renderToStaticMarkup(
      <LocalAdapterConnectionPanel
        adapterType="codex_local"
        result={result("warn", "codex_hello_probe_auth_required", "Codex CLI needs login.")}
        error={null}
        isTesting={false}
        onTest={vi.fn()}
      />,
    );

    expect(html).toContain("Codex needs login");
    expect(html).toContain("codex login");
    expect(html).toContain("It does not bundle shared Claude or Codex credentials");
  });

  it("renders mutation auth errors as login guidance", () => {
    const html = renderToStaticMarkup(
      <LocalAdapterConnectionPanel
        adapterType="claude_local"
        result={null}
        error="Failed to authenticate. API Error: 401"
        isTesting={false}
        onTest={vi.fn()}
      />,
    );

    expect(html).toContain("Claude needs login");
    expect(html).toContain("claude login");
  });
});
