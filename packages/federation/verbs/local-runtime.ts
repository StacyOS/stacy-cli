import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stacyConfigSchema, type StacyConfig } from "@arpanstacy/stacy-shared";

import { resolveFederationIdentityPath } from "../src/identity/paths.js";

export interface LocalRuntimeOptions {
  readonly config?: string;
  readonly dbUrl?: string;
}

export interface LocalRuntimeDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
}

export interface LocalRuntime {
  readonly configPath: string;
  readonly instanceRoot: string;
  readonly connectionString: string;
  readonly identityPath: string;
}

export function resolveLocalRuntime(
  options: LocalRuntimeOptions,
  dependencies: LocalRuntimeDependencies = {},
): LocalRuntime {
  const env = dependencies.env ?? process.env;
  const configPath = resolveConfigPath(options.config, env, dependencies.cwd ?? process.cwd());
  const instanceRoot = dirname(configPath);
  const explicit = options.dbUrl?.trim() || env.STACY_FEDERATION_DB_URL?.trim() || env.DATABASE_URL?.trim();

  if (explicit) {
    return {
      configPath,
      instanceRoot,
      connectionString: explicit,
      identityPath: resolveFederationIdentityPath(instanceRoot),
    };
  }

  const config = readStacyConfig(configPath);

  return {
    configPath,
    instanceRoot,
    connectionString: resolveConfigConnectionString(config),
    identityPath: resolveFederationIdentityPath(instanceRoot),
  };
}

function resolveConfigPath(
  optionConfig: string | undefined,
  env: NodeJS.ProcessEnv,
  cwd: string,
): string {
  if (optionConfig?.trim()) {
    return resolve(optionConfig);
  }

  if (env.STACY_CONFIG?.trim()) {
    return resolve(env.STACY_CONFIG);
  }

  return resolve(cwd, ".stacy", "config.json");
}

function readStacyConfig(configPath: string): StacyConfig {
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  const parsed = stacyConfigSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(`Invalid Stacy config at ${configPath}: ${parsed.error.message}`);
  }

  return parsed.data;
}

function resolveConfigConnectionString(config: StacyConfig): string {
  if (config.database.mode === "postgres" && config.database.connectionString?.trim()) {
    return config.database.connectionString.trim();
  }

  return `postgres://stacy:stacy@127.0.0.1:${config.database.embeddedPostgresPort}/stacy`;
}
