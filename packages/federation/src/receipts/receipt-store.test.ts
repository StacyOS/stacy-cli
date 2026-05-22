import { describe, expect, it } from "vitest";

import type { BrainDb } from "../brain/brain-store.js";
import { appendReceipt, hashReceipt, listReceipts, verifyReceiptChain } from "./receipt-store.js";

describe("receipt store", () => {
  it("appends receipts without updating prior rows", async () => {
    const writes: unknown[] = [];
    const db: BrainDb = {
      execute: async (query) => {
        writes.push(query);
        return [];
      },
    };

    await expect(
      appendReceipt({
        db,
        eventType: "share",
        tenant: "stacy/acme",
        koId: "ko_receipt",
        actorInstallId: "install_a",
        counterpartyInstallId: "install_b",
        payload: { grantId: "grant_1" },
        createdAt: new Date("2026-05-22T00:00:00.000Z"),
        idGenerator: () => "receipt_1",
      }),
    ).resolves.toMatchObject({
      id: "receipt_1",
      eventType: "share",
      koId: "ko_receipt",
      actorInstallId: "install_a",
      counterpartyInstallId: "install_b",
    });

    expect(writes).toHaveLength(7);
  });

  it("lists receipts in stored order", async () => {
    const db = dbForSelectRows([receiptRow("receipt_1", "share", "install_a", "install_b")]);

    await expect(listReceipts({ db, koId: "ko_receipt" })).resolves.toEqual([
      {
        id: "receipt_1",
        eventType: "share",
        tenant: "stacy/acme",
        koId: "ko_receipt",
        actorInstallId: "install_a",
        counterpartyInstallId: "install_b",
        payload: { grantId: "grant_1" },
        createdAt: "2026-05-22T00:00:00.000Z",
        receiptHash: hashReceipt({
          id: "receipt_1",
          eventType: "share",
          tenant: "stacy/acme",
          koId: "ko_receipt",
          actorInstallId: "install_a",
          counterpartyInstallId: "install_b",
          payload: { grantId: "grant_1" },
          createdAt: "2026-05-22T00:00:00.000Z",
        }),
      },
    ]);
  });

  it("links new receipts to the previous receipt hash for the same KO", async () => {
    let latestHash: string | undefined;
    const db: BrainDb = {
      execute: async () => {
        if (latestHash) return [{ receipt_hash: latestHash }];
        return [];
      },
    };

    const first = await appendReceipt({
      db,
      eventType: "create",
      tenant: "stacy/acme",
      koId: "ko_receipt",
      actorInstallId: "install_a",
      createdAt: new Date("2026-05-22T00:00:00.000Z"),
      idGenerator: () => "receipt_1",
    });
    latestHash = first.receiptHash;

    const second = await appendReceipt({
      db,
      eventType: "share",
      tenant: "stacy/acme",
      koId: "ko_receipt",
      actorInstallId: "install_a",
      counterpartyInstallId: "install_b",
      createdAt: new Date("2026-05-22T00:00:01.000Z"),
      idGenerator: () => "receipt_2",
    });

    expect(first.previousReceiptHash).toBeUndefined();
    expect(second.previousReceiptHash).toBe(first.receiptHash);
  });

  it("finds the chain tail by hash link instead of timestamp order", async () => {
    const existingRows = linkedRows([
      receiptRow("receipt_1", "receive", "install_b", "install_a"),
      receiptRow("receipt_2", "store", "install_b", "install_a"),
    ]).map((row) => ({ ...row, created_at: "2026-05-22T00:00:00.000Z" }));
    let callCount = 0;
    const db: BrainDb = {
      execute: async () => {
        callCount += 1;
        if (callCount <= 5) return [];
        if (callCount === 6) return [...existingRows].reverse();
        return [];
      },
    };

    const receipt = await appendReceipt({
      db,
      eventType: "read",
      tenant: "stacy/acme",
      koId: "ko_receipt",
      actorInstallId: "install_b",
      counterpartyInstallId: "install_a",
      createdAt: new Date("2026-05-22T00:00:01.000Z"),
      idGenerator: () => "receipt_3",
    });

    expect(receipt.previousReceiptHash).toBe(existingRows[1]?.receipt_hash);
  });

  it("verifies a valid receipt chain", async () => {
    const rows = linkedRows([
      receiptRow("receipt_1", "create", "install_a"),
      receiptRow("receipt_2", "share", "install_a", "install_b"),
    ]);

    await expect(verifyReceiptChain({ db: dbForSelectRows(rows), koId: "ko_receipt" })).resolves.toEqual({
      valid: true,
      checked: 2,
    });
  });

  it("detects a tampered receipt payload", async () => {
    const rows = linkedRows([
      receiptRow("receipt_1", "create", "install_a"),
      receiptRow("receipt_2", "share", "install_a", "install_b"),
    ]);
    rows[1] = { ...rows[1], payload_json: { grantId: "tampered" } };

    await expect(verifyReceiptChain({ db: dbForSelectRows(rows), koId: "ko_receipt" })).resolves.toMatchObject({
      valid: false,
      firstInvalidReceiptId: "receipt_2",
      reason: "receipt hash mismatch",
    });
  });

  it("detects a deleted receipt in the middle of a chain", async () => {
    const rows = linkedRows([
      receiptRow("receipt_1", "create", "install_a"),
      receiptRow("receipt_2", "share", "install_a", "install_b"),
      receiptRow("receipt_3", "revoke", "install_a"),
    ]);

    await expect(verifyReceiptChain({ db: dbForSelectRows([rows[0]!, rows[2]!]), koId: "ko_receipt" })).resolves.toMatchObject({
      valid: false,
      firstInvalidReceiptId: "receipt_3",
      reason: `expected previous hash ${rows[1]?.receipt_hash}`,
    });
  });
});

function dbForSelectRows(rows: readonly unknown[]): BrainDb {
  let callCount = 0;
  let index = 0;
  return {
    execute: async () => {
      callCount += 1;
      if (callCount <= 5) return [];
      if (index === 0) {
        index += 1;
        return rows;
      }
      return [];
    },
  };
}

function receiptRow(
  id: string,
  eventType: "create" | "share" | "revoke" | "receive" | "store" | "read",
  actorInstallId: string,
  counterpartyInstallId?: string,
) {
  return {
    id,
    event_type: eventType,
    tenant: "stacy/acme",
    ko_id: "ko_receipt",
    actor_install_id: actorInstallId,
    counterparty_install_id: counterpartyInstallId ?? null,
    payload_json: eventType === "share" ? { grantId: "grant_1" } : {},
    created_at: id === "receipt_1" ? "2026-05-22T00:00:00.000Z" : id === "receipt_2" ? "2026-05-22T00:00:01.000Z" : "2026-05-22T00:00:02.000Z",
    previous_receipt_hash: null,
    receipt_hash: null,
  };
}

function linkedRows(rows: ReturnType<typeof receiptRow>[]) {
  let previousReceiptHash: string | undefined;
  return rows.map((row) => {
    const receiptHash = hashReceipt({
      id: row.id,
      eventType: row.event_type,
      tenant: row.tenant,
      koId: row.ko_id,
      actorInstallId: row.actor_install_id,
      counterpartyInstallId: row.counterparty_install_id ?? undefined,
      payload: row.payload_json,
      createdAt: row.created_at,
      previousReceiptHash,
    });
    const linked = {
      ...row,
      previous_receipt_hash: previousReceiptHash ?? null,
      receipt_hash: receiptHash,
    };
    previousReceiptHash = receiptHash;
    return linked;
  });
}
