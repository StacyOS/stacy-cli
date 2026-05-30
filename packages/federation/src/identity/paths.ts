import { resolve } from "node:path";

export function resolveFederationIdentityPath(instanceRoot: string): string {
  return resolve(instanceRoot, "secrets", "federation-install-identity.json");
}

export function resolveConnectorTokenStorePath(instanceRoot: string): string {
  return resolve(instanceRoot, "secrets", "connector-tokens.json");
}

export function resolveConnectorStateDir(instanceRoot: string): string {
  return resolve(instanceRoot, "connectors");
}
