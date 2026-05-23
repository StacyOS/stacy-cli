import { api } from "./client";

export interface FederationBrainWidget {
  readonly kind?: string;
  readonly label?: string;
  readonly value?: string | number;
}

export interface FederationBrainReceiptEvent {
  readonly id: string;
  readonly eventType: "read" | "deny" | "revoke" | "receive" | "store" | string;
  readonly koId: string;
  readonly actorInstallId: string;
  readonly counterpartyInstallId?: string;
  readonly createdAt: string;
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

export interface FederationBrainReportContent {
  readonly kind?: "report";
  readonly title?: string;
  readonly summary?: string;
  readonly task?: string;
  readonly generator?: string;
  readonly sections?: readonly {
    readonly heading?: string;
    readonly body?: string;
  }[];
  readonly input?: {
    readonly fileName?: string;
    readonly rows?: number;
    readonly contentHash?: string;
  };
  readonly adapterNotes?: readonly string[];
  readonly redactedColumns?: readonly string[];
}

export interface FederationBrainTableContent {
  readonly kind?: "table";
  readonly title?: string;
  readonly summary?: string;
  readonly columns?: readonly string[];
  readonly rows?: readonly Record<string, unknown>[];
  readonly input?: {
    readonly fileName?: string;
    readonly rows?: number;
    readonly contentHash?: string;
  };
  readonly adapterNotes?: readonly string[];
}

export interface FederationBrainReferralPacketContent {
  readonly kind?: "referral_packet";
  readonly title?: string;
  readonly summary?: string;
  readonly task?: string;
  readonly generator?: string;
  readonly patientReference?: string;
  readonly referralReason?: string;
  readonly clinicalSummary?: string;
  readonly labSnapshot?: string;
  readonly medications?: readonly string[];
  readonly imagingStatus?: string;
  readonly consent?: {
    readonly expiresAt?: string;
    readonly revocationReason?: string;
  };
  readonly attachments?: readonly {
    readonly label?: string;
    readonly status?: string;
  }[];
  readonly input?: {
    readonly fileName?: string;
    readonly rows?: number;
    readonly contentHash?: string;
  };
  readonly adapterNotes?: readonly string[];
  readonly redactedColumns?: readonly string[];
}

export interface FederationBrainDerivedContent {
  readonly kind?: "derived_knowledge_object";
  readonly schemaVersion?: number;
  readonly source?: {
    readonly koId?: string;
    readonly koContentHash?: string;
    readonly producerInstallId?: string;
    readonly grantId?: string;
    readonly grantScope?: string;
  };
  readonly createdByConsumerInstallId?: string;
  readonly createdAt?: string;
  readonly derivedContent?: unknown;
}

export interface FederationBrainIdentityDisplay {
  readonly label: string;
  readonly installId: string;
  readonly shortInstallId: string;
  readonly verified: boolean;
  readonly publicKeyFingerprint?: string;
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
  readonly identities?: {
    readonly producer?: FederationBrainIdentityDisplay;
    readonly consumer?: FederationBrainIdentityDisplay;
    readonly signer?: FederationBrainIdentityDisplay;
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
    readonly grantId?: string;
    readonly recipient?: {
      readonly type?: "install" | "group" | string;
      readonly id?: string;
      readonly role?: string;
    };
  };
  readonly content:
    | FederationBrainDashboardContent
    | FederationBrainReportContent
    | FederationBrainTableContent
    | FederationBrainReferralPacketContent
    | FederationBrainDerivedContent
    | unknown;
}

export interface FederationBrainDeniedRead extends FederationBrainReadBase {
  readonly status: "denied";
  readonly reason: string;
}

export type FederationBrainRead = FederationBrainAllowedRead | FederationBrainDeniedRead;

export interface FederationMetrics {
  readonly koCount?: number;
  readonly shareCount?: number;
  readonly revokeCount?: number;
  readonly denyCount?: number;
  readonly readCount?: number;
  readonly receiveCount?: number;
  readonly averageFederationReceiveMs?: number | null;
  readonly federationRoundtripP50Ms?: number | null;
  readonly averageReadEnforcementMs?: number | null;
  readonly mostRecentReceiptAt?: string | null;
  readonly receiptChain?: {
    readonly globalAnchorValid?: boolean;
    readonly checkedAnchors?: number;
    readonly reason?: string;
  };
  readonly receipts?: {
    readonly total?: number;
    readonly byEvent?: Record<string, number>;
  };
}

export const federationBrainApi = {
  show: (koId: string, asConsumer?: string) => {
    const params = new URLSearchParams();
    if (asConsumer?.trim()) {
      params.set("asConsumer", asConsumer.trim());
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return api.get<FederationBrainRead>(`/federation/brain/${encodeURIComponent(koId)}${suffix}`);
  },
  metrics: () => api.get<FederationMetrics>("/federation/metrics"),
  eventsUrl: (koId: string) => `/api/federation/brain/${encodeURIComponent(koId)}/events`,
};
