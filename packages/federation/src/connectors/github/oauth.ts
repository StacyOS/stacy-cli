import { defaultHttpClient, type HttpClient } from "../http.js";
import type { AuthenticateOptions, TokenBundle } from "../types.js";

export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API_BASE_URL = "https://api.github.com";

export interface GitHubOAuthConfig {
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly http?: HttpClient;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly deviceCodeUrl?: string;
  readonly tokenUrl?: string;
  readonly apiBaseUrl?: string;
}

interface DeviceCodeResponse {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly expires_in: number;
  readonly interval: number;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly scope?: string;
  readonly error?: string;
  readonly interval?: number;
}

/**
 * Runs GitHub's OAuth device-code flow. Network access and timing are injected
 * so the whole flow is unit-testable against a mock with no real waiting.
 */
export async function authenticateWithDeviceFlow(
  config: GitHubOAuthConfig,
  options: AuthenticateOptions,
): Promise<TokenBundle> {
  const http = config.http ?? defaultHttpClient;
  const sleep = config.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = config.now ?? (() => Date.now());
  const scopeParam = options.scope?.trim() || config.scopes.join(" ");

  const deviceResponse = await http(config.deviceCodeUrl ?? GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, scope: scopeParam }),
  });
  if (!deviceResponse.ok) {
    throw new Error(`GitHub device-code request failed (${deviceResponse.status}).`);
  }
  const device = (await deviceResponse.json()) as DeviceCodeResponse;

  options.onUserPrompt?.({
    verificationUri: device.verification_uri,
    userCode: device.user_code,
    expiresInSeconds: device.expires_in,
  });

  const deadline = now() + device.expires_in * 1000;
  let intervalMs = Math.max(1, device.interval) * 1000;

  for (;;) {
    if (options.signal?.aborted) {
      throw new Error("GitHub authorization was aborted.");
    }
    if (now() >= deadline) {
      throw new Error("GitHub authorization timed out before approval.");
    }
    await sleep(intervalMs);

    const tokenResponse = await http(config.tokenUrl ?? GITHUB_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const token = (await tokenResponse.json()) as TokenResponse;

    if (token.access_token) {
      const account = await fetchLogin(http, config.apiBaseUrl ?? GITHUB_API_BASE_URL, token.access_token);
      return {
        accessToken: token.access_token,
        tokenType: token.token_type ?? "bearer",
        scopes: token.scope ? token.scope.split(/[ ,]+/).filter(Boolean) : [...config.scopes],
        account,
        obtainedAt: new Date(now()).toISOString(),
      };
    }

    switch (token.error) {
      case "authorization_pending":
        break;
      case "slow_down":
        intervalMs += Math.max(1000, (token.interval ?? 5) * 1000);
        break;
      case "expired_token":
        throw new Error("GitHub device code expired before approval.");
      case "access_denied":
        throw new Error("GitHub authorization was denied.");
      default:
        throw new Error(`GitHub authorization failed: ${token.error ?? "unknown error"}.`);
    }
  }
}

async function fetchLogin(http: HttpClient, apiBaseUrl: string, accessToken: string): Promise<string | undefined> {
  const response = await http(`${apiBaseUrl}/user`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "stacy-cli",
    },
  });
  if (!response.ok) return undefined;
  const user = (await response.json()) as { login?: string };
  return user.login;
}
