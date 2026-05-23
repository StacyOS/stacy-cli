/**
 * Generated from ../../docs/openapi/federation.yaml.
 * Regenerate with: pnpm run generate
 */

export interface paths {
  "/api/federation/v1/ko/{id}": {
    get: {
      parameters: {
        path: {
          id: string;
        };
        query?: {
          asConsumer?: string;
        };
      };
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["FederationKoReadResponse"];
          };
        };
        404: {
          content: {
            "application/json": components["schemas"]["ErrorResponse"];
          };
        };
      };
    };
  };
  "/api/federation/ko/{id}": {
    get: {
      parameters: {
        path: {
          id: string;
        };
        query?: {
          asConsumer?: string;
        };
      };
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["FederationKoReadResponse"];
          };
        };
      };
    };
  };
}

export interface components {
  schemas: {
    FederationKoReadResponse: components["schemas"]["AllowedKoRead"] | components["schemas"]["DeniedKoRead"];
    AllowedKoRead: {
      status: "allowed";
      id: string;
      tenant: string;
      contentType: string;
      contentHash: string;
      creatorInstallId: string;
      signerInstallId: string;
      identities?: components["schemas"]["IdentityMap"];
      asConsumer?: string;
      provenance?: Record<string, unknown>;
      verification: {
        signature: "verified";
        contentHash: string;
      };
      consent: {
        status: "enforced" | "local_owner";
        consumerInstallId?: string;
      };
      content: Record<string, unknown>;
      receipts: components["schemas"]["ReceiptSummary"];
      verificationReports?: Record<string, unknown>[];
      receiptVerification: components["schemas"]["ReceiptVerification"];
    };
    DeniedKoRead: {
      status: "denied";
      id: string;
      reason: string;
      asConsumer?: string;
      identities?: components["schemas"]["IdentityMap"];
      receipts: components["schemas"]["ReceiptSummary"];
      verificationReports?: Record<string, unknown>[];
      receiptVerification: components["schemas"]["ReceiptVerification"];
    };
    IdentityMap: {
      producer?: components["schemas"]["IdentityDisplay"];
      signer?: components["schemas"]["IdentityDisplay"];
      consumer?: components["schemas"]["IdentityDisplay"];
    };
    IdentityDisplay: {
      label: string;
      installId: string;
      shortInstallId: string;
      verified: boolean;
      publicKeyFingerprint?: string;
    };
    ReceiptSummary: {
      total: number;
      byEvent: Record<string, number>;
      events: Record<string, unknown>[];
    };
    ReceiptVerification: {
      koChainValid: boolean;
      globalAnchorValid: boolean;
      checked: {
        koReceipts?: number;
        globalAnchors?: number;
      };
    };
    ErrorResponse: {
      error: string;
    };
  };
}
