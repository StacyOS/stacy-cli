import type { Connector, DeviceAuthorizationPrompt, TokenBundle } from "../src/connectors/types.js";
import type { KeychainStore } from "../src/connectors/keychain.js";
import {
  buildGitHubConnector,
  resolveConnectorKeychain,
} from "./connector-runtime.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface ConnectGithubOptions extends LocalRuntimeOptions {
  readonly clientId?: string;
  readonly org?: string;
  readonly scope?: string;
  readonly json?: boolean;
}

export interface ConnectDependencies extends LocalRuntimeDependencies {
  readonly keychain?: KeychainStore;
  readonly connector?: Connector;
  readonly stdout?: Pick<typeof console, "log">;
  readonly onPrompt?: (prompt: DeviceAuthorizationPrompt) => void;
}

export async function connectGithubCommand(
  options: ConnectGithubOptions,
  dependencies: ConnectDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const env = dependencies.env ?? process.env;
  const runtime = resolveLocalRuntime(options, dependencies);

  const connector =
    dependencies.connector ??
    buildGitHubConnector({ clientId: resolveClientId(options.clientId, env) });
  const keychain = dependencies.keychain ?? resolveConnectorKeychain(runtime);

  const prompt =
    dependencies.onPrompt ??
    ((p: DeviceAuthorizationPrompt) =>
      stdout.log(
        [
          `Connecting to ${connector.displayName}...`,
          `  Visit ${p.verificationUri} and enter code: ${p.userCode}`,
          `  Waiting for authorization (expires in ${Math.round(p.expiresInSeconds / 60)} min)...`,
        ].join("\n"),
      ));

  const token: TokenBundle = await connector.authenticate({
    org: options.org,
    scope: options.scope,
    onUserPrompt: prompt,
  });
  await keychain.set(connector.id, token);

  const summary = {
    connector: connector.id,
    account: token.account,
    scopes: token.scopes,
  };
  stdout.log(
    options.json
      ? JSON.stringify(summary, null, 2)
      : [
          `Connected to ${connector.displayName}.`,
          token.account ? `Account: ${token.account}` : undefined,
          `Scopes: ${token.scopes.join(", ") || "(none reported)"}`,
          `Token stored (encrypted) for this install. Use \`stacy ingest ${connector.id}\` to ingest.`,
        ]
          .filter(Boolean)
          .join("\n"),
  );
}

function resolveClientId(optionClientId: string | undefined, env: NodeJS.ProcessEnv): string {
  const clientId = optionClientId?.trim() || env.STACY_GITHUB_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error(
      "Missing GitHub OAuth client id. Pass --client-id or set STACY_GITHUB_CLIENT_ID " +
        "(register a GitHub OAuth app with the device flow enabled).",
    );
  }
  return clientId;
}
