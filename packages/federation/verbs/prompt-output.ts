import { spawn } from "node:child_process";

import type { CanonicalJsonValue } from "../src/crypto/canonical.js";

export interface PromptOutputOptions {
  readonly prompt: string;
  readonly adapterCommand?: string;
  readonly adapterArgs?: readonly string[];
  readonly timeoutMs?: number;
}

export interface PromptOutputResult {
  readonly content: CanonicalJsonValue;
  readonly generator: "adapter_command" | "deterministic_fallback";
}

export async function generatePromptKnowledgeContent(
  options: PromptOutputOptions,
): Promise<PromptOutputResult> {
  if (options.adapterCommand?.trim()) {
    const output = await runAdapterCommand({
      command: options.adapterCommand.trim(),
      args: options.adapterArgs ?? [],
      stdin: options.prompt,
      timeoutMs: options.timeoutMs ?? 120_000,
    });

    return {
      generator: "adapter_command",
      content: {
        kind: "agent_output",
        prompt: options.prompt,
        output,
        generatedAt: new Date(0).toISOString(),
        generator: "adapter_command",
      },
    };
  }

  return {
    generator: "deterministic_fallback",
    content: {
      kind: "agent_output",
      prompt: options.prompt,
      output: `Deterministic Stacy federation KO content for prompt: ${options.prompt}`,
      generatedAt: new Date(0).toISOString(),
      generator: "deterministic_fallback",
    },
  };
}

async function runAdapterCommand(options: {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly timeoutMs: number;
}): Promise<string> {
  const child = spawn(options.command, [...options.args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, options.timeoutMs);

  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin?.end(options.stdin);

  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", resolveExit);
  });
  clearTimeout(timeout);

  if (exitCode !== 0) {
    throw new Error(
      `Adapter command failed with exit code ${exitCode ?? "unknown"}${
        stderr.trim() ? `: ${stderr.trim()}` : ""
      }`,
    );
  }

  return stdout.trim();
}
