import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import type { FederationInstallDescriptor } from "../../src/index.js";

export interface HarnessCommandResult {
  readonly install: "A" | "B";
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface HarnessStartedServer {
  readonly install: "A" | "B";
  readonly url: string;
  readonly pid: number | undefined;
  stdout(): string;
  stderr(): string;
  stop(): Promise<void>;
}

export interface TwoInstallHarness {
  readonly rootDir: string;
  readonly installA: FederationInstallDescriptor;
  readonly installB: FederationInstallDescriptor;
  prepare(): Promise<void>;
  readConfig(install: "A" | "B"): Promise<Record<string, unknown>>;
  runCli(install: "A" | "B", args: readonly string[]): Promise<HarnessCommandResult>;
  startServer(install: "A" | "B", options?: HarnessHealthOptions): Promise<HarnessStartedServer>;
  waitForHealth(install: "A" | "B", options?: HarnessHealthOptions): Promise<void>;
  measure<T>(label: string, fn: () => Promise<T>): Promise<{ label: string; durationMs: number; result: T }>;
  stop(): Promise<void>;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const CLI_ENTRYPOINT = resolve(REPO_ROOT, "cli/src/index.ts");
const TSX_ENTRYPOINT = resolve(REPO_ROOT, "cli/node_modules/tsx/dist/cli.mjs");

export interface TwoInstallHarnessOptions {
  readonly cliCommand?: readonly string[];
  readonly serverCommand?: (install: FederationInstallDescriptor) => readonly string[];
}

export interface HarnessHealthOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

export async function createTwoInstallHarness(options: TwoInstallHarnessOptions = {}): Promise<TwoInstallHarness> {
  const rootDir = await mkdtemp(join(tmpdir(), "stacy-federation-harness-"));
  const [serverPortA, serverPortB, dbPortA, dbPortB] = deterministicHarnessPorts();
  const installA = createInstallDescriptor(rootDir, "install-a", serverPortA, dbPortA);
  const installB = createInstallDescriptor(rootDir, "install-b", serverPortB, dbPortB);
  const cliCommand = options.cliCommand ?? ["node", TSX_ENTRYPOINT, CLI_ENTRYPOINT];
  const serverCommand = options.serverCommand ?? defaultServerCommand;
  const startedServers = new Map<"A" | "B", HarnessStartedServer>();

  return {
    rootDir,
    installA,
    installB,
    async prepare() {
      await Promise.all([
        prepareInstall(installA),
        prepareInstall(installB),
      ]);
    },
    async readConfig(install) {
      const descriptor = install === "A" ? installA : installB;
      return JSON.parse(await readFile(descriptor.configPath, "utf-8")) as Record<string, unknown>;
    },
    async runCli(install, args) {
      const descriptor = install === "A" ? installA : installB;
      return await runHarnessCommand(install, descriptor, cliCommand, args);
    },
    async startServer(install, healthOptions) {
      const descriptor = install === "A" ? installA : installB;
      const started = await startHarnessServer(install, descriptor, serverCommand(descriptor));
      startedServers.set(install, started);
      try {
        await waitForInstallHealth(descriptor, healthOptions);
      } catch (err) {
        startedServers.delete(install);
        await started.stop();
        throw new Error(formatServerStartupFailure(descriptor, started, err));
      }
      return started;
    },
    async waitForHealth(install, options) {
      const descriptor = install === "A" ? installA : installB;
      await waitForInstallHealth(descriptor, options);
    },
    async measure(label, fn) {
      const startedAt = performance.now();
      const result = await fn();
      return {
        label,
        durationMs: Math.round(performance.now() - startedAt),
        result,
      };
    },
    async stop() {
      await Promise.all([...startedServers.values()].map((server) => server.stop()));
      startedServers.clear();
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

function defaultServerCommand(install: FederationInstallDescriptor): readonly string[] {
  return [
    "node",
    TSX_ENTRYPOINT,
    CLI_ENTRYPOINT,
    "run",
    "--config",
    install.configPath,
    "--no-repair",
  ];
}

function createInstallDescriptor(
  rootDir: string,
  name: string,
  serverPort: number,
  dbPort: number,
): FederationInstallDescriptor {
  const homeDir = join(rootDir, name, "home");
  const instanceId = "federation-demo";
  const instanceRoot = join(homeDir, "instances", instanceId);
  return {
    name,
    tenant: "stacy/acme",
    homeDir,
    instanceId,
    instanceRoot,
    dataDir: join(rootDir, name, "data"),
    configPath: join(instanceRoot, "config.json"),
    envPath: join(instanceRoot, ".env"),
    storageDir: join(instanceRoot, "data", "storage"),
    logDir: join(instanceRoot, "logs"),
    backupDir: join(instanceRoot, "data", "backups"),
    secretsKeyPath: join(instanceRoot, "secrets", "master.key"),
    serverPort,
    dbPort,
  };
}

async function prepareInstall(install: FederationInstallDescriptor): Promise<void> {
  await Promise.all([
    mkdir(install.dataDir, { recursive: true }),
    mkdir(install.storageDir, { recursive: true }),
    mkdir(install.logDir, { recursive: true }),
    mkdir(install.backupDir, { recursive: true }),
    mkdir(join(install.instanceRoot, "db"), { recursive: true }),
    mkdir(join(install.instanceRoot, "secrets"), { recursive: true }),
  ]);

  await Promise.all([
    writeFile(install.configPath, JSON.stringify(createConfig(install), null, 2) + "\n", { mode: 0o600 }),
    writeFile(install.envPath, `STACY_AGENT_JWT_SECRET=${install.name}-test-agent-secret\n`, { mode: 0o600 }),
    writeFile(install.secretsKeyPath, randomBytes(32).toString("base64"), { mode: 0o600 }),
  ]);
}

function createConfig(install: FederationInstallDescriptor): Record<string, unknown> {
  return {
    $meta: {
      version: 1,
      updatedAt: "2026-05-22T00:00:00.000Z",
      source: "onboard",
    },
    database: {
      mode: "embedded-postgres",
      embeddedPostgresDataDir: join(install.instanceRoot, "db"),
      embeddedPostgresPort: install.dbPort,
      backup: {
        enabled: true,
        intervalMinutes: 60,
        retentionDays: 7,
        dir: install.backupDir,
      },
    },
    logging: {
      mode: "file",
      logDir: install.logDir,
    },
    server: {
      deploymentMode: "local_trusted",
      exposure: "private",
      bind: "loopback",
      host: "127.0.0.1",
      port: install.serverPort,
      allowedHostnames: [],
      serveUi: true,
    },
    telemetry: {
      enabled: false,
    },
    auth: {
      baseUrlMode: "auto",
      disableSignUp: false,
    },
    storage: {
      provider: "local_disk",
      localDisk: {
        baseDir: install.storageDir,
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
        keyFilePath: install.secretsKeyPath,
      },
    },
  };
}

async function runHarnessCommand(
  install: "A" | "B",
  descriptor: FederationInstallDescriptor,
  cliCommand: readonly string[],
  args: readonly string[],
): Promise<HarnessCommandResult> {
  const startedAt = performance.now();
  const command = [...cliCommand, ...args];
  const child = spawn(command[0]!, command.slice(1), {
    cwd: REPO_ROOT,
    env: buildInstallEnv(descriptor),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf-8");
  child.stderr?.setEncoding("utf-8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", resolveExit);
  });

  return {
    install,
    command,
    exitCode,
    stdout,
    stderr,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

async function startHarnessServer(
  install: "A" | "B",
  descriptor: FederationInstallDescriptor,
  command: readonly string[],
): Promise<HarnessStartedServer> {
  const child = spawn(command[0]!, command.slice(1), {
    cwd: REPO_ROOT,
    env: buildInstallEnv(descriptor),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf-8");
  child.stderr?.setEncoding("utf-8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  return {
    install,
    url: installHealthUrl(descriptor),
    pid: child.pid,
    stdout: () => stdout,
    stderr: () => stderr,
    stop: async () => {
      await stopChild(child);
    },
  };
}

async function waitForInstallHealth(
  install: FederationInstallDescriptor,
  options: HarnessHealthOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      const response = await fetch(installHealthUrl(install));
      if (response.ok) {
        const body = await response.json().catch(() => null) as { status?: unknown } | null;
        if (body?.status === "ok") return;
      }
    } catch (err) {
      lastError = err;
    }
    await delay(intervalMs);
  }

  throw new Error(
    `Timed out waiting for ${install.name} health at ${installHealthUrl(install)}${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }`,
  );
}

function installHealthUrl(install: FederationInstallDescriptor): string {
  return `http://127.0.0.1:${install.serverPort}/api/health`;
}

function formatServerStartupFailure(
  install: FederationInstallDescriptor,
  server: HarnessStartedServer,
  err: unknown,
): string {
  const reason = err instanceof Error ? err.message : String(err);
  return [
    `Failed to start ${install.name}: ${reason}`,
    `health: ${server.url}`,
    `pid: ${server.pid ?? "unknown"}`,
    `stdout:\n${server.stdout().trim() || "(empty)"}`,
    `stderr:\n${server.stderr().trim() || "(empty)"}`,
  ].join("\n");
}

function buildInstallEnv(descriptor: FederationInstallDescriptor): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STACY_HOME: descriptor.homeDir,
    STACY_INSTANCE_ID: descriptor.instanceId,
    STACY_CONFIG: descriptor.configPath,
    STACY_CONTEXT: join(descriptor.homeDir, "context.json"),
    STACY_TELEMETRY_DISABLED: "1",
    STACY_MIGRATION_AUTO_APPLY: "true",
    STACY_MIGRATION_PROMPT: "never",
    STACY_HARNESS_INSTALL: descriptor.name,
    STACY_HARNESS_HEALTH_PORT: String(descriptor.serverPort),
  };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  let closed = false;
  const closedPromise = new Promise<void>((resolveClosed) => {
    child.once("close", () => {
      closed = true;
      resolveClosed();
    });
  });
  child.kill("SIGTERM");
  await Promise.race([
    closedPromise,
    delay(2_000).then(() => {
      if (!closed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

function deterministicHarnessPorts(): [number, number, number, number] {
  const base = 41_000 + (process.pid % 1_000) * 10;
  return [base + 1, base + 2, base + 3, base + 4];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
