import { describe, expect, it } from "vitest";

import { loadInstallIdentity } from "../../src/identity/install-identity.js";
import { resolveFederationIdentityPath } from "../../src/identity/paths.js";
import { createTwoInstallHarness, type HarnessCommandResult } from "./two-install-harness.js";

const runKeyRotationSmoke =
  process.env.STACY_FEDERATION_REAL_SERVER_SMOKE === "1" &&
  process.env.STACY_FEDERATION_KEY_ROTATION_SMOKE === "1";

describe.skipIf(!runKeyRotationSmoke)("key rotation under federation smoke", () => {
  it("keeps pre-rotation KOs readable and verifies post-rotation KOs", async () => {
    const harness = await createTwoInstallHarness();
    try {
      await harness.prepare();
      await harness.startServer("A", { timeoutMs: 60_000, intervalMs: 500 });
      await harness.startServer("B", { timeoutMs: 60_000, intervalMs: 500 });

      expectSuccessfulCommand(await harness.runCli("B", [
        "brain",
        "create",
        "--config",
        harness.installB.configPath,
        "--content-json",
        JSON.stringify({ title: "Consumer identity seed" }),
        "--ko-id",
        "ko_rotation_consumer_identity_seed",
        "--json",
      ]));
      const consumerIdentity = await loadInstallIdentity(resolveFederationIdentityPath(harness.installB.instanceRoot));

      expectSuccessfulCommand(await harness.runCli("A", [
        "brain",
        "create",
        "--config",
        harness.installA.configPath,
        "--content-json",
        JSON.stringify({ title: "Pre-rotation referral" }),
        "--ko-id",
        "ko_pre_rotation",
        "--json",
      ]));

      await shareToB(harness, "ko_pre_rotation", consumerIdentity.record.installId);
      const preBeforeRotation = await showOnB(harness, "ko_pre_rotation", consumerIdentity.record.installId);
      expectSuccessfulCommand(preBeforeRotation);
      expect(parseCommandJson(preBeforeRotation)).toMatchObject({
        id: "ko_pre_rotation",
        verified: true,
        content: { title: "Pre-rotation referral" },
      });

      const rotation = await harness.runCli("A", [
        "identity",
        "rotate",
        "--config",
        harness.installA.configPath,
        "--reason",
        "key rotation smoke",
        "--json",
      ]);
      expectSuccessfulCommand(rotation);
      expect(parseCommandJson(rotation)).toMatchObject({
        oldInstallId: expect.stringMatching(/^install_/),
        newInstallId: expect.stringMatching(/^install_/),
      });

      expectSuccessfulCommand(await harness.runCli("A", [
        "brain",
        "create",
        "--config",
        harness.installA.configPath,
        "--content-json",
        JSON.stringify({ title: "Post-rotation referral" }),
        "--ko-id",
        "ko_post_rotation",
        "--json",
      ]));

      await shareToB(harness, "ko_post_rotation", consumerIdentity.record.installId);

      const preAfterRotation = await showOnB(harness, "ko_pre_rotation", consumerIdentity.record.installId);
      expectSuccessfulCommand(preAfterRotation);
      expect(parseCommandJson(preAfterRotation)).toMatchObject({
        id: "ko_pre_rotation",
        verified: true,
        content: { title: "Pre-rotation referral" },
      });

      const postAfterRotation = await showOnB(harness, "ko_post_rotation", consumerIdentity.record.installId);
      expectSuccessfulCommand(postAfterRotation);
      expect(parseCommandJson(postAfterRotation)).toMatchObject({
        id: "ko_post_rotation",
        verified: true,
        content: { title: "Post-rotation referral" },
      });
    } finally {
      await harness.stop();
    }
  }, 240_000);
});

async function shareToB(
  harness: Awaited<ReturnType<typeof createTwoInstallHarness>>,
  koId: string,
  consumerInstallId: string,
): Promise<void> {
  const share = await harness.runCli("A", [
    "share",
    koId,
    "--config",
    harness.installA.configPath,
    "--with",
    consumerInstallId,
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
}

async function showOnB(
  harness: Awaited<ReturnType<typeof createTwoInstallHarness>>,
  koId: string,
  consumerInstallId: string,
): Promise<HarnessCommandResult> {
  return await harness.runCli("B", [
    "brain",
    "show",
    koId,
    "--config",
    harness.installB.configPath,
    "--as-consumer",
    consumerInstallId,
    "--json",
  ]);
}

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

function parseCommandJson(result: HarnessCommandResult): unknown {
  const trimmed = result.stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonStart = trimmed.lastIndexOf("\n{");
    if (jsonStart >= 0) {
      return JSON.parse(trimmed.slice(jsonStart + 1));
    }
    throw new Error(`Expected command stdout to contain JSON: ${result.command.join(" ")}`);
  }
}
