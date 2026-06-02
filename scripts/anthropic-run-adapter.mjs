#!/usr/bin/env node
/**
 * Reference Anthropic run adapter for `stacy run --adapter anthropic`.
 *
 * The `anthropic` run adapter (packages/federation/src/runs/adapters.ts) does
 * NOT call the Anthropic API directly. Instead it spawns an external command —
 * the one named in STACY_ANTHROPIC_ADAPTER_COMMAND — and exchanges JSON with it.
 * This file is a working, dependency-free implementation of that command. Use it
 * as-is, or copy it as the starting point for your own adapter.
 *
 * Contract:
 *   - stdin  (from Stacy): JSON {
 *       task: string,
 *       model: string,
 *       input_kos: [{ ko_id, content_hash, content_type, content }]
 *     }
 *   - stdout (to Stacy):   JSON { output: <object>, notes?: string[] }
 *     `output` MUST be a JSON object — it becomes the body of a signed
 *     `agent_output` Knowledge Object.
 *
 * Security:
 *   - The Anthropic API key is read from ANTHROPIC_API_KEY in THIS process's
 *     environment. Stacy never reads, stores, or logs it — it only spawns this
 *     command. Keep the key in your shell/secret store, never in source or chat.
 *   - Because this command leaves the install (network egress), `stacy run`
 *     requires `--ack-egress` before it will invoke the anthropic adapter.
 *
 * Usage:
 *   chmod +x scripts/anthropic-run-adapter.mjs
 *   export ANTHROPIC_API_KEY=...                                  # your shell only
 *   export STACY_ANTHROPIC_ADAPTER_COMMAND="$PWD/scripts/anthropic-run-adapter.mjs"
 *   stacy run "Summarize these PRs" --use <ko_id> --adapter anthropic --ack-egress
 *
 * Notes:
 *   - STACY_ANTHROPIC_ADAPTER_COMMAND must be a single executable path (this file
 *     has a shebang + is chmod +x). Stacy does NOT shell-split it, so
 *     "node script.mjs" will NOT work — point it straight at this file.
 *   - Optional env overrides: ANTHROPIC_MODEL (fallback model),
 *     ANTHROPIC_MAX_TOKENS (default 2048).
 */

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  process.stderr.write(
    "ANTHROPIC_API_KEY is not set in the adapter command's environment.\n",
  );
  process.exit(1);
}

const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS) || 2048;
const FALLBACK_MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-5";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", async () => {
  try {
    const req = JSON.parse(raw);
    const model = req.model || FALLBACK_MODEL;
    const inputs = Array.isArray(req.input_kos) ? req.input_kos : [];

    const contextBlocks = inputs
      .map(
        (ko, i) =>
          `## Input ${i + 1} — ${ko.ko_id} (${ko.content_type})\n` +
          "```json\n" +
          JSON.stringify(ko.content, null, 2) +
          "\n```",
      )
      .join("\n\n");

    const userPrompt =
      `Task: ${req.task}\n\n` +
      `You are given ${inputs.length} input Knowledge Object(s) below. ` +
      `Produce a JSON object for the result. Respond with ONLY a JSON object of the form ` +
      `{"output": { ... }, "notes": ["..."]}. The "output" must be a JSON object (a structured report). ` +
      `Do not wrap it in markdown fences.\n\n` +
      contextBlocks;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      process.stderr.write(`Anthropic API error ${resp.status}: ${body}\n`);
      process.exit(1);
    }

    const data = await resp.json();
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // Models sometimes wrap JSON in a ```json ... ``` fence; strip it.
    const unfenced = text
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    // Ensure the {output, notes} contract is always satisfied.
    let parsed;
    try {
      parsed = JSON.parse(unfenced);
    } catch {
      parsed = {
        output: { kind: "report", text },
        notes: ["Model did not return JSON; wrapped raw text."],
      };
    }
    if (parsed.output === undefined) parsed = { output: parsed };

    process.stdout.write(JSON.stringify(parsed));
  } catch (err) {
    process.stderr.write(`Adapter failed: ${err?.stack || err}\n`);
    process.exit(1);
  }
});
