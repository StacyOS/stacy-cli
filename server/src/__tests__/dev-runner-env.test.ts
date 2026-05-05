import { describe, expect, it } from "vitest";
import { ensureDevRunnerAgentJwtSecret } from "../dev-runner-env.js";

describe("dev runner agent auth env", () => {
  it("preserves an explicit Stacy agent JWT secret", () => {
    const env = { STACY_AGENT_JWT_SECRET: "configured-secret" };

    expect(ensureDevRunnerAgentJwtSecret(env, () => "generated")).toEqual({
      created: false,
      source: "STACY_AGENT_JWT_SECRET",
    });
    expect(env.STACY_AGENT_JWT_SECRET).toBe("configured-secret");
  });

  it("uses Better Auth as the signing secret when available", () => {
    const env = { BETTER_AUTH_SECRET: "auth-secret" };

    expect(ensureDevRunnerAgentJwtSecret(env, () => "generated")).toEqual({
      created: false,
      source: "BETTER_AUTH_SECRET",
    });
    expect(env.STACY_AGENT_JWT_SECRET).toBeUndefined();
  });

  it("creates an ephemeral secret when local adapter auth has no configured signer", () => {
    const env = { STACY_AGENT_JWT_SECRET: "  " };

    expect(ensureDevRunnerAgentJwtSecret(env, () => "generated-secret")).toEqual({
      created: true,
      source: "ephemeral",
    });
    expect(env.STACY_AGENT_JWT_SECRET).toBe("generated-secret");
  });
});
