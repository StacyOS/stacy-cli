import { describe, expect, it } from "vitest";

import { hashReceipt } from "../src/receipts/receipt-store.js";
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
});

function receiptRow(
  id: string,
  eventType: "create" | "share" | "revoke" | "read" | "deny",
  actorInstallId: string,
  counterpartyInstallId?: string,
) {
  return {
    id,
    event_type: eventType,
    tenant: "stacy/acme",
    ko_id: "ko_public",
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
      if (callCount <= 5) return [];
      return rows[index++] ?? [];
    },
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
