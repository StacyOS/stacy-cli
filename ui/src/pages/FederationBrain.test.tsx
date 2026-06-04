// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FederationBrain } from "./FederationBrain";
import { TooltipProvider } from "@/components/ui/tooltip";

const mockFederationBrainApi = vi.hoisted(() => ({
  show: vi.fn(),
  metrics: vi.fn(),
  eventsUrl: vi.fn((koId: string) => `/api/federation/brain/${encodeURIComponent(koId)}/events`),
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

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  closed = false;

  constructor(url: string) {
    super();
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  close() {
    this.closed = true;
  }

  emitReceipt(payload: unknown) {
    this.dispatchEvent(new MessageEvent("receipt", {
      data: JSON.stringify(payload),
    }));
  }
}

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
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    mockFederationBrainApi.metrics.mockResolvedValue({
      koCount: 1,
      shareCount: 1,
      revokeCount: 1,
      denyCount: 1,
      readCount: 1,
      receiveCount: 1,
      averageFederationReceiveMs: 82,
      federationRoundtripP50Ms: 82,
      averageReadEnforcementMs: 3.5,
      mostRecentReceiptAt: "2026-05-23T00:00:05.000Z",
      receiptChain: {
        globalAnchorValid: true,
        checkedAnchors: 8,
      },
      receipts: {
        total: 6,
        byEvent: { create: 1, share: 1, receive: 1, read: 1, deny: 1, revoke: 1 },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      consent: {
        status: "enforced",
        consumerInstallId: "install_b",
        grantId: "grant_group_referral",
        recipient: { type: "group", id: "group_eastside_specialty", role: "clinician" },
      },
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
      verificationReports: [{
        verificationKoId: "ko_verify_demo",
        verificationContentHash: "sha256:verification",
        verdict: "fail",
        failedChecks: ["source_input_reconciled"],
        warningChecks: ["future_check"],
        verifierInstallId: "install_verifier",
        createdAt: "2026-05-22T00:00:00.000Z",
        receiptHash: "sha256:receipt",
      }],
      receiptVerification: {
        koChainValid: true,
        globalAnchorValid: true,
        checked: { koReceipts: 4, globalAnchors: 8 },
      },
      identities: {
        producer: {
          label: "Northstar Clinic",
          installId: "install_a",
          shortInstallId: "install_a",
          verified: true,
          publicKeyFingerprint: "sha256:abcd1234",
        },
        consumer: {
          label: "Dr. Meera Patel / Eastside Specialty",
          installId: "install_b",
          shortInstallId: "install_b",
          verified: true,
        },
        signer: {
          label: "Northstar Clinic",
          installId: "install_a",
          shortInstallId: "install_a",
          verified: true,
          publicKeyFingerprint: "sha256:abcd1234",
        },
      },
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}><TooltipProvider>
          <FederationBrain />
        </TooltipProvider></QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Revenue dashboard");
    expect(container.textContent).toContain("Revenue");
    expect(container.textContent).toContain("read-time enforced");
    expect(container.textContent).toContain("Global anchor valid");
    expect(container.textContent).toContain("Producer");
    expect(container.textContent).toContain("Northstar Clinic");
    expect(container.textContent).toContain("Dr. Meera Patel / Eastside Specialty");
    expect(container.textContent).toContain("grant_group_referral");
    expect(container.textContent).toContain("group: group_eastside_specialty / clinician");
    expect(container.textContent).toContain("verified");
    expect(container.querySelector("[aria-label='Stored input metadata matches the source file name, hash, and row count supplied for verification.']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Check ID: future_check, no description registered.']")).not.toBeNull();
    expect(container.textContent).toContain("Live updates");
    expect(container.textContent).toContain("Federation health");
    expect(container.textContent).toContain("Roundtrip p50");
    expect(container.textContent).toContain("82ms");

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
      identities: {
        consumer: {
          label: "Dr. Meera Patel / Eastside Specialty",
          installId: "install_b",
          shortInstallId: "install_b",
          verified: true,
        },
      },
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}><TooltipProvider>
          <FederationBrain />
        </TooltipProvider></QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Read denied");
    expect(container.textContent).toContain("revoked");
    expect(container.textContent).toContain("Consent enforcement");
    expect(container.textContent).toContain("Dr. Meera Patel / Eastside Specialty");
    expect(container.textContent).toContain("deny");

    await act(async () => root.unmount());
  });

  it("renders referral packet KOs with clinical and consent fields", async () => {
    mockFederationBrainApi.show.mockResolvedValue({
      status: "allowed",
      id: "ko_referral_packet",
      tenant: "stacy/clinic",
      contentType: "application/json",
      contentHash: "sha256:referralhash",
      creatorInstallId: "install_a",
      signerInstallId: "install_a",
      provenance: {
        source: "federated",
        creatorInstallId: "install_a",
        receivedFromInstallId: "install_a",
        storedAt: "2026-05-22T00:00:00.000Z",
      },
      verification: { signature: "verified", contentHash: "sha256:referralhash" },
      consent: { status: "enforced", consumerInstallId: "install_b" },
      content: {
        kind: "referral_packet",
        title: "Northstar Clinic Referral Packet",
        summary: "Second opinion after abnormal ECG for patient N.P.",
        input: { fileName: "referral-packet.csv", rows: 1, contentHash: "sha256:csv" },
        patientReference: "N.P.",
        referralReason: "Second opinion after abnormal ECG",
        clinicalSummary: "Intermittent chest tightness with elevated LDL.",
        labSnapshot: "LDL 162 mg/dL; troponin negative",
        medications: ["Atorvastatin 20mg", "aspirin 81mg"],
        imagingStatus: "ECG attached",
        consent: {
          expiresAt: "2026-06-22T23:59:59Z",
          revocationReason: "Patient withdrew consent",
        },
        attachments: [{ label: "ECG", status: "attached" }],
        adapterNotes: ["Referral packet contract validated."],
      },
      receipts: {
        total: 2,
        byEvent: { receive: 1, read: 1 },
        events: [],
      },
      receiptVerification: {
        koChainValid: true,
        globalAnchorValid: true,
        checked: { koReceipts: 2, globalAnchors: 4 },
      },
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}><TooltipProvider>
          <FederationBrain />
        </TooltipProvider></QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Northstar Clinic Referral Packet");
    expect(container.textContent).toContain("Referral packet");
    expect(container.textContent).toContain("Second opinion after abnormal ECG");
    expect(container.textContent).toContain("LDL 162 mg/dL");
    expect(container.textContent).toContain("Patient withdrew consent");
    expect(container.textContent).toContain("Referral packet contract validated.");

    await act(async () => root.unmount());
  });

  it("renders write-scope derived KOs as consumer counter-KOs", async () => {
    mockFederationBrainApi.show.mockResolvedValue({
      status: "allowed",
      id: "ko_counter_note",
      tenant: "stacy/acme",
      contentType: "application/vnd.stacy.derived-ko+json",
      contentHash: "sha256:abcdef1234567890abcdef1234567890",
      creatorInstallId: "install_b",
      signerInstallId: "install_b",
      provenance: {
        source: "local",
        creatorInstallId: "install_b",
        storedAt: "2026-05-22T00:00:00.000Z",
      },
      verification: { signature: "verified", contentHash: "sha256:abcdef" },
      consent: { status: "local_owner" },
      content: {
        kind: "derived_knowledge_object",
        schemaVersion: 1,
        source: {
          koId: "ko_referral_packet",
          koContentHash: "sha256:sourcehash1234567890",
          producerInstallId: "install_a",
          grantId: "grant_write_referral",
          grantScope: "write",
        },
        createdByConsumerInstallId: "install_b",
        createdAt: "2026-05-22T00:01:00.000Z",
        derivedContent: {
          annotation: "Eastside recommends cardiology follow-up within 7 days.",
        },
      },
      receipts: {
        total: 1,
        byEvent: { derive: 1 },
        events: [],
      },
      receiptVerification: {
        koChainValid: true,
        globalAnchorValid: true,
        checked: { koReceipts: 1, globalAnchors: 2 },
      },
      identities: {
        signer: {
          label: "Dr. Meera Patel / Eastside Specialty",
          installId: "install_b",
          shortInstallId: "install_b",
          verified: true,
        },
      },
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}><TooltipProvider>
          <FederationBrain />
        </TooltipProvider></QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Consumer counter-KO");
    expect(container.textContent).toContain("does not mutate the producer-owned source KO");
    expect(container.textContent).toContain("ko_referral_packet");
    expect(container.textContent).toContain("grant_write_referral (write)");
    expect(container.textContent).toContain("Eastside recommends cardiology follow-up");
    expect(container.textContent).toContain("derive");

    await act(async () => root.unmount());
  });

  it("refetches and transitions to denied when a live deny receipt arrives", async () => {
    mockFederationBrainApi.show
      .mockResolvedValueOnce({
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
          title: "Referral packet",
          summary: "Read is currently allowed.",
          widgets: [{ kind: "metric", label: "Labs", value: 3 }],
        },
        receipts: {
          total: 3,
          byEvent: { receive: 1, store: 1, read: 1 },
          events: [],
        },
        receiptVerification: {
          koChainValid: true,
          globalAnchorValid: true,
          checked: { koReceipts: 3, globalAnchors: 6 },
        },
        identities: {
          producer: {
            label: "Northstar Clinic",
            installId: "install_a",
            shortInstallId: "install_a",
            verified: true,
          },
          consumer: {
            label: "Dr. Meera Patel / Eastside Specialty",
            installId: "install_b",
            shortInstallId: "install_b",
            verified: true,
          },
          signer: {
            label: "Northstar Clinic",
            installId: "install_a",
            shortInstallId: "install_a",
            verified: true,
          },
        },
      })
      .mockResolvedValue({
        status: "denied",
        id: "ko_demo",
        reason: "revoked",
        asConsumer: "install_b",
        receipts: {
          total: 4,
          byEvent: { receive: 1, store: 1, read: 1, deny: 1 },
          events: [],
        },
        verificationReports: [],
        receiptVerification: {
          koChainValid: true,
          globalAnchorValid: true,
          checked: { koReceipts: 4, globalAnchors: 7 },
        },
        identities: {
          consumer: {
            label: "Dr. Meera Patel / Eastside Specialty",
            installId: "install_b",
            shortInstallId: "install_b",
            verified: true,
          },
        },
      });

    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}><TooltipProvider>
          <FederationBrain />
        </TooltipProvider></QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Read allowed");
    expect(MockEventSource.instances[0]?.url).toBe("/api/federation/brain/ko_demo/events");

    await act(async () => {
      MockEventSource.instances[0]?.emitReceipt({
        id: "receipt_deny",
        eventType: "deny",
        koId: "ko_demo",
        actorInstallId: "install_b",
        counterpartyInstallId: "install_a",
        createdAt: "2026-05-22T00:00:02.000Z",
      });
    });
    await flushReact();
    await flushReact();

    expect(mockFederationBrainApi.show).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Read denied");
    expect(container.textContent).toContain("revoked");
    expect(container.textContent).toContain("Live: deny");

    await act(async () => root.unmount());
  });
});
