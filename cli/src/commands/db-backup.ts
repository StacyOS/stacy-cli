import path from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { formatDatabaseBackupResult, runDatabaseBackup, runDatabaseRestore } from "@paperclipai/db";
import {
  expandHomePrefix,
  resolveDefaultBackupDir,
  resolvePaperclipInstanceId,
} from "../config/home.js";
import { readConfig, resolveConfigPath } from "../config/store.js";
import { printPaperclipCliBanner } from "../utils/banner.js";

type DbBackupOptions = {
  config?: string;
  dir?: string;
  retentionDays?: number;
  filenamePrefix?: string;
  json?: boolean;
};

type DbRestoreOptions = {
  config?: string;
  file?: string;
  latest?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
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

function normalizeRetentionDays(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < 1) {
    throw new Error(`Invalid retention days '${String(candidate)}'. Use a positive integer.`);
  }
  return candidate;
}

function resolveBackupDir(raw: string): string {
  return path.resolve(expandHomePrefix(raw.trim()));
}

function resolveBackupFilePath(raw: string): string {
  return path.resolve(expandHomePrefix(raw.trim()));
}

function resolveLatestBackupFile(backupDir: string): string | null {
  if (!existsSync(backupDir)) return null;

  const candidates = readdirSync(backupDir)
    .filter((name) => name.endsWith(".sql") || name.endsWith(".sql.gz"))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      return { fullPath, stat: statSync(fullPath) };
    })
    .filter((entry) => entry.stat.isFile())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  return candidates[0]?.fullPath ?? null;
}

function validateBackupFile(backupFile: string): { backupFile: string; sizeBytes: number } {
  if (!backupFile.endsWith(".sql") && !backupFile.endsWith(".sql.gz")) {
    throw new Error("Backup file must end with .sql or .sql.gz.");
  }
  if (!existsSync(backupFile)) {
    throw new Error(`Backup file does not exist: ${backupFile}`);
  }
  const stat = statSync(backupFile);
  if (!stat.isFile()) {
    throw new Error(`Backup path is not a file: ${backupFile}`);
  }
  return { backupFile, sizeBytes: stat.size };
}

export async function dbBackupCommand(opts: DbBackupOptions): Promise<void> {
  printPaperclipCliBanner();
  p.intro(pc.bgCyan(pc.black(" stacy db:backup ")));

  const configPath = resolveConfigPath(opts.config);
  const config = readConfig(opts.config);
  const connection = resolveConnectionString(opts.config);
  const defaultDir = resolveDefaultBackupDir(resolvePaperclipInstanceId());
  const configuredDir = opts.dir?.trim() || config?.database.backup.dir || defaultDir;
  const backupDir = resolveBackupDir(configuredDir);
  const retentionDays = normalizeRetentionDays(
    opts.retentionDays,
    config?.database.backup.retentionDays ?? 30,
  );
  const filenamePrefix = opts.filenamePrefix?.trim() || "stacy";

  p.log.message(pc.dim(`Config: ${configPath}`));
  p.log.message(pc.dim(`Connection source: ${connection.source}`));
  p.log.message(pc.dim(`Backup dir: ${backupDir}`));
  p.log.message(pc.dim(`Retention: ${retentionDays} day(s)`));

  const spinner = p.spinner();
  spinner.start("Creating database backup...");
  try {
    const result = await runDatabaseBackup({
      connectionString: connection.value,
      backupDir,
      retention: { dailyDays: retentionDays, weeklyWeeks: 4, monthlyMonths: 1 },
      filenamePrefix,
    });
    spinner.stop(`Backup saved: ${formatDatabaseBackupResult(result)}`);

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            backupFile: result.backupFile,
            sizeBytes: result.sizeBytes,
            prunedCount: result.prunedCount,
            backupDir,
            retentionDays,
            connectionSource: connection.source,
          },
          null,
          2,
        ),
      );
    }
    p.outro(pc.green("Backup completed."));
  } catch (err) {
    spinner.stop(pc.red("Backup failed."));
    throw err;
  }
}

export async function dbRestoreCommand(
  backupFileArg: string | undefined,
  opts: DbRestoreOptions,
): Promise<void> {
  printPaperclipCliBanner();
  p.intro(pc.bgCyan(pc.black(" stacy db:restore ")));

  if (backupFileArg && opts.latest) {
    throw new Error("Pass either a backup file path or --latest, not both.");
  }

  const configPath = resolveConfigPath(opts.config);
  const config = readConfig(opts.config);
  const connection = resolveConnectionString(opts.config);
  const defaultDir = resolveDefaultBackupDir(resolvePaperclipInstanceId());
  const configuredDir = config?.database.backup.dir || defaultDir;
  const backupDir = resolveBackupDir(configuredDir);
  const rawBackupFile =
    backupFileArg?.trim() ||
    opts.file?.trim() ||
    (opts.latest ? resolveLatestBackupFile(backupDir) : null);

  if (!rawBackupFile) {
    throw new Error("No backup file selected. Pass a backup file path or use --latest.");
  }

  const backup = validateBackupFile(resolveBackupFilePath(rawBackupFile));

  p.log.message(pc.dim(`Config: ${configPath}`));
  p.log.message(pc.dim(`Connection source: ${connection.source}`));
  p.log.message(pc.dim(`Backup file: ${backup.backupFile}`));
  p.log.message(pc.dim(`Backup size: ${backup.sizeBytes} bytes`));

  if (opts.dryRun) {
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            backupFile: backup.backupFile,
            sizeBytes: backup.sizeBytes,
            backupDir,
            connectionSource: connection.source,
            configPath,
            dryRun: true,
            restored: false,
          },
          null,
          2,
        ),
      );
    }
    p.outro(pc.green("Dry run complete. No restore was performed."));
    return;
  }

  let shouldRestore = opts.yes === true;
  if (!shouldRestore) {
    const answer = await p.confirm({
      message: "Restore this backup into the configured database now? Existing data may be overwritten.",
      initialValue: false,
    });
    if (p.isCancel(answer) || answer !== true) {
      p.outro(pc.yellow("Restore cancelled."));
      return;
    }
    shouldRestore = true;
  }

  if (!shouldRestore) return;

  const spinner = p.spinner();
  spinner.start("Restoring database backup...");
  try {
    await runDatabaseRestore({
      connectionString: connection.value,
      backupFile: backup.backupFile,
    });
    spinner.stop(`Restore applied: ${backup.backupFile}`);

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            backupFile: backup.backupFile,
            sizeBytes: backup.sizeBytes,
            backupDir,
            connectionSource: connection.source,
            configPath,
            dryRun: false,
            restored: true,
          },
          null,
          2,
        ),
      );
    }
    p.outro(pc.green("Restore completed."));
  } catch (err) {
    spinner.stop(pc.red("Restore failed."));
    throw err;
  }
}
