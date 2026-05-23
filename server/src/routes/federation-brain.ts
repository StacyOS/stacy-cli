import { Router } from "express";
import type { Db } from "@arpanstacy/stacy-db";
import {
  listReceipts,
  readKnowledgeObject,
  readKnowledgeObjectWithConsent,
  syncRevocationFromProducer,
  verifyGlobalReceiptAnchor,
  verifyReceiptChain,
  type FederationReceipt,
  type ReadKnowledgeObjectResult,
} from "@arpanstacy/stacy-federation";

type SuccessfulRead = Extract<ReadKnowledgeObjectResult, { ok: true }>;

export function federationBrainRoutes(db: Db) {
  const router = Router();

  router.get("/:koId", async (req, res, next) => {
    try {
      const koId = req.params.koId?.trim();
      if (!koId) {
        res.status(400).json({ error: "Missing koId" });
        return;
      }

      const asConsumer = typeof req.query.asConsumer === "string" ? req.query.asConsumer.trim() : "";
      if (asConsumer) {
        await syncRevocationFromProducer({ db, koId });
      }

      const read = asConsumer
        ? await readKnowledgeObjectWithConsent({ db, koId, consumerInstallId: asConsumer })
        : await readKnowledgeObject({ db, koId });

      const receipts = await listReceipts({ db, koId });
      const chain = await verifyReceiptChain({ db, koId });
      const globalAnchor = await verifyGlobalReceiptAnchor({ db });

      if (!read.ok) {
        if (read.reason.startsWith("Knowledge Object not found")) {
          res.status(404).json({ error: read.reason });
          return;
        }
        res.status(200).json({
          status: "denied",
          id: koId,
          reason: read.reason,
          asConsumer: asConsumer || undefined,
          receipts: summarizeReceipts(receipts),
          verificationReports: summarizeVerificationReports(receipts),
          receiptVerification: {
            koChainValid: chain.valid,
            globalAnchorValid: globalAnchor.valid,
            checked: {
              koReceipts: chain.checked,
              globalAnchors: globalAnchor.checked,
            },
          },
        });
        return;
      }

      res.status(200).json(formatAllowedRead(read, receipts, {
        asConsumer: asConsumer || undefined,
        koChainValid: chain.valid,
        globalAnchorValid: globalAnchor.valid,
        koReceiptsChecked: chain.checked,
        globalAnchorsChecked: globalAnchor.checked,
      }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function formatAllowedRead(
  read: SuccessfulRead,
  receipts: readonly FederationReceipt[],
  options: {
    readonly asConsumer?: string;
    readonly koChainValid: boolean;
    readonly globalAnchorValid: boolean;
    readonly koReceiptsChecked: number;
    readonly globalAnchorsChecked: number;
  },
) {
  const content = read.ko.signedPayload.content;

  return {
    status: "allowed",
    id: read.ko.id,
    tenant: read.ko.signedPayload.tenant,
    contentType: read.ko.signedPayload.contentType,
    contentHash: read.verification.contentHash,
    creatorInstallId: read.ko.signedPayload.creatorInstallId,
    signerInstallId: read.ko.signer.installId,
    asConsumer: options.asConsumer,
    provenance: read.provenance,
    verification: {
      signature: "verified",
      contentHash: read.verification.contentHash,
    },
    consent: {
      status: read.provenance.source === "federated" ? "enforced" : "local_owner",
      consumerInstallId: options.asConsumer,
    },
    content,
    receipts: summarizeReceipts(receipts),
    verificationReports: summarizeVerificationReports(receipts),
    receiptVerification: {
      koChainValid: options.koChainValid,
      globalAnchorValid: options.globalAnchorValid,
      checked: {
        koReceipts: options.koReceiptsChecked,
        globalAnchors: options.globalAnchorsChecked,
      },
    },
  };
}

function summarizeReceipts(receipts: readonly FederationReceipt[]) {
  const byEvent: Record<string, number> = {};
  for (const receipt of receipts) {
    byEvent[receipt.eventType] = (byEvent[receipt.eventType] ?? 0) + 1;
  }

  return {
    total: receipts.length,
    byEvent,
    events: receipts.map((receipt) => ({
      id: receipt.id,
      eventType: receipt.eventType,
      actorInstallId: receipt.actorInstallId,
      counterpartyInstallId: receipt.counterpartyInstallId,
      createdAt: receipt.createdAt,
      receiptHash: receipt.receiptHash,
      previousReceiptHash: receipt.previousReceiptHash,
    })),
  };
}

function summarizeVerificationReports(receipts: readonly FederationReceipt[]) {
  return receipts
    .filter((receipt) => receipt.eventType === "verify")
    .map((receipt) => {
      const payload = receipt.payload;
      return {
        verificationKoId: stringPayload(payload.verificationKoId),
        verificationContentHash: stringPayload(payload.verificationContentHash),
        verdict: payload.verdict === "fail" ? "fail" : "pass",
        failedChecks: stringArrayPayload(payload.failedChecks),
        warningChecks: stringArrayPayload(payload.warningChecks),
        verifierInstallId: receipt.actorInstallId,
        createdAt: receipt.createdAt,
        receiptHash: receipt.receiptHash,
      };
    })
    .filter((report) => report.verificationKoId.length > 0)
    .reverse();
}

function stringPayload(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArrayPayload(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
