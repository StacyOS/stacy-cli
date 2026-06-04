import { describe, expect, it } from "vitest";

import { hashReceipt, hashReceiptAnchor } from "../src/receipts/receipt-store.js";
import { receiptsListCommand, receiptsVerifyCommand } from "./receipts.js";

describe("receiptsListCommand", () => {
  it("prints raw receipt JSON", async () => {
    const lines: string[] = [];

    await receiptsListCommand(
      { dbUrl: "postgres://example", ko: "ko_public", json: true },
      {
        createDb: () => dbForRows([
          [
            receiptRow("receipt_read", "read", "install_b", "install_a"),
            receiptRow("receipt_deny", "deny", "install_b", "install_a"),
          ],
        ]),
        stdout: { log: (line) => lines.push(line) },
      },
    );

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      receipts: [
        { id: "receipt_read", eventType: "read", koId: "ko_public" },
        { id: "receipt_deny", eventType: "deny", koId: "ko_public" },
      ],
    });
  });

  it("prints grouped receipt text for presenters", async () => {
    const lines: string[] = [];

    await receiptsListCommand(
      { dbUrl: "postgres://example", ko: "ko_public" },
      {
        createDb: () => dbForRows([
          [
            receiptRow("receipt_create", "create", "install_a"),
            receiptRow("receipt_share", "share", "install_a", "install_b"),
            receiptRow("receipt_revoke", "revoke", "install_a"),
          ],
        ]),
        stdout: { log: (line) => lines.push(line) },
      },
    );

    const output = lines.join("\n");
    expect(output).toContain("Federation receipts:");
    expect(output).toContain("By event:");
    expect(output).toContain("create: 1");
    expect(output).toContain("share: 1");
    expect(output).toContain("revoke: 1");
    expect(output).toContain("Events:");
    expect(output).toContain("share (ko_public) by install_a -> install_b");
    expect(output).toContain("Total: 3");
  });

  it("prints receipt-chain verification status", async () => {
    const lines: string[] = [];
    const rows = linkedRows([
      receiptRow("receipt_create", "create", "install_a"),
      receiptRow("receipt_share", "share", "install_a", "install_b"),
    ]);

    await receiptsVerifyCommand(
      { dbUrl: "postgres://example", ko: "ko_public" },
      {
        createDb: () => dbForRows([rows]),
        stdout: { log: (line) => lines.push(line) },
      },
    );

    expect(lines.join("\n")).toContain("Receipt chain valid. Checked 2 receipt(s).");
  });

  it("fails when receipt-chain verification is invalid", async () => {
    const lines: string[] = [];
    const rows = linkedRows([
      receiptRow("receipt_create", "create", "install_a"),
      receiptRow("receipt_share", "share", "install_a", "install_b"),
    ]);
    rows[1] = { ...rows[1]!, payload_json: { grantId: "tampered" } };

    await expect(
      receiptsVerifyCommand(
        { dbUrl: "postgres://example", ko: "ko_public" },
        {
          createDb: () => dbForRows([rows]),
          stdout: { log: (line) => lines.push(line) },
        },
      ),
    ).rejects.toThrow("Receipt chain invalid.");

    expect(lines.join("\n")).toContain("Reason: receipt hash mismatch");
  });

  it("prints global receipt-anchor verification status", async () => {
    const lines: string[] = [];
    const rows = linkedRows([
      receiptRow("receipt_create", "create", "install_a"),
      receiptRow("receipt_read", "read", "install_b", "install_a", "ko_other"),
    ]);
    const anchors = linkedAnchorRows(rows);

    await receiptsVerifyCommand(
      { dbUrl: "postgres://example", global: true },
      {
        createDb: () => dbForRows([anchors, rows, receiptChainHeadRow(anchors)]),
        stdout: { log: (line) => lines.push(line) },
      },
    );

    expect(lines.join("\n")).toContain("Global receipt anchor valid. Checked 2 anchor(s).");
  });

  it("fails when global receipt-anchor verification is invalid", async () => {
    const lines: string[] = [];
    const rows = linkedRows([
      receiptRow("receipt_create", "create", "install_a"),
      receiptRow("receipt_read", "read", "install_b", "install_a", "ko_other"),
    ]);
    const anchors = linkedAnchorRows(rows);

    await expect(
      receiptsVerifyCommand(
        { dbUrl: "postgres://example", global: true },
        {
          createDb: () => dbForRows([anchors, [rows[0]!], receiptChainHeadRow(anchors)]),
          stdout: { log: (line) => lines.push(line) },
        },
      ),
    ).rejects.toThrow("Global receipt anchor invalid.");

    expect(lines.join("\n")).toContain("Reason: anchored receipt receipt_read is missing");
  });

  it("rejects mixing --global and --ko", async () => {
    await expect(
      receiptsVerifyCommand(
        { dbUrl: "postgres://example", ko: "ko_public", global: true },
        { createDb: () => dbForRows([]) },
      ),
    ).rejects.toThrow("Pass either --global or --ko, not both.");
  });
});

function receiptRow(
  id: string,
  eventType: "create" | "share" | "revoke" | "read" | "deny",
  actorInstallId: string,
  counterpartyInstallId?: string,
  koId = "ko_public",
) {
  return {
    id,
    event_type: eventType,
    tenant: "stacy/acme",
    ko_id: koId,
    actor_install_id: actorInstallId,
    counterparty_install_id: counterpartyInstallId ?? null,
    payload_json: {},
    created_at: "2026-05-22T00:00:00.000Z",
    previous_receipt_hash: null,
    receipt_hash: null,
  };
}

function dbForRows(rows: readonly unknown[]) {
  let callCount = 0;
  let index = 0;
  return {
    execute: async () => {
      callCount += 1;
      if (callCount <= 10) return [];
      return rows[index++] ?? [];
    },
  };
}

function receiptChainHeadRow(anchorRows: ReturnType<typeof linkedAnchorRows>) {
  const tail = anchorRows.at(-1);
  return tail ? [{ id: "instance", anchor_hash: tail.anchor_hash, updated_at: tail.created_at }] : [];
}

function linkedAnchorRows(rows: ReturnType<typeof linkedRows>) {
  let previousAnchorHash: string | undefined;
  return rows.map((row) => {
    const id = `anchor_${row.id}`;
    const anchorHash = hashReceiptAnchor({
      id,
      previousAnchorHash,
      receiptId: row.id,
      receiptHash: row.receipt_hash,
      createdAt: row.created_at,
    });
    const linked = {
      id,
      previous_anchor_hash: previousAnchorHash ?? null,
      receipt_id: row.id,
      receipt_hash: row.receipt_hash,
      anchor_hash: anchorHash,
      created_at: row.created_at,
    };
    previousAnchorHash = anchorHash;
    return linked;
  });
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
