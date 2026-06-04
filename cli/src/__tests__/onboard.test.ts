import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contactsShareLinkCommand } from "@arpanstacy/stacy-federation/verbs";
import { readContact, resolveContactsPath, resolveFederationIdentityPath } from "@arpanstacy/stacy-federation";
import { onboard } from "../commands/onboard.js";
import type { StacyConfig } from "../config/schema.js";

const ORIGINAL_ENV = { ...process.env };

function createExistingConfigFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stacy-onboard-"));
  const runtimeRoot = path.join(root, "runtime");
  const configPath = path.join(root, ".stacy", "config.json");
  const config: StacyConfig = {
    $meta: {
      version: 1,
      updatedAt: "2026-03-29T00:00:00.000Z",
      source: "configure",
    },
    database: {
      mode: "embedded-postgres",
      embeddedPostgresDataDir: path.join(runtimeRoot, "db"),
      embeddedPostgresPort: 54329,
      backup: {
        enabled: true,
        intervalMinutes: 60,
        retentionDays: 30,
        dir: path.join(runtimeRoot, "backups"),
      },
    },
    logging: {
      mode: "file",
      logDir: path.join(runtimeRoot, "logs"),
    },
    server: {
      deploymentMode: "local_trusted",
      exposure: "private",
      host: "127.0.0.1",
      port: 3100,
      allowedHostnames: [],
      serveUi: true,
    },
    auth: {
      baseUrlMode: "auto",
      disableSignUp: false,
    },
    telemetry: {
      enabled: true,
    },
    storage: {
      provider: "local_disk",
      localDisk: {
        baseDir: path.join(runtimeRoot, "storage"),
      },
      s3: {
        bucket: "stacy",
        region: "us-east-1",
        prefix: "",
        forcePathStyle: false,
      },
    },
    secrets: {
      provider: "local_encrypted",
      strictMode: false,
      localEncrypted: {
        keyFilePath: path.join(runtimeRoot, "secrets", "master.key"),
      },
    },
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  return { configPath, configText: fs.readFileSync(configPath, "utf8") };
}

function createFreshConfigPath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stacy-onboard-fresh-"));
  return path.join(root, ".stacy", "config.json");
}

function writeMinimalConfig(configPath: string, port: number): void {
  const runtimeRoot = path.join(path.dirname(configPath), "runtime");
  const config: StacyConfig = {
    $meta: {
      version: 1,
      updatedAt: "2026-05-23T00:00:00.000Z",
      source: "onboard",
    },
    database: {
      mode: "embedded-postgres",
      embeddedPostgresDataDir: path.join(runtimeRoot, "db"),
      embeddedPostgresPort: port,
      backup: {
        enabled: true,
        intervalMinutes: 60,
        retentionDays: 30,
        dir: path.join(runtimeRoot, "backups"),
      },
    },
    logging: {
      mode: "file",
      logDir: path.join(runtimeRoot, "logs"),
    },
    server: {
      deploymentMode: "local_trusted",
      exposure: "private",
      host: "127.0.0.1",
      port: 3100,
      allowedHostnames: [],
      serveUi: true,
    },
    auth: {
      baseUrlMode: "auto",
      disableSignUp: false,
    },
    telemetry: {
      enabled: false,
    },
    storage: {
      provider: "local_disk",
      localDisk: {
        baseDir: path.join(runtimeRoot, "storage"),
      },
      s3: {
        bucket: "stacy",
        region: "us-east-1",
        prefix: "",
        forcePathStyle: false,
      },
    },
    secrets: {
      provider: "local_encrypted",
      strictMode: false,
      localEncrypted: {
        keyFilePath: path.join(runtimeRoot, "secrets", "master.key"),
      },
    },
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

describe("onboard", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.STACY_AGENT_JWT_SECRET;
    delete process.env.STACY_AGENT_JWT_SECRET;
    delete process.env.STACY_SECRETS_MASTER_KEY;
    delete process.env.STACY_SECRETS_MASTER_KEY;
    delete process.env.STACY_SECRETS_MASTER_KEY_FILE;
    delete process.env.STACY_SECRETS_MASTER_KEY_FILE;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("preserves an existing config when rerun without flags", async () => {
    const fixture = createExistingConfigFixture();

    await onboard({ config: fixture.configPath });

    expect(fs.readFileSync(fixture.configPath, "utf8")).toBe(fixture.configText);
    expect(fs.existsSync(`${fixture.configPath}.backup`)).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(fixture.configPath), ".env"))).toBe(true);
  });

  it("preserves an existing config when rerun with --yes", async () => {
    const fixture = createExistingConfigFixture();

    await onboard({ config: fixture.configPath, yes: true, invokedByRun: true });

    expect(fs.readFileSync(fixture.configPath, "utf8")).toBe(fixture.configText);
    expect(fs.existsSync(`${fixture.configPath}.backup`)).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(fixture.configPath), ".env"))).toBe(true);
  });

  it("keeps --yes onboarding on local trusted loopback defaults", async () => {
    const configPath = createFreshConfigPath();
    process.env.HOST = "0.0.0.0";
    process.env.STACY_BIND = "lan";

    await onboard({ config: configPath, yes: true, invokedByRun: true });

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as StacyConfig;
    expect(raw.server.deploymentMode).toBe("local_trusted");
    expect(raw.server.exposure).toBe("private");
    expect(raw.server.bind).toBe("loopback");
    expect(raw.server.host).toBe("127.0.0.1");
  });

  it("supports authenticated/private quickstart bind presets", async () => {
    const configPath = createFreshConfigPath();
    process.env.STACY_TAILNET_BIND_HOST = "100.64.0.8";

    await onboard({ config: configPath, yes: true, invokedByRun: true, bind: "tailnet" });

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as StacyConfig;
    expect(raw.server.deploymentMode).toBe("authenticated");
    expect(raw.server.exposure).toBe("private");
    expect(raw.server.bind).toBe("tailnet");
    expect(raw.server.host).toBe("100.64.0.8");
  });

  it("keeps tailnet quickstart on loopback until tailscale is available", async () => {
    const configPath = createFreshConfigPath();
    delete process.env.STACY_TAILNET_BIND_HOST;

    await onboard({ config: configPath, yes: true, invokedByRun: true, bind: "tailnet" });

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as StacyConfig;
    expect(raw.server.deploymentMode).toBe("authenticated");
    expect(raw.server.exposure).toBe("private");
    expect(raw.server.bind).toBe("tailnet");
    expect(raw.server.host).toBe("127.0.0.1");
  });

  it("ignores deployment env overrides during --yes quickstart", async () => {
    const configPath = createFreshConfigPath();
    process.env.STACY_DEPLOYMENT_MODE = "authenticated";

    await onboard({ config: configPath, yes: true, invokedByRun: true });

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as StacyConfig;
    expect(raw.server.deploymentMode).toBe("local_trusted");
    expect(raw.server.exposure).toBe("private");
    expect(raw.server.bind).toBe("loopback");
    expect(raw.server.host).toBe("127.0.0.1");
  });

  it("generates a federation install identity during onboarding", async () => {
    const configPath = createFreshConfigPath();

    await onboard({ config: configPath, yes: true, invokedByRun: true, federationDemo: true });

    const identityPath = resolveFederationIdentityPath(path.dirname(configPath));
    expect(fs.existsSync(identityPath)).toBe(true);
    const identity = JSON.parse(fs.readFileSync(identityPath, "utf8")) as { installId?: string };
    expect(identity.installId).toMatch(/^install_[a-f0-9]{32}$/);
  });

  it("can import a federation peer share link during onboarding", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stacy-onboard-federation-"));
    const configA = path.join(root, "install-a", "config.json");
    const configB = path.join(root, "install-b", "config.json");
    writeMinimalConfig(configB, 55461);
    const lines: string[] = [];
    await contactsShareLinkCommand(
      "meera",
      {
        config: configB,
        endpoint: "https://b.stacy.dev/api/federation",
        revocationUrl: "https://b.stacy.dev/api/federation/revocations",
        label: "Dr. Meera Patel / Eastside Specialty",
        json: true,
      },
      {
        stdout: { log: (line: string) => lines.push(line) },
        now: () => new Date("2030-05-23T00:00:00.000Z"),
      },
    );
    const exported = JSON.parse(lines.at(-1) ?? "{}") as { link: string };

    await onboard({
      config: configA,
      yes: true,
      invokedByRun: true,
      federationPeerLink: exported.link,
    });

    await expect(readContact(resolveContactsPath(path.dirname(configA)), "peer")).resolves.toMatchObject({
      name: "peer",
      label: "Dr. Meera Patel / Eastside Specialty",
      federationEndpointUrl: "https://b.stacy.dev/api/federation",
    });
  });
});
