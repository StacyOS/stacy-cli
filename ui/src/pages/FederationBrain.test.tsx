// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FederationBrain } from "./FederationBrain";

const mockFederationBrainApi = vi.hoisted(() => ({
  show: vi.fn(),
}));

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("../api/federationBrain", async () => {
  const actual = await vi.importActual<typeof import("../api/federationBrain")>("../api/federationBrain");
  return {
    ...actual,
    federationBrainApi: mockFederationBrainApi,
  };
});

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("@/lib/router")>("@/lib/router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ koId: "ko_demo" }),
    useSearchParams: () => [new URLSearchParams("asConsumer=install_b")],
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("FederationBrain", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders dashboard widgets with provenance and receipt verification", async () => {
    mockFederationBrainApi.show.mockResolvedValue({
      status: "allowed",
      id: "ko_demo",
      tenant: "stacy/acme",
      contentType: "application/vnd.stacy.dashboard+json",
      contentHash: "sha256:1234567890abcdef1234567890abcdef",
      creatorInstallId: "install_a",
      signerInstallId: "install_a",
      provenance: {
        source: "federated",
        creatorInstallId: "install_a",
        receivedFromInstallId: "install_a",
        storedAt: "2026-05-22T00:00:00.000Z",
      },
      verification: { signature: "verified", contentHash: "sha256:123" },
      consent: { status: "enforced", consumerInstallId: "install_b" },
      content: {
        kind: "dashboard",
        title: "Revenue dashboard",
        summary: "Pipeline is growing.",
        input: { fileName: "acme-q2-revenue.csv", rows: 3, contentHash: "sha256:csv" },
        widgets: [{ kind: "metric", label: "Revenue", value: "$423,750" }],
      },
      receipts: {
        total: 4,
        byEvent: { receive: 1, store: 1, read: 1, deny: 1 },
        events: [],
      },
      receiptVerification: {
        koChainValid: true,
        globalAnchorValid: true,
        checked: { koReceipts: 4, globalAnchors: 8 },
      },
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <FederationBrain />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Revenue dashboard");
    expect(container.textContent).toContain("Revenue");
    expect(container.textContent).toContain("read-time enforced");
    expect(container.textContent).toContain("Global anchor valid");
    expect(container.textContent).toContain("Creator install");

    await act(async () => root.unmount());
  });

  it("renders denied reads without dashboard content", async () => {
    mockFederationBrainApi.show.mockResolvedValue({
      status: "denied",
      id: "ko_demo",
      reason: "revoked",
      asConsumer: "install_b",
      receipts: {
        total: 1,
        byEvent: { deny: 1 },
        events: [],
      },
      receiptVerification: {
        koChainValid: true,
        globalAnchorValid: true,
        checked: { koReceipts: 1, globalAnchors: 3 },
      },
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <FederationBrain />
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Read denied");
    expect(container.textContent).toContain("revoked");
    expect(container.textContent).toContain("Consent enforcement");
    expect(container.textContent).toContain("deny");

    await act(async () => root.unmount());
  });
});
