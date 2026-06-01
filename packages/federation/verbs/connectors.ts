import type { Connector } from "../src/connectors/types.js";
import type { KeychainStore } from "../src/connectors/keychain.js";
import {
  buildConnectorRegistry,
  buildGitHubConnector,
  ensureFreshToken,
  resolveConnectorKeychain,
} from "./connector-runtime.js";
import {
  resolveLocalRuntime,
  type LocalRuntimeDependencies,
  type LocalRuntimeOptions,
} from "./local-runtime.js";

export interface ConnectorsListOptions extends LocalRuntimeOptions {
  readonly json?: boolean;
}

export interface ConnectorsStatusOptions extends LocalRuntimeOptions {
  readonly json?: boolean;
}

export interface ConnectorsDisconnectOptions extends LocalRuntimeOptions {
  readonly json?: boolean;
}

export interface ConnectorsDependencies extends LocalRuntimeDependencies {
  readonly keychain?: KeychainStore;
  readonly connector?: Connector;
  readonly stdout?: Pick<typeof console, "log">;
}

export async function connectorsListCommand(
  options: ConnectorsListOptions,
  dependencies: ConnectorsDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const keychain = dependencies.keychain ?? resolveConnectorKeychain(runtime);
  const connected = new Set(await keychain.list());
  const descriptors = buildConnectorRegistry().list();

  const rows = descriptors.map((descriptor) => ({
    id: descriptor.id,
    displayName: descriptor.displayName,
    authType: descriptor.authType,
    connected: connected.has(descriptor.id),
    objectKinds: descriptor.objectKinds,
  }));

  if (options.json) {
    stdout.log(JSON.stringify({ connectors: rows }, null, 2));
    return;
  }

  const lines = rows.map(
    (row) =>
      `${row.id.padEnd(10)}  ${row.connected ? "connected" : "—".padEnd(9)}  ${row.objectKinds.join(", ")}`,
  );
  stdout.log(["CONNECTOR   STATUS     OBJECT KINDS", ...lines].join("\n"));
}

export async function connectorsStatusCommand(
  options: ConnectorsStatusOptions,
  dependencies: ConnectorsDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const keychain = dependencies.keychain ?? resolveConnectorKeychain(runtime);
  const connector = dependencies.connector ?? buildGitHubConnector();

  const storedToken = await keychain.get(connector.id);
  if (!storedToken) {
    const message = `${connector.displayName} is not connected. Run \`stacy connect ${connector.id}\`.`;
    if (options.json) {
      stdout.log(JSON.stringify({ connected: false, connector: connector.id }, null, 2));
      return;
    }
    stdout.log(message);
    return;
  }

  const token = await ensureFreshToken({ connector, keychain, token: storedToken });
  const report = await connector.status(token);
  if (options.json) {
    stdout.log(JSON.stringify({ connector: connector.id, ...report }, null, 2));
    return;
  }
  stdout.log(
    [
      `${connector.displayName}: ${report.connected ? "connected" : "token invalid"}`,
      report.account ? `Account: ${report.account}` : undefined,
      `Scopes: ${report.scopes.join(", ") || "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export async function connectorsDisconnectCommand(
  connectorId: string,
  options: ConnectorsDisconnectOptions,
  dependencies: ConnectorsDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? console;
  const runtime = resolveLocalRuntime(options, dependencies);
  const keychain = dependencies.keychain ?? resolveConnectorKeychain(runtime);

  const id = connectorId.trim();
  const removed = await keychain.delete(id);

  if (options.json) {
    stdout.log(JSON.stringify({ connector: id, disconnected: removed }, null, 2));
    return;
  }
  stdout.log(
    removed
      ? `Disconnected ${id}. Stored token removed.`
      : `${id} was not connected; nothing to remove.`,
  );
}
