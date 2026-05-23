import { api } from "./client";

export interface FederationBrainWidget {
  readonly kind?: string;
  readonly label?: string;
  readonly value?: string | number;
}

export interface FederationBrainDashboardContent {
  readonly kind?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly task?: string;
  readonly generator?: string;
  readonly widgets?: readonly FederationBrainWidget[];
  readonly input?: {
    readonly fileName?: string;
    readonly rows?: number;
    readonly contentHash?: string;
  };
  readonly adapterNotes?: readonly string[];
  readonly redactedColumns?: readonly string[];
}

export interface FederationBrainReceiptSummary {
  readonly total: number;
  readonly byEvent: Record<string, number>;
  readonly events: readonly {
    readonly id: string;
    readonly eventType: string;
    readonly actorInstallId: string;
    readonly counterpartyInstallId?: string;
    readonly createdAt: string;
    readonly receiptHash: string;
    readonly previousReceiptHash?: string;
  }[];
}

export interface FederationBrainVerificationReport {
  readonly verificationKoId: string;
  readonly verificationContentHash: string;
  readonly verdict: "pass" | "fail";
  readonly failedChecks: readonly string[];
  readonly warningChecks: readonly string[];
  readonly verifierInstallId: string;
  readonly createdAt: string;
  readonly receiptHash: string;
}

export interface FederationBrainReadBase {
  readonly id: string;
  readonly asConsumer?: string;
  readonly receipts: FederationBrainReceiptSummary;
  readonly verificationReports: readonly FederationBrainVerificationReport[];
  readonly receiptVerification: {
    readonly koChainValid: boolean;
    readonly globalAnchorValid: boolean;
    readonly checked: {
      readonly koReceipts: number;
      readonly globalAnchors: number;
    };
  };
}

export interface FederationBrainAllowedRead extends FederationBrainReadBase {
  readonly status: "allowed";
  readonly tenant: string;
  readonly contentType: string;
  readonly contentHash: string;
  readonly creatorInstallId: string;
  readonly signerInstallId: string;
  readonly provenance: {
    readonly source: "local" | "federated";
    readonly creatorInstallId: string;
    readonly receivedFromInstallId?: string;
    readonly storedAt: string;
  };
  readonly verification: {
    readonly signature: "verified";
    readonly contentHash: string;
  };
  readonly consent: {
    readonly status: "enforced" | "local_owner";
    readonly consumerInstallId?: string;
  };
  readonly content: FederationBrainDashboardContent | unknown;
}

export interface FederationBrainDeniedRead extends FederationBrainReadBase {
  readonly status: "denied";
  readonly reason: string;
}

export type FederationBrainRead = FederationBrainAllowedRead | FederationBrainDeniedRead;

export const federationBrainApi = {
  show: (koId: string, asConsumer?: string) => {
    const params = new URLSearchParams();
    if (asConsumer?.trim()) {
      params.set("asConsumer", asConsumer.trim());
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return api.get<FederationBrainRead>(`/federation/brain/${encodeURIComponent(koId)}${suffix}`);
  },
};
