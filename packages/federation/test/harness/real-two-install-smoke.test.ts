import { describe, expect, it } from "vitest";
import { loadInstallIdentity } from "../../src/identity/install-identity.js";
import { resolveFederationIdentityPath } from "../../src/identity/paths.js";
import { createTwoInstallHarness } from "./two-install-harness.js";
import type { HarnessCommandResult } from "./two-install-harness.js";

const runRealServerSmoke = process.env.STACY_FEDERATION_REAL_SERVER_SMOKE === "1";

describe.skipIf(!runRealServerSmoke)("real two-install Stacy lifecycle smoke", () => {
  it("starts both isolated Stacy installs and reaches /api/health", async () => {
    const harness = await createTwoInstallHarness();
    try {
      await harness.prepare();

      const serverA = await harness.startServer("A", { timeoutMs: 60_000, intervalMs: 500 });
      const serverB = await harness.startServer("B", { timeoutMs: 60_000, intervalMs: 500 });

      expect(serverA.url).toContain(String(harness.installA.serverPort));
      expect(serverB.url).toContain(String(harness.installB.serverPort));
      expect(serverA.pid).not.toBe(serverB.pid);
    } finally {
      await harness.stop();
    }
  }, 130_000);

  it("creates on A, federates through B server, and reads on B with consent", async () => {
    const harness = await createTwoInstallHarness();
    try {
      await harness.prepare();
      await harness.startServer("A", { timeoutMs: 60_000, intervalMs: 500 });
      await harness.startServer("B", { timeoutMs: 60_000, intervalMs: 500 });

      const createA = await harness.runCli("A", [
        "brain",
        "create",
        "--config",
        harness.installA.configPath,
        "--content-json",
        JSON.stringify({ title: "Server federated", widgets: [{ kind: "metric", label: "Reads", value: 1 }] }),
        "--ko-id",
        "ko_server_federated",
        "--json",
      ]);
      expectSuccessfulCommand(createA);

      const createBIdentity = await harness.runCli("B", [
        "brain",
        "create",
        "--config",
        harness.installB.configPath,
        "--content-json",
        JSON.stringify({ title: "Consumer identity seed" }),
        "--ko-id",
        "ko_consumer_identity_seed",
        "--json",
      ]);
      expectSuccessfulCommand(createBIdentity);
      const consumerIdentity = await loadInstallIdentity(resolveFederationIdentityPath(harness.installB.instanceRoot));

      const share = await harness.runCli("A", [
        "share",
        "ko_server_federated",
        "--config",
        harness.installA.configPath,
        "--with",
        consumerIdentity.record.installId,
        "--to",
        `http://127.0.0.1:${harness.installB.serverPort}/api/federation`,
        "--revocation-url",
        `http://127.0.0.1:${harness.installA.serverPort}/api/federation/revocations`,
        "--expires",
        "30d",
        "--revocable",
        "--json",
      ]);
      expectSuccessfulCommand(share);
      expect(parseCommandJson(share)).toMatchObject({
        koId: "ko_server_federated",
        delivery: {
          endpointUrl: `http://127.0.0.1:${harness.installB.serverPort}/api/federation`,
          status: 201,
        },
      });

      const showB = await harness.runCli("B", [
        "brain",
        "show",
        "ko_server_federated",
        "--config",
        harness.installB.configPath,
        "--as-consumer",
        consumerIdentity.record.installId,
        "--json",
      ]);
      expectSuccessfulCommand(showB);
      expect(parseCommandJson(showB)).toMatchObject({
        id: "ko_server_federated",
        content: {
          title: "Server federated",
        },
        provenance: {
          source: "federated",
        },
        verified: true,
      });
    } finally {
      await harness.stop();
    }
  }, 180_000);

  it("denies B's read through CLI when the delivered grant is expired", async () => {
    const harness = await createTwoInstallHarness();
    try {
      await harness.prepare();
      await harness.startServer("A", { timeoutMs: 60_000, intervalMs: 500 });
      await harness.startServer("B", { timeoutMs: 60_000, intervalMs: 500 });

      expectSuccessfulCommand(await harness.runCli("A", [
        "brain",
        "create",
        "--config",
        harness.installA.configPath,
        "--content-json",
        JSON.stringify({ title: "Expired grant content" }),
        "--ko-id",
        "ko_server_expired_grant",
        "--json",
      ]));

      expectSuccessfulCommand(await harness.runCli("B", [
        "brain",
        "create",
        "--config",
        harness.installB.configPath,
        "--content-json",
        JSON.stringify({ title: "Consumer identity seed" }),
        "--ko-id",
        "ko_expired_consumer_identity_seed",
        "--json",
      ]));
      const consumerIdentity = await loadInstallIdentity(resolveFederationIdentityPath(harness.installB.instanceRoot));

      const share = await harness.runCli("A", [
        "share",
        "ko_server_expired_grant",
        "--config",
        harness.installA.configPath,
        "--with",
        consumerIdentity.record.installId,
        "--to",
        `http://127.0.0.1:${harness.installB.serverPort}/api/federation`,
        "--revocation-url",
        `http://127.0.0.1:${harness.installA.serverPort}/api/federation/revocations`,
        "--expires",
        "0m",
        "--revocable",
        "--json",
      ]);
      expectSuccessfulCommand(share);

      const showB = await harness.runCli("B", [
        "brain",
        "show",
        "ko_server_expired_grant",
        "--config",
        harness.installB.configPath,
        "--as-consumer",
        consumerIdentity.record.installId,
        "--json",
      ]);
      expectFailedCommand(showB, "Consent grant is expired");
    } finally {
      await harness.stop();
    }
  }, 180_000);

  it("denies B's next read after A revokes without pushing to B", async () => {
    const startedAt = performance.now();
    const harness = await createTwoInstallHarness();
    try {
      await harness.prepare();
      await harness.startServer("A", { timeoutMs: 60_000, intervalMs: 500 });
      await harness.startServer("B", { timeoutMs: 60_000, intervalMs: 500 });

      expectSuccessfulCommand(await harness.runCli("A", [
        "brain",
        "create",
        "--config",
        harness.installA.configPath,
        "--content-json",
        JSON.stringify({ title: "Revocable federated content" }),
        "--ko-id",
        "ko_server_revoke",
        "--json",
      ]));

      expectSuccessfulCommand(await harness.runCli("B", [
        "brain",
        "create",
        "--config",
        harness.installB.configPath,
        "--content-json",
        JSON.stringify({ title: "Consumer identity seed" }),
        "--ko-id",
        "ko_revoke_consumer_identity_seed",
        "--json",
      ]));
      const consumerIdentity = await loadInstallIdentity(resolveFederationIdentityPath(harness.installB.instanceRoot));

      expectSuccessfulCommand(await harness.runCli("A", [
        "share",
        "ko_server_revoke",
        "--config",
        harness.installA.configPath,
        "--with",
        consumerIdentity.record.installId,
        "--to",
        `http://127.0.0.1:${harness.installB.serverPort}/api/federation`,
        "--revocation-url",
        `http://127.0.0.1:${harness.installA.serverPort}/api/federation/revocations`,
        "--expires",
        "30d",
        "--revocable",
        "--json",
      ]));

      const showBeforeRevoke = await harness.runCli("B", [
        "brain",
        "show",
        "ko_server_revoke",
        "--config",
        harness.installB.configPath,
        "--as-consumer",
        consumerIdentity.record.installId,
        "--json",
      ]);
      expectSuccessfulCommand(showBeforeRevoke);

      expectSuccessfulCommand(await harness.runCli("A", [
        "revoke",
        "ko_server_revoke",
        "--config",
        harness.installA.configPath,
        "--reason",
        "Access no longer permitted",
        "--json",
      ]));

      const showAfterRevoke = await harness.runCli("B", [
        "brain",
        "show",
        "ko_server_revoke",
        "--config",
        harness.installB.configPath,
        "--as-consumer",
        consumerIdentity.record.installId,
        "--json",
      ]);
      expectFailedCommand(showAfterRevoke, "Consent grant has been revoked");
      expect(Math.round(performance.now() - startedAt)).toBeLessThan(4 * 60 * 1000);
    } finally {
      await harness.stop();
    }
  }, 180_000);
});

function expectSuccessfulCommand(result: HarnessCommandResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `Expected command to succeed: ${result.command.join(" ")}`,
        `exitCode: ${result.exitCode}`,
        `stdout:\n${result.stdout.trim() || "(empty)"}`,
        `stderr:\n${result.stderr.trim() || "(empty)"}`,
      ].join("\n"),
    );
  }
}

function expectFailedCommand(result: HarnessCommandResult, expectedMessage: string): void {
  if (result.exitCode === 0) {
    throw new Error(
      [
        `Expected command to fail: ${result.command.join(" ")}`,
        `stdout:\n${result.stdout.trim() || "(empty)"}`,
        `stderr:\n${result.stderr.trim() || "(empty)"}`,
      ].join("\n"),
    );
  }

  expect(`${result.stdout}\n${result.stderr}`).toContain(expectedMessage);
}

function parseCommandJson(result: HarnessCommandResult): unknown {
  const trimmed = result.stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonStart = trimmed.lastIndexOf("\n{");
    if (jsonStart >= 0) {
      return JSON.parse(trimmed.slice(jsonStart + 1));
    }
    throw new Error(
      [
        `Expected command stdout to contain JSON: ${result.command.join(" ")}`,
        `stdout:\n${trimmed || "(empty)"}`,
        `stderr:\n${result.stderr.trim() || "(empty)"}`,
      ].join("\n"),
    );
  }
}
