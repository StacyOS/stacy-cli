import { randomBytes } from "node:crypto";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function ensureDevRunnerAgentJwtSecret(
  env: NodeJS.ProcessEnv = process.env,
  createSecret = () => randomBytes(32).toString("hex"),
): { created: false; source: "STACY_AGENT_JWT_SECRET" | "BETTER_AUTH_SECRET" } | { created: true; source: "ephemeral" } {
  if (nonEmpty(env.STACY_AGENT_JWT_SECRET)) {
    return { created: false, source: "STACY_AGENT_JWT_SECRET" };
  }

  if (nonEmpty(env.BETTER_AUTH_SECRET)) {
    return { created: false, source: "BETTER_AUTH_SECRET" };
  }

  env.STACY_AGENT_JWT_SECRET = createSecret();
  return { created: true, source: "ephemeral" };
}
