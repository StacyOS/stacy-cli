import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  runChildProcess,
  ensureCommandResolvable,
  resolveCommandForLogs,
  prepareWorkspaceForSshExecution,
  restoreWorkspaceFromSshExecution,
  syncDirectoryToSsh,
} = vi.hoisted(() => ({
  runChildProcess: vi.fn(async () => ({
    exitCode: 1 as number | null,
    signal: null as string | null,
    timedOut: false,
    stdout: "",
    stderr: "remote failure",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "/usr/bin/codex"),
  prepareWorkspaceForSshExecution: vi.fn(async () => undefined),
  restoreWorkspaceFromSshExecution: vi.fn(async () => undefined),
  syncDirectoryToSsh: vi.fn(async () => undefined),
}));

vi.mock("@arpanstacy/stacy-adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@arpanstacy/stacy-adapter-utils/server-utils")>(
    "@arpanstacy/stacy-adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureCommandResolvable,
    resolveCommandForLogs,
    runChildProcess,
  };
});

vi.mock("@arpanstacy/stacy-adapter-utils/ssh", async () => {
  const actual = await vi.importActual<typeof import("@arpanstacy/stacy-adapter-utils/ssh")>(
    "@arpanstacy/stacy-adapter-utils/ssh",
  );
  return {
    ...actual,
    prepareWorkspaceForSshExecution,
    restoreWorkspaceFromSshExecution,
    syncDirectoryToSsh,
  };
});

import { execute } from "./execute.js";

describe("codex remote execution", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("prepares the workspace, syncs CODEX_HOME, and restores workspace changes for remote SSH execution", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-codex-remote-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const codexHomeDir = path.join(rootDir, "codex-home");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(codexHomeDir, { recursive: true });
    await writeFile(path.join(rootDir, "instructions.md"), "Use the remote workspace.\n", "utf8");
    await writeFile(path.join(codexHomeDir, "auth.json"), "{}", "utf8");

    await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CodexCoder",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "codex",
        env: {
          CODEX_HOME: codexHomeDir,
        },
      },
      context: {
        stacyWorkspace: {
          cwd: workspaceDir,
          source: "project_primary",
        },
      },
      executionTransport: {
        remoteExecution: {
          host: "127.0.0.1",
          port: 2222,
          username: "fixture",
          remoteWorkspacePath: "/remote/workspace",
          remoteCwd: "/remote/workspace",
          privateKey: "PRIVATE KEY",
          knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
          strictHostKeyChecking: true,
        },
      },
      onLog: async () => {},
    });

    expect(prepareWorkspaceForSshExecution).toHaveBeenCalledTimes(1);
    expect(prepareWorkspaceForSshExecution).toHaveBeenCalledWith(expect.objectContaining({
      localDir: workspaceDir,
      remoteDir: "/remote/workspace",
    }));
    expect(syncDirectoryToSsh).toHaveBeenCalledTimes(1);
    expect(syncDirectoryToSsh).toHaveBeenCalledWith(expect.objectContaining({
      localDir: codexHomeDir,
      remoteDir: "/remote/workspace/.stacy-runtime/codex/home",
      followSymlinks: true,
    }));

    expect(runChildProcess).toHaveBeenCalledTimes(1);
    const call = runChildProcess.mock.calls[0] as unknown as
      | [string, string, string[], { env: Record<string, string>; remoteExecution?: { remoteCwd: string } | null }]
      | undefined;
    expect(call?.[3].env.CODEX_HOME).toBe("/remote/workspace/.stacy-runtime/codex/home");
    expect(call?.[3].remoteExecution?.remoteCwd).toBe("/remote/workspace");
    expect(restoreWorkspaceFromSshExecution).toHaveBeenCalledTimes(1);
    expect(restoreWorkspaceFromSshExecution).toHaveBeenCalledWith(expect.objectContaining({
      localDir: workspaceDir,
      remoteDir: "/remote/workspace",
    }));
  });

  it("does not resume saved Codex sessions for remote SSH execution without a matching remote identity", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-codex-remote-resume-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const codexHomeDir = path.join(rootDir, "codex-home");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(codexHomeDir, { recursive: true });
    await writeFile(path.join(codexHomeDir, "auth.json"), "{}", "utf8");

    await execute({
      runId: "run-ssh-no-resume",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CodexCoder",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: "session-123",
        sessionParams: {
          sessionId: "session-123",
          cwd: "/remote/workspace",
        },
        sessionDisplayId: "session-123",
        taskKey: null,
      },
      config: {
        command: "codex",
        env: {
          CODEX_HOME: codexHomeDir,
        },
      },
      context: {
        stacyWorkspace: {
          cwd: workspaceDir,
          source: "project_primary",
        },
      },
      executionTransport: {
        remoteExecution: {
          host: "127.0.0.1",
          port: 2222,
          username: "fixture",
          remoteWorkspacePath: "/remote/workspace",
          remoteCwd: "/remote/workspace",
          privateKey: "PRIVATE KEY",
          knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
          strictHostKeyChecking: true,
        },
      },
      onLog: async () => {},
    });

    expect(runChildProcess).toHaveBeenCalledTimes(1);
    const call = runChildProcess.mock.calls[0] as unknown as [string, string, string[]] | undefined;
    expect(call?.[2]).toEqual([
      "exec",
      "--json",
      "-",
    ]);
  });

  it("resumes saved Codex sessions for remote SSH execution when the remote identity matches", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-codex-remote-resume-match-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const codexHomeDir = path.join(rootDir, "codex-home");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(codexHomeDir, { recursive: true });
    await writeFile(path.join(codexHomeDir, "auth.json"), "{}", "utf8");

    await execute({
      runId: "run-ssh-resume",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CodexCoder",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: "session-123",
        sessionParams: {
          sessionId: "session-123",
          cwd: "/remote/workspace",
          remoteExecution: {
            transport: "ssh",
            host: "127.0.0.1",
            port: 2222,
            username: "fixture",
            remoteCwd: "/remote/workspace",
          },
        },
        sessionDisplayId: "session-123",
        taskKey: null,
      },
      config: {
        command: "codex",
        env: {
          CODEX_HOME: codexHomeDir,
        },
      },
      context: {
        stacyWorkspace: {
          cwd: workspaceDir,
          source: "project_primary",
        },
      },
      executionTransport: {
        remoteExecution: {
          host: "127.0.0.1",
          port: 2222,
          username: "fixture",
          remoteWorkspacePath: "/remote/workspace",
          remoteCwd: "/remote/workspace",
          privateKey: "PRIVATE KEY",
          knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
          strictHostKeyChecking: true,
        },
      },
      onLog: async () => {},
    });

    expect(runChildProcess).toHaveBeenCalledTimes(1);
    const call = runChildProcess.mock.calls[0] as unknown as [string, string, string[]] | undefined;
    expect(call?.[2]).toEqual([
      "exec",
      "--json",
      "resume",
      "session-123",
      "-",
    ]);
  });

  it("uses the provider-neutral execution target contract for remote SSH execution", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-codex-target-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const codexHomeDir = path.join(rootDir, "codex-home");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(codexHomeDir, { recursive: true });
    await writeFile(path.join(codexHomeDir, "auth.json"), "{}", "utf8");

    await execute({
      runId: "run-target",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CodexCoder",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: "session-123",
        sessionParams: {
          sessionId: "session-123",
          cwd: "/remote/workspace",
          remoteExecution: {
            transport: "ssh",
            host: "127.0.0.1",
            port: 2222,
            username: "fixture",
            remoteCwd: "/remote/workspace",
          },
        },
        sessionDisplayId: "session-123",
        taskKey: null,
      },
      config: {
        command: "codex",
        env: {
          CODEX_HOME: codexHomeDir,
        },
      },
      context: {
        stacyWorkspace: {
          cwd: workspaceDir,
          source: "project_primary",
        },
      },
      executionTarget: {
        kind: "remote",
        transport: "ssh",
        remoteCwd: "/remote/workspace",
        spec: {
          host: "127.0.0.1",
          port: 2222,
          username: "fixture",
          remoteWorkspacePath: "/remote/workspace",
          remoteCwd: "/remote/workspace",
          privateKey: "PRIVATE KEY",
          knownHosts: "[127.0.0.1]:2222 ssh-ed25519 AAAA",
          strictHostKeyChecking: true,
        },
      },
      onLog: async () => {},
    });

    expect(syncDirectoryToSsh).toHaveBeenCalledTimes(1);
    expect(runChildProcess).toHaveBeenCalledTimes(1);
    const call = runChildProcess.mock.calls[0] as unknown as
      | [string, string, string[], { env: Record<string, string>; remoteExecution?: { remoteCwd: string } | null }]
      | undefined;
    expect(call?.[2]).toEqual([
      "exec",
      "--json",
      "resume",
      "session-123",
      "-",
    ]);
    expect(call?.[3].env.CODEX_HOME).toBe("/remote/workspace/.stacy-runtime/codex/home");
    expect(call?.[3].remoteExecution?.remoteCwd).toBe("/remote/workspace");
  });

  it("surfaces parsed usage, cost, session, and result metadata from the Codex CLI", async () => {
    const completedTurn = {
      type: "turn.completed",
      usage: { input_tokens: 44, cache_read_input_tokens: 11, output_tokens: 8 },
      total_cost_usd: 0.056,
    };
    runChildProcess.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: [
        JSON.stringify({ type: "thread.started", thread_id: "thread-contract" }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "Implemented the requested change." },
        }),
        JSON.stringify(completedTurn),
      ].join("\n"),
      stderr: "",
      pid: 456,
      startedAt: new Date().toISOString(),
    });

    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-codex-contract-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const codexHomeDir = path.join(rootDir, "codex-home");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(codexHomeDir, { recursive: true });

    const result = await execute({
      runId: "run-contract",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CodexCoder",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "codex",
        env: {
          CODEX_HOME: codexHomeDir,
          OPENAI_API_KEY: "sk-test",
        },
      },
      context: {
        stacyWorkspace: {
          cwd: workspaceDir,
          source: "project_primary",
        },
      },
      onLog: async () => {},
    });

    expect(result).toMatchObject({
      exitCode: 0,
      errorMessage: null,
      sessionId: "thread-contract",
      sessionDisplayId: "thread-contract",
      provider: "openai",
      billingType: "api",
      costUsd: 0.056,
      usage: {
        inputTokens: 44,
        cachedInputTokens: 11,
        outputTokens: 8,
      },
      summary: "Implemented the requested change.",
      resultJson: expect.objectContaining({
        ...completedTurn,
        total_cost_usd: 0.056,
        stderr: "",
      }),
    });
  });

  it("retries with a fresh Codex session when a saved resume session is stale", async () => {
    runChildProcess
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "Error: thread/resume failed: no rollout found for thread id stale-session",
        pid: 456,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "fresh-thread" }),
          JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: "Recovered on a fresh session." },
          }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 7, cached_input_tokens: 0, output_tokens: 3 },
          }),
        ].join("\n"),
        stderr: "",
        pid: 789,
        startedAt: new Date().toISOString(),
      });

    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-codex-stale-session-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const codexHomeDir = path.join(rootDir, "codex-home");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(codexHomeDir, { recursive: true });
    const logs: string[] = [];

    const result = await execute({
      runId: "run-stale-session",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CodexCoder",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: "stale-session",
        sessionParams: {
          sessionId: "stale-session",
          cwd: workspaceDir,
        },
        sessionDisplayId: "stale-session",
        taskKey: null,
      },
      config: {
        command: "codex",
        cwd: workspaceDir,
        env: {
          CODEX_HOME: codexHomeDir,
        },
      },
      context: {},
      onLog: async (_stream, chunk) => {
        logs.push(chunk);
      },
    });

    expect(runChildProcess).toHaveBeenCalledTimes(2);
    const firstCall = runChildProcess.mock.calls[0] as unknown as [string, string, string[]] | undefined;
    const secondCall = runChildProcess.mock.calls[1] as unknown as [string, string, string[]] | undefined;
    expect(firstCall?.[2]).toEqual(["exec", "--json", "resume", "stale-session", "-"]);
    expect(secondCall?.[2]).toEqual(["exec", "--json", "-"]);
    expect(logs.join("")).toContain('Codex resume session "stale-session" is unavailable');
    expect(result).toMatchObject({
      exitCode: 0,
      errorMessage: null,
      sessionId: "fresh-thread",
      sessionDisplayId: "fresh-thread",
      summary: "Recovered on a fresh session.",
      usage: {
        inputTokens: 7,
        cachedInputTokens: 0,
        outputTokens: 3,
      },
    });
  });

  it("uses shared failure families for Codex auth, validation, unknown-session, and timeout failures", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-codex-failure-family-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const codexHomeDir = path.join(rootDir, "codex-home");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(codexHomeDir, { recursive: true });

    const baseContext = {
      runId: "run-family",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CodexCoder",
        adapterType: "codex_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "codex",
        cwd: workspaceDir,
        env: {
          CODEX_HOME: codexHomeDir,
        },
      },
      context: {},
      onLog: async () => {},
    };

    runChildProcess.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "Please run `codex login` first.",
      pid: 456,
      startedAt: new Date().toISOString(),
    });
    await expect(execute(baseContext)).resolves.toMatchObject({
      errorCode: "codex_auth_required",
      errorFamily: "auth_required",
      resultJson: expect.objectContaining({ errorFamily: "auth_required" }),
    });

    runChildProcess.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "Invalid request_error: Unknown parameter 'foo'.",
      pid: 457,
      startedAt: new Date().toISOString(),
    });
    await expect(execute(baseContext)).resolves.toMatchObject({
      errorCode: "codex_validation",
      errorFamily: "validation",
      resultJson: expect.objectContaining({ errorFamily: "validation" }),
    });

    runChildProcess.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "unknown thread id abc",
      pid: 458,
      startedAt: new Date().toISOString(),
    });
    await expect(execute(baseContext)).resolves.toMatchObject({
      errorCode: "codex_unknown_session",
      errorFamily: "unknown_session",
      clearSession: true,
      resultJson: expect.objectContaining({ errorFamily: "unknown_session" }),
    });

    runChildProcess.mockResolvedValueOnce({
      exitCode: null as number | null,
      signal: "SIGTERM" as string | null,
      timedOut: true,
      stdout: "",
      stderr: "",
      pid: 459,
      startedAt: new Date().toISOString(),
    });
    await expect(execute(baseContext)).resolves.toMatchObject({
      errorCode: "timeout",
      errorFamily: "timeout",
    });
  });
});
