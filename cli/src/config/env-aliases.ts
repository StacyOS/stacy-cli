const STACY_PREFIX = "STACY_";

export function applyStacyEnvAliases(env: NodeJS.ProcessEnv = process.env): void {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(STACY_PREFIX) || value === undefined || value.trim().length === 0) continue;

    const stacyKey = `${STACY_PREFIX}${key.slice(STACY_PREFIX.length)}`;
    if (env[stacyKey] === undefined || env[stacyKey]?.trim().length === 0) {
      env[stacyKey] = value;
    }
  }
}
