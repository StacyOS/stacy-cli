import { describe, expect, it } from "vitest";

import { stacyConfigSchema } from "./config-schema.js";

const baseConfig = {
  $meta: {
    version: 1,
    updatedAt: "2026-05-22T00:00:00.000Z",
    source: "onboard",
  },
  llm: {
    provider: "claude",
  },
  database: {
    mode: "embedded-postgres",
  },
  logging: {
    mode: "file",
  },
  server: {
    deploymentMode: "authenticated",
    exposure: "private",
    host: "127.0.0.1",
    port: 3100,
    allowedHostnames: [],
    serveUi: true,
  },
  auth: {},
  telemetry: {},
  storage: {
    provider: "local_disk",
  },
  secrets: {
    provider: "local_encrypted",
  },
};

describe("stacyConfigSchema server TLS config", () => {
  it("keeps server.tls optional for existing config files", () => {
    const parsed = stacyConfigSchema.parse(baseConfig);

    expect(parsed.server.tls).toBeUndefined();
  });

  it("accepts explicit server TLS PEM paths", () => {
    const parsed = stacyConfigSchema.parse({
      ...baseConfig,
      server: {
        ...baseConfig.server,
        tls: {
          enabled: true,
          certPath: "~/.stacy/certs/server.crt",
          keyPath: "~/.stacy/certs/server.key",
        },
      },
    });

    expect(parsed.server.tls).toEqual({
      enabled: true,
      certPath: "~/.stacy/certs/server.crt",
      keyPath: "~/.stacy/certs/server.key",
    });
  });
});
