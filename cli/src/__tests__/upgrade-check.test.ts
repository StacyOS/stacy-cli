import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPostgresDataDirectory, inspectMigrations } from "@arpanstacy/stacy-db";
import { upgradeCheckCommand } from "../commands/upgrade-check.js";
import { writeConfig } from "../config/store.js";
import type { StacyConfig } from "../config/schema.js";

vi.mock("@arpanstacy/stacy-db", () => ({
  getPostgresDataDirectory: vi.fn(),
  inspectMigrations: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

function createConfigFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stacy-upgrade-check-"));
  const runtimeRoot = path.join(root, "runtime");
  const configPath = path.join(root, ".stacy", "config.json");
  const backupDir = path.join(runtimeRoot, "backups");
  const config: StacyConfig = {
    $meta: {
      version: 1,
      updatedAt: "2026-04-30T00:00:00.000Z",
      source: "configure",
    },
    database: {
      mode: "embedded-postgres",
      embeddedPostgresDataDir: path.join(runtimeRoot, "db"),
      embeddedPostgresPort: 55434,
      backup: {
        enabled: true,
        intervalMinutes: 60,
        retentionDays: 30,
        dir: backupDir,
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
      port: 3197,
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

  writeConfig(config, configPath);
  fs.mkdirSync(backupDir, { recursive: true });
  return { configPath, backupDir };
}

describe("upgradeCheckCommand", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DATABASE_URL;
    vi.mocked(getPostgresDataDirectory).mockReset();
    vi.mocked(inspectMigrations).mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("passes when migrations are current and a fresh backup exists", async () => {
    const fixture = createConfigFixture();
    const backupFile = path.join(fixture.backupDir, "stacy-20260430-030000.sql.gz");
    fs.writeFileSync(backupFile, "-- backup\n");
    vi.mocked(getPostgresDataDirectory).mockResolvedValue("/tmp/postgres-data");
    vi.mocked(inspectMigrations).mockResolvedValue({
      status: "upToDate",
      tableCount: 42,
      availableMigrations: ["0001_init.sql"],
      appliedMigrations: ["0001_init.sql"],
    });

    const result = await upgradeCheckCommand({
      config: fixture.configPath,
      maxBackupAgeHours: 24,
      json: true,
    });

    expect(result.status).toBe("pass");
    expect(result.backup.latestFile).toBe(backupFile);
    expect(result.migrations.pendingMigrations).toEqual([]);
  });

  it("warns when migrations are pending and no backup exists", async () => {
    const fixture = createConfigFixture();
    vi.mocked(getPostgresDataDirectory).mockResolvedValue(null);
    vi.mocked(inspectMigrations).mockResolvedValue({
      status: "needsMigrations",
      tableCount: 42,
      availableMigrations: ["0001_init.sql", "0002_next.sql"],
      appliedMigrations: ["0001_init.sql"],
      pendingMigrations: ["0002_next.sql"],
      reason: "pending-migrations",
    });

    const result = await upgradeCheckCommand({
      config: fixture.configPath,
      maxBackupAgeHours: 24,
      json: true,
    });

    expect(result.status).toBe("warn");
    expect(result.warnings).toEqual([
      "Pending migrations: 0002_next.sql",
      "No database backup file was found in the configured backup directory.",
    ]);
  });
});
