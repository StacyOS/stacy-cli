import { Router } from "express";
import { createHash } from "node:crypto";
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
const UNVERSIONED_KO_API_SUNSET = "Fri, 21 Aug 2026 00:00:00 GMT";

export function federationBrainRoutes(db: Db) {
  const router = Router();

  router.get("/:koId/events", async (req, res, next) => {
    try {
      const koId = req.params.koId?.trim();
      if (!koId) {
        res.status(400).json({ error: "Missing koId" });
        return;
      }

      const pollMs = parseEventPollMs(req.query.pollMs);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(formatSseEvent("ready", {
        koId,
        pollMs,
        createdAt: new Date().toISOString(),
      }));

      let closed = false;
      const seenReceiptIds = new Set((await listReceipts({ db, koId })).map((receipt) => receipt.id));

      const poll = async () => {
        if (closed) return;
        try {
          const receipts = await listReceipts({ db, koId });
          for (const receipt of receipts) {
            if (seenReceiptIds.has(receipt.id)) continue;
            seenReceiptIds.add(receipt.id);
            if (isLiveUiReceiptEvent(receipt.eventType)) {
              res.write(formatSseEvent("receipt", summarizeReceiptEvent(receipt)));
            }
          }
        } catch (error) {
          res.write(formatSseEvent("error", {
            koId,
            message: error instanceof Error ? error.message : "Unable to poll federation receipts.",
          }));
        }
      };

      const interval = setInterval(() => {
        void poll();
      }, pollMs);

      req.on("close", () => {
        closed = true;
        clearInterval(interval);
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:koId", async (req, res, next) => {
    try {
      if (isUnversionedKoApi(req.baseUrl)) {
        res.setHeader("Deprecation", "true");
        res.setHeader("Sunset", UNVERSIONED_KO_API_SUNSET);
        res.setHeader("Link", '</api/federation/v1/ko/{id}>; rel="successor-version"');
      }
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
          identities: {
            consumer: createIdentityDisplay(asConsumer, "Dr. Meera Patel / Eastside Specialty"),
          },
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

function isUnversionedKoApi(baseUrl: string): boolean {
  return /\/api\/federation\/ko$/.test(baseUrl);
}

function parseEventPollMs(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 500;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 50 || parsed > 10_000) return 500;
  return parsed;
}

function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isLiveUiReceiptEvent(eventType: FederationReceipt["eventType"]): boolean {
  return eventType === "read" ||
    eventType === "deny" ||
    eventType === "revoke" ||
    eventType === "receive" ||
    eventType === "store";
}

function summarizeReceiptEvent(receipt: FederationReceipt) {
  return {
    id: receipt.id,
    eventType: receipt.eventType,
    koId: receipt.koId,
    actorInstallId: receipt.actorInstallId,
    counterpartyInstallId: receipt.counterpartyInstallId,
    createdAt: receipt.createdAt,
  };
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
    identities: {
      producer: createIdentityDisplay(read.ko.signedPayload.creatorInstallId, "Northstar Clinic", read.ko.signer.publicKeyPem),
      signer: createIdentityDisplay(read.ko.signer.installId, "Northstar Clinic", read.ko.signer.publicKeyPem),
      ...(options.asConsumer ? { consumer: createIdentityDisplay(options.asConsumer, "Dr. Meera Patel / Eastside Specialty") } : {}),
    },
    asConsumer: options.asConsumer,
    provenance: read.provenance,
    verification: {
      signature: "verified",
      contentHash: read.verification.contentHash,
    },
    consent: {
      status: read.provenance.source === "federated" ? "enforced" : "local_owner",
      consumerInstallId: options.asConsumer,
      grantId: read.consent?.grantId,
      recipient: read.consent?.recipient,
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

function createIdentityDisplay(installId: string | undefined, preferredLabel?: string, publicKeyPem?: string) {
  const normalizedInstallId = installId?.trim() ?? "";
  return {
    label: preferredLabel?.trim() || compactInstallId(normalizedInstallId),
    installId: normalizedInstallId,
    shortInstallId: compactInstallId(normalizedInstallId),
    verified: normalizedInstallId.length > 0,
    ...(publicKeyPem ? { publicKeyFingerprint: `sha256:${createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16)}` } : {}),
  };
}

function compactInstallId(installId: string): string {
  if (!installId) return "unknown install";
  if (installId.length <= 22) return installId;
  return `${installId.slice(0, 14)}...${installId.slice(-6)}`;
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
