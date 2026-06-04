export type FederationTransportPurpose = "federation delivery" | "revocation lookup";

export function assertFederationTransportUrl(
  rawUrl: string,
  purpose: FederationTransportPurpose,
): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid ${purpose} URL: ${rawUrl}`);
  }

  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return;

  throw new Error(
    `${purpose} URL must use https:// unless it targets loopback for the local demo: ${rawUrl}`,
  );
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized === "[::1]") {
    return true;
  }

  const ipv4 = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;

  return ipv4[1] === "127";
}
