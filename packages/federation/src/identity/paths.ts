import { resolve } from "node:path";

export function resolveFederationIdentityPath(instanceRoot: string): string {
  return resolve(instanceRoot, "secrets", "federation-install-identity.json");
}
