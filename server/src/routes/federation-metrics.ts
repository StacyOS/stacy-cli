import { Router } from "express";
import type { Db } from "@arpanstacy/stacy-db";
import {
  listReceipts,
  verifyGlobalReceiptAnchor,
} from "@arpanstacy/stacy-federation";

export function federationMetricsRoutes(db: Db) {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const receipts = await listReceipts({ db });
      const globalAnchor = await verifyGlobalReceiptAnchor({ db });
      const byEvent: Record<string, number> = {};
      const koIds = new Set<string>();

      for (const receipt of receipts) {
        byEvent[receipt.eventType] = (byEvent[receipt.eventType] ?? 0) + 1;
        koIds.add(receipt.koId);
      }

      res.status(200).json({
        koCount: koIds.size,
        shareCount: byEvent.share ?? 0,
        revokeCount: byEvent.revoke ?? 0,
        denyCount: byEvent.deny ?? 0,
        readCount: byEvent.read ?? 0,
        receiveCount: byEvent.receive ?? 0,
        averageFederationReceiveMs: averagePayloadNumber(receipts, "receiveDurationMs"),
        federationRoundtripP50Ms: percentilePayloadNumber(receipts, "receiveDurationMs", 0.5),
        averageReadEnforcementMs: averagePayloadNumber(receipts, "readEnforcementMs"),
        mostRecentReceiptAt: mostRecentReceiptAt(receipts),
        receiptChain: {
          globalAnchorValid: globalAnchor.valid,
          checkedAnchors: globalAnchor.checked,
          ...(globalAnchor.valid ? {} : { reason: globalAnchor.reason }),
        },
        receipts: {
          total: receipts.length,
          byEvent,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function percentilePayloadNumber(
  receipts: Awaited<ReturnType<typeof listReceipts>>,
  key: string,
  percentile: number,
): number | null {
  const values = receipts
    .map((receipt) => receipt.payload[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * percentile) - 1));
  return values[index];
}

function mostRecentReceiptAt(
  receipts: Awaited<ReturnType<typeof listReceipts>>,
): string | null {
  const timestamps = receipts
    .map((receipt) => typeof receipt.createdAt === "string" ? receipt.createdAt : "")
    .filter(Boolean)
    .sort();
  return timestamps.at(-1) ?? null;
}

function averagePayloadNumber(
  receipts: Awaited<ReturnType<typeof listReceipts>>,
  key: string,
): number | null {
  const values = receipts
    .map((receipt) => receipt.payload[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}
