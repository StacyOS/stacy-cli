import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { loadInstallIdentity } from "../../src/identity/install-identity.js";
import { resolveFederationIdentityPath } from "../../src/identity/paths.js";
import { createTwoInstallHarness, type HarnessCommandResult } from "./two-install-harness.js";

const runPublicDemoSmoke = process.env.STACY_FEDERATION_PUBLIC_DEMO_SMOKE === "1";
const demoCsvPath = resolve(process.cwd(), "demo/acme-q2-revenue.csv");
const demoSchemaPath = resolve(process.cwd(), "demo/acme-dashboard.schema.json");
const publicDemoAdapterCommand = process.env.STACY_PUBLIC_DEMO_ADAPTER?.trim();
const publicDemoAdapterArgs = parseAdapterArgs(process.env.STACY_PUBLIC_DEMO_ADAPTER_ARGS);

describe.skipIf(!runPublicDemoSmoke)("public StacyOS federation demo", () => {
  it("runs task -> KO -> contact share -> read -> revoke -> denied next read with receipts", async () => {
    const startedAt = performance.now();
    const harness = await createTwoInstallHarness();
    try {
      logStep("1. Start isolated installs", [
        `install A config: ${harness.installA.configPath}`,
        `install B config: ${harness.installB.configPath}`,
      ]);
      await harness.prepare();
      await harness.startServer("A", { timeoutMs: 60_000, intervalMs: 500 });
      await harness.startServer("B", { timeoutMs: 60_000, intervalMs: 500 });

      const seedBCommand = [
        "brain",
        "create",
        "--config",
        harness.installB.configPath,
        "--content-json",
        JSON.stringify({ title: "Meera identity seed" }),
        "--ko-id",
        "ko_meera_identity_seed",
        "--json",
      ];
      logStep("2. Create B identity seed", [formatDemoCommand("B", seedBCommand)]);
      const seedB = await harness.runCli("B", seedBCommand);
      expectSuccessfulCommand(seedB);
      const consumerIdentity = await loadInstallIdentity(resolveFederationIdentityPath(harness.installB.instanceRoot));

      const contactCardPath = join(harness.rootDir, "meera.contact-card.json");
      const exportContactCardCommand = [
        "contacts",
        "export",
        "meera",
        "--config",
        harness.installB.configPath,
        "--endpoint",
        `http://127.0.0.1:${harness.installB.serverPort}/api/federation`,
        "--revocation-url",
        `http://127.0.0.1:${harness.installB.serverPort}/api/federation/revocations`,
        "--label",
        "Meera's Stacy install",
        "--out",
        contactCardPath,
      ];
      const importContactCardCommand = [
        "contacts",
        "import",
        contactCardPath,
        "--config",
        harness.installA.configPath,
        "--as",
        "meera",
        "--json",
      ];
      logStep("3. Exchange B's signed contact card as meera", [
        formatDemoCommand("B", exportContactCardCommand),
        formatDemoCommand("A", importContactCardCommand),
      ]);
      const exportContactCard = await harness.runCli("B", exportContactCardCommand);
      const importContactCard = await harness.runCli("A", importContactCardCommand);
      expectSuccessfulCommand(exportContactCard);
      expectSuccessfulCommand(importContactCard);
      expect(parseCommandJson(importContactCard)).toMatchObject({
        name: "meera",
        installId: consumerIdentity.record.installId,
        federationEndpointUrl: `http://127.0.0.1:${harness.installB.serverPort}/api/federation`,
      });

      const runTaskCommand = [
        "run",
        "build a quarterly revenue dashboard from this CSV",
        "--config",
        harness.installA.configPath,
        "--input",
        demoCsvPath,
        "--schema",
        demoSchemaPath,
        "--ko-id",
        "ko_public_revenue_dashboard",
        ...(publicDemoAdapterCommand
          ? [
              "--adapter-command",
              publicDemoAdapterCommand,
              ...publicDemoAdapterArgs.flatMap((arg) => ["--adapter-arg", arg]),
            ]
          : []),
        "--json",
      ];
      logStep("4. Create signed KO from real CSV task", [formatDemoCommand("A", runTaskCommand)]);
      const runTask = await harness.runCli("A", runTaskCommand);
      expectSuccessfulCommand(runTask);
      const created = parseCommandJson(runTask) as {
        readonly id: string;
        readonly contentHash: string;
        readonly creatorInstallId: string;
        readonly generator: string;
      };
      expect(created).toMatchObject({
        id: "ko_public_revenue_dashboard",
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        generator: publicDemoAdapterCommand ? "adapter_command" : "deterministic_dashboard",
      });

      const showACommand = [
        "brain",
        "show",
        created.id,
        "--config",
        harness.installA.configPath,
      ];
      logStep("5. Show local dashboard KO with provenance", [formatDemoCommand("A", showACommand)]);
      const showA = await harness.runCli("A", showACommand);
      expectSuccessfulCommand(showA);
      expect(showA.stdout).toContain("Dashboard: Acme Q2 Revenue Dashboard");
      expect(showA.stdout).toContain("Input: acme-q2-revenue.csv");
      expect(showA.stdout).toContain("Signature: verified");
      expect(showA.stdout).toContain(
        publicDemoAdapterCommand ? "Generator: adapter_command" : "Generator: deterministic_dashboard",
      );
      if (publicDemoAdapterCommand) {
        expect(showA.stdout).toContain("Adapter output: Fake adapter summary:");
      }

      const shareCommand = [
        "share",
        created.id,
        "--config",
        harness.installA.configPath,
        "--with-contact",
        "meera",
        "--revocation-url",
        `http://127.0.0.1:${harness.installA.serverPort}/api/federation/revocations`,
        "--expires",
        "30d",
        "--revocable",
        "--json",
      ];
      logStep("6. Share by contact name", [formatDemoCommand("A", shareCommand)]);
      const share = await harness.runCli("A", shareCommand);
      expectSuccessfulCommand(share);
      expect(parseCommandJson(share)).toMatchObject({
        koId: created.id,
        consumerInstallId: consumerIdentity.record.installId,
        delivery: {
          status: 201,
        },
      });

      const showBeforeRevokeCommand = [
        "brain",
        "show",
        created.id,
        "--config",
        harness.installB.configPath,
        "--as-consumer",
        consumerIdentity.record.installId,
        "--json",
      ];
      logStep("7. Read on B before revoke", [formatDemoCommand("B", showBeforeRevokeCommand)]);
      const showBeforeRevoke = await harness.runCli("B", showBeforeRevokeCommand);
      expectSuccessfulCommand(showBeforeRevoke);
      expect(parseCommandJson(showBeforeRevoke)).toMatchObject({
        id: created.id,
        content: {
          kind: "dashboard",
          input: {
            fileName: "acme-q2-revenue.csv",
          },
        },
        verified: true,
      });

      const revokeCommand = [
        "revoke",
        created.id,
        "--config",
        harness.installA.configPath,
        "--reason",
        "Public demo revoke",
        "--json",
      ];
      logStep("8. Revoke on A", [formatDemoCommand("A", revokeCommand)]);
      const revoke = await harness.runCli("A", revokeCommand);
      expectSuccessfulCommand(revoke);

      const showAfterRevokeCommand = [
        "brain",
        "show",
        created.id,
        "--config",
        harness.installB.configPath,
        "--as-consumer",
        consumerIdentity.record.installId,
        "--json",
      ];
      logStep("9. Read on B after revoke", [formatDemoCommand("B", showAfterRevokeCommand)]);
      const showAfterRevoke = await harness.runCli("B", showAfterRevokeCommand);
      expectFailedCommand(showAfterRevoke, "Consent grant has been revoked");

      const receiptsACommand = [
        "receipts",
        "list",
        "--config",
        harness.installA.configPath,
        "--ko",
        created.id,
        "--json",
      ];
      const receiptsATextCommand = [
        "receipts",
        "list",
        "--config",
        harness.installA.configPath,
        "--ko",
        created.id,
      ];
      const receiptsBCommand = [
        "receipts",
        "list",
        "--config",
        harness.installB.configPath,
        "--ko",
        created.id,
        "--json",
      ];
      const receiptsBTextCommand = [
        "receipts",
        "list",
        "--config",
        harness.installB.configPath,
        "--ko",
        created.id,
      ];
      const verifyReceiptsACommand = [
        "receipts",
        "verify",
        "--config",
        harness.installA.configPath,
        "--ko",
        created.id,
      ];
      const verifyReceiptsBCommand = [
        "receipts",
        "verify",
        "--config",
        harness.installB.configPath,
        "--ko",
        created.id,
      ];
      logStep("10. Show receipts on both installs", [
        formatDemoCommand("A", receiptsATextCommand),
        formatDemoCommand("B", receiptsBTextCommand),
        formatDemoCommand("A", verifyReceiptsACommand),
        formatDemoCommand("B", verifyReceiptsBCommand),
      ]);
      const receiptsA = await harness.runCli("A", receiptsACommand);
      const receiptsB = await harness.runCli("B", receiptsBCommand);
      const receiptsAText = await harness.runCli("A", receiptsATextCommand);
      const receiptsBText = await harness.runCli("B", receiptsBTextCommand);
      const verifyReceiptsA = await harness.runCli("A", verifyReceiptsACommand);
      const verifyReceiptsB = await harness.runCli("B", verifyReceiptsBCommand);
      expectSuccessfulCommand(receiptsA);
      expectSuccessfulCommand(receiptsB);
      expectSuccessfulCommand(receiptsAText);
      expectSuccessfulCommand(receiptsBText);
      expectSuccessfulCommand(verifyReceiptsA);
      expectSuccessfulCommand(verifyReceiptsB);
      const eventsA = receiptEvents(receiptsA);
      const eventsB = receiptEvents(receiptsB);
      expect(eventsA).toEqual(expect.arrayContaining(["create", "sign", "share", "revoke"]));
      expect(eventsB).toEqual(expect.arrayContaining(["receive", "store", "read", "deny"]));
      expect(receiptsAText.stdout).toContain("Federation receipts:");
      expect(receiptsAText.stdout).toContain("By event:");
      expect(receiptsAText.stdout).toContain("share:");
      expect(receiptsBText.stdout).toContain("deny:");
      expect(verifyReceiptsA.stdout).toContain("Receipt chain valid.");
      expect(verifyReceiptsB.stdout).toContain("Receipt chain valid.");

      const durationMs = Math.round(performance.now() - startedAt);
      expect(durationMs).toBeLessThan(4 * 60 * 1000);
      console.log([
        "",
        "StacyOS public federation demo complete",
        `KO: ${created.id}`,
        `Content hash: ${created.contentHash}`,
        `Producer install: ${created.creatorInstallId}`,
        `Consumer install: ${consumerIdentity.record.installId}`,
        `Generator: ${created.generator}`,
        "B read before revoke: allowed",
        "A revoked access",
        "B read after revoke: denied",
        `Receipts A: ${eventsA.join(", ")}`,
        `Receipts B: ${eventsB.join(", ")}`,
        "Receipt chain A: valid",
        "Receipt chain B: valid",
        "",
        "Receipt summary on A:",
        receiptsAText.stdout.trim(),
        "",
        "Receipt summary on B:",
        receiptsBText.stdout.trim(),
        `Total runtime: ${(durationMs / 1000).toFixed(2)}s`,
      ].join("\n"));
    } finally {
      await harness.stop();
    }
  }, 240_000);
});

function expectSuccessfulCommand(result: HarnessCommandResult): void {
  if (result.exitCode !== 0) {
    throw new Error(formatCommandError("Expected command to succeed", result));
  }
}

function expectFailedCommand(result: HarnessCommandResult, expectedMessage: string): void {
  if (result.exitCode === 0) {
    throw new Error(formatCommandError("Expected command to fail", result));
  }
  expect(`${result.stdout}\n${result.stderr}`).toContain(expectedMessage);
}

function parseCommandJson(result: HarnessCommandResult): unknown {
  const trimmed = result.stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonStart = trimmed.lastIndexOf("\n{");
    if (jsonStart >= 0) return JSON.parse(trimmed.slice(jsonStart + 1));
    throw new Error(formatCommandError("Expected command stdout to contain JSON", result));
  }
}

function receiptEvents(result: HarnessCommandResult): string[] {
  const parsed = parseCommandJson(result) as { readonly receipts?: readonly { readonly eventType?: string }[] };
  return (parsed.receipts ?? []).map((receipt) => receipt.eventType ?? "");
}

function formatCommandError(message: string, result: HarnessCommandResult): string {
  return [
    `${message}: ${result.command.join(" ")}`,
    `exitCode: ${result.exitCode}`,
    `stdout:\n${result.stdout.trim() || "(empty)"}`,
    `stderr:\n${result.stderr.trim() || "(empty)"}`,
  ].join("\n");
}

function logStep(title: string, lines: readonly string[]): void {
  console.log(["", `== ${title} ==`, ...lines].join("\n"));
}

function formatDemoCommand(install: "A" | "B", args: readonly string[]): string {
  return `$ stacy (${install}) ${args.map(quoteShellArg).join(" ")}`;
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `"${value.replaceAll("\"", "\\\"")}"`;
}

function parseAdapterArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new Error("STACY_PUBLIC_DEMO_ADAPTER_ARGS must be a JSON array of strings.");
  }
  return parsed;
}
