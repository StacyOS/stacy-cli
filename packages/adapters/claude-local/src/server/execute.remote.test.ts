import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  runChildProcess,
  ensureCommandResolvable,
  resolveCommandForLogs,
  prepareWorkspaceForSshExecution,
  restoreWorkspaceFromSshExecution,
  syncDirectoryToSsh,
} = vi.hoisted(() => ({
  runChildProcess: vi.fn(async () => ({
    exitCode: 0 as number | null,
    signal: null as string | null,
    timedOut: false,
    stdout: [
      JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session-1", model: "claude-sonnet" }),
      JSON.stringify({ type: "assistant", session_id: "claude-session-1", message: { content: [{ type: "text", text: "hello" }] } }),
      JSON.stringify({ type: "result", session_id: "claude-session-1", result: "hello", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }),
    ].join("\n"),
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "ssh://fixture@127.0.0.1:2222/remote/workspace :: claude"),
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

const ORIGINAL_STACY_HOME = process.env.STACY_HOME;
const ORIGINAL_STACY_INSTANCE_ID = process.env.STACY_INSTANCE_ID;

describe("claude remote execution", () => {
  const cleanupDirs: string[] = [];

  beforeEach(async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "stacy-claude-test-home-"));
    cleanupDirs.push(homeDir);
    process.env.STACY_HOME = homeDir;
    process.env.STACY_INSTANCE_ID = "adapter-contract-test";
  });

  afterEach(async () => {
    vi.clearAllMocks();
    if (ORIGINAL_STACY_HOME === undefined) {
      delete process.env.STACY_HOME;
    } else {
      process.env.STACY_HOME = ORIGINAL_STACY_HOME;
    }
    if (ORIGINAL_STACY_INSTANCE_ID === undefined) {
      delete process.env.STACY_INSTANCE_ID;
    } else {
      process.env.STACY_INSTANCE_ID = ORIGINAL_STACY_INSTANCE_ID;
    }
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("prepares the workspace, syncs Claude runtime assets, and restores workspace changes for remote SSH execution", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-claude-remote-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    const instructionsPath = path.join(rootDir, "instructions.md");
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(instructionsPath, "Use the remote workspace.\n", "utf8");

    await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Claude Coder",
        adapterType: "claude_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "claude",
        instructionsFilePath: instructionsPath,
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
          stacyApiUrl: "http://198.51.100.10:3102",
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
      remoteDir: "/remote/workspace/.stacy-runtime/claude/skills",
      followSymlinks: true,
    }));
    expect(runChildProcess).toHaveBeenCalledTimes(1);
    const call = runChildProcess.mock.calls[0] as unknown as
      | [string, string, string[], { env: Record<string, string>; remoteExecution?: { remoteCwd: string } | null }]
      | undefined;
    expect(call?.[2]).toContain("--append-system-prompt-file");
    expect(call?.[2]).toContain("/remote/workspace/.stacy-runtime/claude/skills/agent-instructions.md");
    expect(call?.[2]).toContain("--add-dir");
    expect(call?.[2]).toContain("/remote/workspace/.stacy-runtime/claude/skills");
    expect(call?.[3].env.STACY_API_URL).toBe("http://198.51.100.10:3102");
    expect(call?.[3].remoteExecution?.remoteCwd).toBe("/remote/workspace");
    expect(restoreWorkspaceFromSshExecution).toHaveBeenCalledTimes(1);
    expect(restoreWorkspaceFromSshExecution).toHaveBeenCalledWith(expect.objectContaining({
      localDir: workspaceDir,
      remoteDir: "/remote/workspace",
    }));
  });

  it("does not resume saved Claude sessions for remote SSH execution without a matching remote identity", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-claude-remote-resume-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    await execute({
      runId: "run-ssh-no-resume",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Claude Coder",
        adapterType: "claude_local",
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
        command: "claude",
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
    expect(call?.[2]).not.toContain("--resume");
  });

  it("resumes saved Claude sessions for remote SSH execution when the remote identity matches", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-claude-remote-resume-match-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    await execute({
      runId: "run-ssh-resume",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Claude Coder",
        adapterType: "claude_local",
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
        command: "claude",
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
    expect(call?.[2]).toContain("--resume");
    expect(call?.[2]).toContain("session-123");
  });

  it("surfaces parsed usage, cost, session, and result metadata from the Claude CLI", async () => {
    const resultEvent = {
      type: "result",
      session_id: "claude-contract",
      model: "claude-sonnet-4-5",
      result: "Implemented the requested change.",
      total_cost_usd: 0.067,
      usage: {
        input_tokens: 52,
        cache_read_input_tokens: 13,
        output_tokens: 9,
      },
    };
    runChildProcess.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: [
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "claude-contract",
          model: "claude-sonnet-4-5",
        }),
        JSON.stringify({
          type: "assistant",
          session_id: "claude-contract",
          message: { content: [{ type: "text", text: "Working through the task." }] },
        }),
        JSON.stringify(resultEvent),
      ].join("\n"),
      stderr: "",
      pid: 456,
      startedAt: new Date().toISOString(),
    });

    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-claude-contract-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    const result = await execute({
      runId: "run-contract",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Claude Coder",
        adapterType: "claude_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "claude",
        env: {
          ANTHROPIC_API_KEY: "sk-ant-test",
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
      sessionId: "claude-contract",
      sessionDisplayId: "claude-contract",
      provider: "anthropic",
      biller: "anthropic",
      billingType: "api",
      model: "claude-sonnet-4-5",
      costUsd: 0.067,
      usage: {
        inputTokens: 52,
        cachedInputTokens: 13,
        outputTokens: 9,
      },
      summary: "Implemented the requested change.",
      resultJson: expect.objectContaining(resultEvent),
    });
  });

  it("retries with a fresh Claude session when a saved resume session is stale", async () => {
    runChildProcess
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: JSON.stringify({
          type: "result",
          subtype: "error",
          session_id: "stale-session",
          is_error: true,
          result: "No conversation found with session id stale-session",
          errors: [{ message: "No conversation found with session id stale-session" }],
        }),
        stderr: "",
        pid: 456,
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          JSON.stringify({
            type: "system",
            subtype: "init",
            session_id: "fresh-claude-session",
            model: "claude-sonnet-4-5",
          }),
          JSON.stringify({
            type: "result",
            session_id: "fresh-claude-session",
            model: "claude-sonnet-4-5",
            result: "Recovered on a fresh session.",
            usage: { input_tokens: 8, cache_read_input_tokens: 0, output_tokens: 4 },
          }),
        ].join("\n"),
        stderr: "",
        pid: 789,
        startedAt: new Date().toISOString(),
      });

    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-claude-stale-session-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    const logs: string[] = [];

    const result = await execute({
      runId: "run-stale-session",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Claude Coder",
        adapterType: "claude_local",
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
        command: "claude",
        cwd: workspaceDir,
      },
      context: {},
      onLog: async (_stream, chunk) => {
        logs.push(chunk);
      },
    });

    expect(runChildProcess).toHaveBeenCalledTimes(2);
    const firstCall = runChildProcess.mock.calls[0] as unknown as [string, string, string[]] | undefined;
    const secondCall = runChildProcess.mock.calls[1] as unknown as [string, string, string[]] | undefined;
    expect(firstCall?.[2]).toContain("--resume");
    expect(firstCall?.[2]).toContain("stale-session");
    expect(secondCall?.[2]).not.toContain("--resume");
    expect(logs.join("")).toContain('Claude resume session "stale-session" is unavailable');
    expect(result).toMatchObject({
      exitCode: 0,
      errorMessage: null,
      sessionId: "fresh-claude-session",
      sessionDisplayId: "fresh-claude-session",
      model: "claude-sonnet-4-5",
      summary: "Recovered on a fresh session.",
      usage: {
        inputTokens: 8,
        cachedInputTokens: 0,
        outputTokens: 4,
      },
    });
  });

  it("uses shared failure families for Claude auth, unknown-session, max-turns, and timeout failures", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "stacy-claude-failure-family-"));
    cleanupDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    const baseContext = {
      runId: "run-family",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Claude Coder",
        adapterType: "claude_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: "claude",
        cwd: workspaceDir,
      },
      context: {},
      onLog: async () => {},
    };

    runChildProcess.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: "",
      stderr: "Please log in. Run `claude login` first.",
      pid: 456,
      startedAt: new Date().toISOString(),
    });
    await expect(execute(baseContext)).resolves.toMatchObject({
      errorCode: "claude_auth_required",
      errorFamily: "auth_required",
      resultJson: expect.objectContaining({ errorFamily: "auth_required" }),
    });

    runChildProcess.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: JSON.stringify({
        type: "result",
        subtype: "error",
        is_error: true,
        result: "No conversation found with session id missing-session",
        errors: [{ message: "No conversation found with session id missing-session" }],
      }),
      stderr: "",
      pid: 457,
      startedAt: new Date().toISOString(),
    });
    await expect(execute(baseContext)).resolves.toMatchObject({
      errorCode: "claude_unknown_session",
      errorFamily: "unknown_session",
      clearSession: true,
      resultJson: expect.objectContaining({ errorFamily: "unknown_session" }),
    });

    runChildProcess.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: JSON.stringify({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        result: "Maximum turns reached.",
      }),
      stderr: "",
      pid: 458,
      startedAt: new Date().toISOString(),
    });
    await expect(execute(baseContext)).resolves.toMatchObject({
      errorCode: "claude_max_turns",
      errorFamily: "max_turns",
      clearSession: true,
      resultJson: expect.objectContaining({ errorFamily: "max_turns" }),
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
