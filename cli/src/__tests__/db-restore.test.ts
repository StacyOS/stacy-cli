import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDatabaseRestore } from "@arpanstacy/stacy-db";
import { dbRestoreCommand } from "../commands/db-backup.js";
import { writeConfig } from "../config/store.js";
import type { StacyConfig } from "../config/schema.js";

vi.mock("@arpanstacy/stacy-db", () => ({
  formatDatabaseBackupResult: vi.fn(),
  runDatabaseBackup: vi.fn(),
  runDatabaseRestore: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

function createConfigFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stacy-db-restore-"));
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
      embeddedPostgresPort: 55433,
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
      port: 3198,
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
  return { root, configPath, backupDir };
}

describe("dbRestoreCommand", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DATABASE_URL;
    vi.mocked(runDatabaseRestore).mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("resolves the newest configured backup during dry run without restoring", async () => {
    const fixture = createConfigFixture();
    const oldBackup = path.join(fixture.backupDir, "stacy-20260429-010000.sql.gz");
    const newestBackup = path.join(fixture.backupDir, "stacy-20260430-010000.sql.gz");
    fs.writeFileSync(oldBackup, "-- old backup\n");
    fs.writeFileSync(newestBackup, "-- newest backup\n");
    fs.utimesSync(oldBackup, new Date("2026-04-29T01:00:00.000Z"), new Date("2026-04-29T01:00:00.000Z"));
    fs.utimesSync(newestBackup, new Date("2026-04-30T01:00:00.000Z"), new Date("2026-04-30T01:00:00.000Z"));

    await dbRestoreCommand(undefined, {
      config: fixture.configPath,
      latest: true,
      dryRun: true,
      json: true,
    });

    expect(runDatabaseRestore).not.toHaveBeenCalled();
  });

  it("restores an explicit backup file when confirmed with --yes", async () => {
    const fixture = createConfigFixture();
    const backupFile = path.join(fixture.backupDir, "stacy-20260430-020000.sql.gz");
    fs.writeFileSync(backupFile, "-- backup\n");
    vi.mocked(runDatabaseRestore).mockResolvedValue(undefined);

    await dbRestoreCommand(backupFile, {
      config: fixture.configPath,
      yes: true,
    });

    expect(runDatabaseRestore).toHaveBeenCalledWith({
      connectionString: "postgres://stacy:stacy@127.0.0.1:55433/stacy",
      backupFile,
    });
  });
});
