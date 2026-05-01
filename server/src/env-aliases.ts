const STACY_PREFIX = "STACY_";
const PAPERCLIP_PREFIX = "PAPERCLIP_";

export function applyStacyEnvAliases(env: NodeJS.ProcessEnv = process.env): void {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(STACY_PREFIX) || value === undefined || value.trim().length === 0) continue;

    const paperclipKey = `${PAPERCLIP_PREFIX}${key.slice(STACY_PREFIX.length)}`;
    if (env[paperclipKey] === undefined || env[paperclipKey]?.trim().length === 0) {
      env[paperclipKey] = value;
    }
  }
}
