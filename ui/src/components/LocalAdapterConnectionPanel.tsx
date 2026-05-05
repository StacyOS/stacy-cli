import { useState } from "react";
import type { AdapterEnvironmentTestResult } from "@arpanstacy/stacy-shared";
import {
  AlertTriangle,
  Check,
  Clipboard,
  KeyRound,
  Loader2,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";

type LocalAccountAdapterType = "claude_local" | "codex_local";

type ConnectionState =
  | "not_tested"
  | "connected"
  | "needs_auth"
  | "blocked"
  | "warning";

interface LocalAccountProfile {
  name: string;
  accountName: string;
  loginCommand: string;
  authSurface: string;
}

interface ConnectionSummary {
  state: ConnectionState;
  title: string;
  body: string;
}

const LOCAL_ACCOUNT_PROFILES: Record<LocalAccountAdapterType, LocalAccountProfile> = {
  claude_local: {
    name: "Claude",
    accountName: "Claude Code",
    loginCommand: "claude login",
    authSurface: "Claude Code login, or a user-provided ANTHROPIC_API_KEY if they choose that mode",
  },
  codex_local: {
    name: "Codex",
    accountName: "Codex CLI",
    loginCommand: "codex login",
    authSurface: "Codex CLI login, or a user-provided OPENAI_API_KEY if they choose that mode",
  },
};

export function isLocalAccountAdapter(adapterType: string): adapterType is LocalAccountAdapterType {
  return adapterType === "claude_local" || adapterType === "codex_local";
}

function hasAuthRequiredCheck(result: AdapterEnvironmentTestResult) {
  return result.checks.some((check) => {
    const code = check.code.toLowerCase();
    return (
      code.includes("auth_required") ||
      code.includes("login_required") ||
      (result.status === "fail" && code.includes("api_key_missing")) ||
      (result.status === "fail" && code.includes("openai_api_key_missing"))
    );
  });
}

function hasAuthRequiredText(value: string) {
  return /(?:auth(?:entication)?(?:_|\s|-)?required|login\s+required|not\s+logged\s+in|failed\s+to\s+authenticate|unauthorized|\b401\b|api(?:_|\s|-)?key(?:\s+missing|\s+invalid)?)/i.test(value);
}

export function describeLocalAdapterConnection(
  adapterType: LocalAccountAdapterType,
  result: AdapterEnvironmentTestResult | null | undefined,
): ConnectionSummary {
  const profile = LOCAL_ACCOUNT_PROFILES[adapterType];
  if (!result) {
    return {
      state: "not_tested",
      title: `Connect ${profile.name}`,
      body:
        `Stacy will verify that this machine can run ${profile.accountName} ` +
        "with the user's own local auth. No provider credentials are stored in Stacy.",
    };
  }

  if (hasAuthRequiredCheck(result)) {
    return {
      state: "needs_auth",
      title: `${profile.name} needs login`,
      body:
        "The CLI is installed, but this machine is not authenticated yet. " +
        `Run ${profile.loginCommand} in the terminal that starts Stacy, then retest.`,
    };
  }

  if (result.status === "pass") {
    return {
      state: "connected",
      title: `${profile.name} connected`,
      body: `${profile.accountName} is installed and authenticated for this local Stacy server.`,
    };
  }

  if (result.status === "fail") {
    return {
      state: "blocked",
      title: `${profile.name} is not reachable`,
      body:
        `Stacy could not complete the local ${profile.accountName} probe. ` +
        "Fix the command, PATH, or working directory, then retest.",
    };
  }

  return {
    state: "warning",
    title: `${profile.name} connected with warnings`,
    body:
      `${profile.accountName} responded, but Stacy found setup warnings that ` +
      "should be reviewed before relying on this agent.",
  };
}

function statusClasses(state: ConnectionState) {
  if (state === "connected") {
    return "border-green-300 bg-green-50 text-green-800 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-200";
  }
  if (state === "needs_auth" || state === "warning") {
    return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200";
  }
  if (state === "blocked") {
    return "border-red-300 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200";
  }
  return "border-border bg-muted/20 text-foreground";
}

function statusIcon(state: ConnectionState) {
  if (state === "connected") return <Check className="h-4 w-4 shrink-0" />;
  if (state === "not_tested") return <KeyRound className="h-4 w-4 shrink-0" />;
  return <AlertTriangle className="h-4 w-4 shrink-0" />;
}

export function LocalAdapterConnectionPanel({
  adapterType,
  result,
  error,
  isTesting,
  onTest,
  compact = false,
}: {
  adapterType: LocalAccountAdapterType;
  result?: AdapterEnvironmentTestResult | null;
  error?: string | null;
  isTesting: boolean;
  onTest: () => void;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const profile = LOCAL_ACCOUNT_PROFILES[adapterType];
  const summary = describeLocalAdapterConnection(adapterType, result);
  const errorNeedsAuth = error ? hasAuthRequiredText(error) : false;
  const effectiveState = error ? (errorNeedsAuth ? "needs_auth" : "blocked") : summary.state;
  const effectiveTitle = error
    ? errorNeedsAuth
      ? `${profile.name} needs login`
      : `${profile.name} connection failed`
    : summary.title;
  const effectiveBody = errorNeedsAuth
    ? `The local ${profile.accountName} probe could not authenticate. Run ${profile.loginCommand} in the terminal that starts Stacy, then retest.`
    : error ?? summary.body;
  const showLoginCommand =
    effectiveState === "not_tested" ||
    effectiveState === "needs_auth" ||
    effectiveState === "blocked";

  async function copyLoginCommand() {
    try {
      await navigator.clipboard?.writeText(profile.loginCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-3 text-xs",
        statusClasses(effectiveState),
        compact ? "space-y-2" : "space-y-3",
      )}
      data-testid="local-adapter-connection-panel"
      data-connection-state={effectiveState}
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          {statusIcon(effectiveState)}
          <div className="min-w-0 space-y-1">
            <p className="font-medium">
              {effectiveTitle}
            </p>
            <p className="leading-relaxed opacity-90">{effectiveBody}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2.5 text-xs"
          disabled={isTesting}
          onClick={onTest}
        >
          {isTesting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <KeyRound className="h-3.5 w-3.5" />
          )}
          {isTesting
            ? "Testing..."
            : effectiveState === "not_tested"
              ? `Connect ${profile.name}`
              : "Retest"}
        </Button>
      </div>

      <div className="rounded border border-current/15 bg-background/35 px-2.5 py-2 text-[11px] leading-relaxed">
        <span className="font-medium">Credential boundary:</span>{" "}
        Stacy uses this user's local {profile.authSurface}. It does not bundle shared Claude or Codex
        credentials.
      </div>

      {showLoginCommand && (
        <div className="flex flex-col gap-2 rounded border border-current/15 bg-background/35 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="h-3.5 w-3.5 shrink-0 opacity-80" />
            <code className="font-mono break-all">{profile.loginCommand}</code>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => void copyLoginCommand()}
          >
            <Clipboard className="h-3 w-3" />
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}

      {result ? (
        <div className="space-y-1.5 border-t border-current/10 pt-2">
          <div className="flex items-center justify-between gap-2 text-[11px] opacity-80">
            <span>Connection checks</span>
            <span>{new Date(result.testedAt).toLocaleTimeString()}</span>
          </div>
          {result.checks.map((check, idx) => (
            <div key={`${check.code}-${idx}`} className="text-[11px] leading-relaxed break-words">
              <span className="font-medium uppercase tracking-wide opacity-80">{check.level}</span>
              <span className="mx-1 opacity-60">·</span>
              <span>{check.message}</span>
              {check.detail ? (
                <span className="block opacity-75 break-all">({check.detail})</span>
              ) : null}
              {check.hint ? (
                <span className="block opacity-90 break-words">Hint: {check.hint}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
