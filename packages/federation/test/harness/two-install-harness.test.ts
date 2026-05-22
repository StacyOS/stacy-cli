import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createTwoInstallHarness } from "./two-install-harness.js";

describe("two-install federation harness skeleton", () => {
  it("creates isolated install descriptors for tenant stacy/acme", async () => {
    const harness = await createTwoInstallHarness();
    try {
      expect(harness.installA.name).toBe("install-a");
      expect(harness.installB.name).toBe("install-b");
      expect(harness.installA.tenant).toBe("stacy/acme");
      expect(harness.installB.tenant).toBe("stacy/acme");
      expect(harness.installA.dataDir).not.toBe(harness.installB.dataDir);
      expect(harness.installA.homeDir).not.toBe(harness.installB.homeDir);
      expect(harness.installA.configPath).not.toBe(harness.installB.configPath);
      expect(harness.installA.serverPort).not.toBe(harness.installB.serverPort);
      expect(harness.installA.dbPort).not.toBe(harness.installB.dbPort);
    } finally {
      await harness.stop();
    }
  });

  it("prepares Stacy-compatible config and env files for both installs", async () => {
    const harness = await createTwoInstallHarness();
    try {
      await harness.prepare();

      const configA = await harness.readConfig("A");
      const configB = await harness.readConfig("B");

      expect(configA).toMatchObject({
        database: {
          mode: "embedded-postgres",
          embeddedPostgresPort: harness.installA.dbPort,
        },
        server: {
          deploymentMode: "local_trusted",
          host: "127.0.0.1",
          port: harness.installA.serverPort,
        },
        telemetry: {
          enabled: false,
        },
      });
      expect(configB).toMatchObject({
        database: {
          mode: "embedded-postgres",
          embeddedPostgresPort: harness.installB.dbPort,
        },
        server: {
          port: harness.installB.serverPort,
        },
      });
      expect(configA).not.toEqual(configB);
    } finally {
      await harness.stop();
    }
  });

  it("runs Stacy CLI commands with the selected install environment", async () => {
    const harness = await createTwoInstallHarness({
      cliCommand: [
        process.execPath,
        "-e",
        "console.log(process.env.STACY_CONFIG); console.log(process.env.STACY_HOME);",
      ],
    });
    try {
      await harness.prepare();

      const result = await harness.runCli("A", []);

      expect(result.install).toBe("A");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(harness.installA.configPath);
      expect(result.stdout).toContain(harness.installA.homeDir);
    } finally {
      await harness.stop();
    }
  });

  it("measures demo steps for the future sub-four-minute acceptance check", async () => {
    const harness = await createTwoInstallHarness();
    try {
      const measured = await harness.measure("noop-demo-step", async () => "ok");

      expect(measured.label).toBe("noop-demo-step");
      expect(measured.result).toBe("ok");
      expect(measured.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await harness.stop();
    }
  });

  it("cleans up a started process when readiness polling fails", async () => {
    const harness = await createTwoInstallHarness({
      serverCommand: () => [process.execPath, "-e", "setInterval(() => {}, 1000);"],
    });
    try {
      await harness.prepare();

      await expect(
        harness.startServer("A", { timeoutMs: 50, intervalMs: 10 }),
      ).rejects.toThrow(`Timed out waiting for ${harness.installA.name} health`);
    } finally {
      await harness.stop();
    }
  });

  it("can run repeated isolated harness setup without leaking root directories", async () => {
    const first = await createTwoInstallHarness();
    const second = await createTwoInstallHarness();

    expect(first.rootDir).not.toBe(second.rootDir);
    await first.prepare();
    await second.prepare();

    await expect(pathExists(first.installA.configPath)).resolves.toBe(true);
    await expect(pathExists(second.installA.configPath)).resolves.toBe(true);

    await first.stop();
    await second.stop();

    await expect(pathExists(first.rootDir)).resolves.toBe(false);
    await expect(pathExists(second.rootDir)).resolves.toBe(false);
  });
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
