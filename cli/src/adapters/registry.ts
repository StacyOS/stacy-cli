import type { CLIAdapterModule } from "@arpanstacy/stacy-adapter-utils";
import { printClaudeStreamEvent } from "@arpanstacy/stacy-adapter-claude-local/cli";
import { printCodexStreamEvent } from "@arpanstacy/stacy-adapter-codex-local/cli";
import { printCursorStreamEvent } from "@arpanstacy/stacy-adapter-cursor-local/cli";
import { printGeminiStreamEvent } from "@arpanstacy/stacy-adapter-gemini-local/cli";
import { printOpenCodeStreamEvent } from "@arpanstacy/stacy-adapter-opencode-local/cli";
import { printPiStreamEvent } from "@arpanstacy/stacy-adapter-pi-local/cli";
import { printOpenClawGatewayStreamEvent } from "@arpanstacy/stacy-adapter-openclaw-gateway/cli";
import { processCLIAdapter } from "./process/index.js";
import { httpCLIAdapter } from "./http/index.js";

const claudeLocalCLIAdapter: CLIAdapterModule = {
  type: "claude_local",
  formatStdoutEvent: printClaudeStreamEvent,
};

const codexLocalCLIAdapter: CLIAdapterModule = {
  type: "codex_local",
  formatStdoutEvent: printCodexStreamEvent,
};

const openCodeLocalCLIAdapter: CLIAdapterModule = {
  type: "opencode_local",
  formatStdoutEvent: printOpenCodeStreamEvent,
};

const piLocalCLIAdapter: CLIAdapterModule = {
  type: "pi_local",
  formatStdoutEvent: printPiStreamEvent,
};

const cursorLocalCLIAdapter: CLIAdapterModule = {
  type: "cursor",
  formatStdoutEvent: printCursorStreamEvent,
};

const geminiLocalCLIAdapter: CLIAdapterModule = {
  type: "gemini_local",
  formatStdoutEvent: printGeminiStreamEvent,
};

const openclawGatewayCLIAdapter: CLIAdapterModule = {
  type: "openclaw_gateway",
  formatStdoutEvent: printOpenClawGatewayStreamEvent,
};

const adaptersByType = new Map<string, CLIAdapterModule>(
  [
    claudeLocalCLIAdapter,
    codexLocalCLIAdapter,
    openCodeLocalCLIAdapter,
    piLocalCLIAdapter,
    cursorLocalCLIAdapter,
    geminiLocalCLIAdapter,
    openclawGatewayCLIAdapter,
    processCLIAdapter,
    httpCLIAdapter,
  ].map((a) => [a.type, a]),
);

export function getCLIAdapter(type: string): CLIAdapterModule {
  return adaptersByType.get(type) ?? processCLIAdapter;
}
