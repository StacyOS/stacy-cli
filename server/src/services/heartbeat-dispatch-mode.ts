export const HEARTBEAT_DISPATCH_MODES = [
  "direct",
  "shadow_worker",
  "worker_owned",
] as const;

export type HeartbeatDispatchMode = typeof HEARTBEAT_DISPATCH_MODES[number];

export function normalizeHeartbeatDispatchMode(
  value: string | null | undefined,
  fallback: HeartbeatDispatchMode = "direct",
): HeartbeatDispatchMode {
  const normalized = value?.trim();
  if (normalized && HEARTBEAT_DISPATCH_MODES.includes(normalized as HeartbeatDispatchMode)) {
    return normalized as HeartbeatDispatchMode;
  }
  return fallback;
}
