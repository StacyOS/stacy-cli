import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { getPostgresDataDirectory, inspectMigrations, type MigrationState } from "@paperclipai/db";
import {
  expandHomePrefix,
  resolveDefaultBackupDir,
  resolvePaperclipInstanceId,
} from "../config/home.js";
import { readConfig, resolveConfigPath } from "../config/store.js";
import { printPaperclipCliBanner } from "../utils/banner.js";
import { cliVersion } from "../version.js";

type UpgradeCheckOptions = {
  config?: string;
  maxBackupAgeHours?: number;
  json?: boolean;
  strict?: boolean;
};

type UpgradeCheckStatus = "pass" | "warn";

export type UpgradeCheckResult = {
  status: UpgradeCheckStatus;
  cliVersion: string;
  configPath: string;
  connectionSource: string;
  postgresDataDirectory: string | null;
  migrations: {
    status: MigrationState["status"];
    tableCount: number;
    availableCount: number;
    appliedCount: number;
    pendingMigrations: string[];
    reason?: string;
  };
  backup: {
    backupDir: string;
    latestFile: string | null;
    latestAgeHours: number | null;
    maxBackupAgeHours: number;
  };
  warnings: string[];
};

function resolveConnectionString(configPath?: string): { value: string; source: string } {
  const envUrl = process.env.DATABASE_URL?.trim();
  if (envUrl) return { value: envUrl, source: "DATABASE_URL" };

  const config = readConfig(configPath);
  if (config?.database.mode === "postgres" && config.database.connectionString?.trim()) {
    return { value: config.database.connectionString.trim(), source: "config.database.connectionString" };
  }

  const port = config?.database.embeddedPostgresPort ?? 54329;
  return {
    value: `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`,
    source: `embedded-postgres@${port}`,
  };
}

function resolveBackupDir(raw: string): string {
  return path.resolve(expandHomePrefix(raw.trim()));
}

function normalizeMaxBackupAgeHours(value: number | undefined): number {
  const candidate = value ?? 24;
  if (!Number.isFinite(candidate) || candidate <= 0) {
    throw new Error(`Invalid --max-backup-age-hours value '${String(value)}'. Use a positive number.`);
  }
  return candidate;
}

function findLatestBackupFile(backupDir: string): { file: string; ageHours: number } | null {
  if (!existsSync(backupDir)) return null;

  const candidates = readdirSync(backupDir)
    .filter((name) => name.endsWith(".sql") || name.endsWith(".sql.gz"))
    .map((name) => {
      const file = path.join(backupDir, name);
      return { file, stat: statSync(file) };
    })
    .filter((entry) => entry.stat.isFile())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const latest = candidates[0];
  if (!latest) return null;
  return {
    file: latest.file,
    ageHours: Math.max(0, (Date.now() - latest.stat.mtimeMs) / (60 * 60 * 1000)),
  };
}

function summarizeMigrations(state: MigrationState): UpgradeCheckResult["migrations"] {
  return {
    status: state.status,
    tableCount: state.tableCount,
    availableCount: state.availableMigrations.length,
    appliedCount: state.appliedMigrations.length,
    pendingMigrations: state.status === "needsMigrations" ? state.pendingMigrations : [],
    ...(state.status === "needsMigrations" ? { reason: state.reason } : {}),
  };
}

function formatAge(hours: number | null): string {
  if (hours === null) return "none";
  if (hours < 1) return `${Math.round(hours * 60)} minute(s)`;
  return `${hours.toFixed(1)} hour(s)`;
}

export async function upgradeCheckCommand(opts: UpgradeCheckOptions): Promise<UpgradeCheckResult> {
  printPaperclipCliBanner();
  p.intro(pc.bgCyan(pc.black(" stacy upgrade:check ")));

  const configPath = resolveConfigPath(opts.config);
  const config = readConfig(opts.config);
  const connection = resolveConnectionString(opts.config);
  const backupDir = resolveBackupDir(
    config?.database.backup.dir || resolveDefaultBackupDir(resolvePaperclipInstanceId()),
  );
  const maxBackupAgeHours = normalizeMaxBackupAgeHours(opts.maxBackupAgeHours);

  const [migrationState, postgresDataDirectory] = await Promise.all([
    inspectMigrations(connection.value),
    getPostgresDataDirectory(connection.value),
  ]);
  const latestBackup = findLatestBackupFile(backupDir);
  const migrations = summarizeMigrations(migrationState);
  const warnings: string[] = [];

  if (migrations.pendingMigrations.length > 0) {
    warnings.push(`Pending migrations: ${migrations.pendingMigrations.join(", ")}`);
  }
  if (!latestBackup) {
    warnings.push("No database backup file was found in the configured backup directory.");
  } else if (latestBackup.ageHours > maxBackupAgeHours) {
    warnings.push(
      `Latest backup is ${formatAge(latestBackup.ageHours)} old; threshold is ${maxBackupAgeHours} hour(s).`,
    );
  }

  const result: UpgradeCheckResult = {
    status: warnings.length > 0 ? "warn" : "pass",
    cliVersion,
    configPath,
    connectionSource: connection.source,
    postgresDataDirectory,
    migrations,
    backup: {
      backupDir,
      latestFile: latestBackup?.file ?? null,
      latestAgeHours: latestBackup?.ageHours ?? null,
      maxBackupAgeHours,
    },
    warnings,
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    p.log.message(pc.dim(`CLI version: ${result.cliVersion}`));
    p.log.message(pc.dim(`Config: ${result.configPath}`));
    p.log.message(pc.dim(`Connection source: ${result.connectionSource}`));
    p.log.message(pc.dim(`Postgres data dir: ${result.postgresDataDirectory ?? "unknown"}`));
    p.log.message(
      migrations.pendingMigrations.length === 0
        ? `${pc.green("✓")} Migrations: up to date (${migrations.appliedCount}/${migrations.availableCount})`
        : `${pc.yellow("!")} Migrations: ${migrations.pendingMigrations.length} pending`,
    );
    p.log.message(
      latestBackup
        ? `${
            latestBackup.ageHours <= maxBackupAgeHours ? pc.green("✓") : pc.yellow("!")
          } Latest backup: ${latestBackup.file} (${formatAge(latestBackup.ageHours)} old)`
        : `${pc.yellow("!")} Latest backup: none found`,
    );
    for (const warning of warnings) {
      p.log.warn(warning);
    }
  }

  if (opts.strict && warnings.length > 0) {
    process.exitCode = 1;
  }

  p.outro(result.status === "pass" ? pc.green("Upgrade preflight passed.") : pc.yellow("Upgrade preflight has warnings."));
  return result;
}
