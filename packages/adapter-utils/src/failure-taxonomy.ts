export const ADAPTER_EXECUTION_ERROR_FAMILIES = [
  "transient_upstream",
  "auth_required",
  "unknown_session",
  "max_turns",
  "validation",
  "timeout",
  "cancelled",
] as const;

export type AdapterExecutionErrorFamily = (typeof ADAPTER_EXECUTION_ERROR_FAMILIES)[number];

export type AdapterExecutionOperatorAction =
  | "wait_or_retry"
  | "reauthenticate"
  | "retry_fresh_session"
  | "revise_task_or_limits"
  | "fix_configuration"
  | "inspect_timeout"
  | "none";

export interface AdapterExecutionFailureTaxonomyEntry {
  family: AdapterExecutionErrorFamily;
  label: string;
  retryableByDefault: boolean;
  clearsSession: boolean;
  operatorAction: AdapterExecutionOperatorAction;
  exampleCodes: readonly string[];
}

export const ADAPTER_EXECUTION_FAILURE_TAXONOMY = [
  {
    family: "transient_upstream",
    label: "Transient upstream",
    retryableByDefault: true,
    clearsSession: false,
    operatorAction: "wait_or_retry",
    exampleCodes: [
      "codex_transient_upstream",
      "claude_transient_upstream",
      "rate_limit",
      "service_unavailable",
    ],
  },
  {
    family: "auth_required",
    label: "Authentication required",
    retryableByDefault: false,
    clearsSession: false,
    operatorAction: "reauthenticate",
    exampleCodes: [
      "claude_auth_required",
      "gemini_auth_required",
      "adapter_auth_required",
    ],
  },
  {
    family: "unknown_session",
    label: "Unknown session",
    retryableByDefault: true,
    clearsSession: true,
    operatorAction: "retry_fresh_session",
    exampleCodes: [
      "codex_unknown_session",
      "claude_unknown_session",
      "adapter_unknown_session",
    ],
  },
  {
    family: "max_turns",
    label: "Max turns reached",
    retryableByDefault: false,
    clearsSession: true,
    operatorAction: "revise_task_or_limits",
    exampleCodes: [
      "claude_max_turns",
      "adapter_max_turns",
    ],
  },
  {
    family: "validation",
    label: "Validation or configuration error",
    retryableByDefault: false,
    clearsSession: false,
    operatorAction: "fix_configuration",
    exampleCodes: [
      "adapter_failed",
      "invalid_request",
      "unknown_parameter",
    ],
  },
  {
    family: "timeout",
    label: "Timeout",
    retryableByDefault: false,
    clearsSession: false,
    operatorAction: "inspect_timeout",
    exampleCodes: [
      "timeout",
    ],
  },
  {
    family: "cancelled",
    label: "Cancelled",
    retryableByDefault: false,
    clearsSession: false,
    operatorAction: "none",
    exampleCodes: [
      "cancelled",
      "issue_cancelled",
    ],
  },
] as const satisfies readonly AdapterExecutionFailureTaxonomyEntry[];

const ADAPTER_EXECUTION_ERROR_FAMILY_SET = new Set<string>(ADAPTER_EXECUTION_ERROR_FAMILIES);

export function isAdapterExecutionErrorFamily(value: unknown): value is AdapterExecutionErrorFamily {
  return typeof value === "string" && ADAPTER_EXECUTION_ERROR_FAMILY_SET.has(value);
}

export function getAdapterExecutionFailureTaxonomyEntry(
  family: AdapterExecutionErrorFamily,
): AdapterExecutionFailureTaxonomyEntry {
  const entry = ADAPTER_EXECUTION_FAILURE_TAXONOMY.find((candidate) => candidate.family === family);
  if (!entry) {
    throw new Error(`Unknown adapter execution error family: ${family}`);
  }
  return entry;
}
