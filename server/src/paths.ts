import fs from "node:fs";
import path from "node:path";
import { applyStacyEnvAliases } from "./env-aliases.js";
import { resolveDefaultConfigPath } from "./home-paths.js";

const STACY_CONFIG_BASENAME = "config.json";
const STACY_ENV_FILENAME = ".env";

applyStacyEnvAliases();

function findConfigFileFromAncestors(startDir: string): string | null {
  const absoluteStartDir = path.resolve(startDir);
  let currentDir = absoluteStartDir;

  while (true) {
    const candidate = path.resolve(currentDir, ".stacy", STACY_CONFIG_BASENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const nextDir = path.resolve(currentDir, "..");
    if (nextDir === currentDir) break;
    currentDir = nextDir;
  }

  return null;
}

export function resolveStacyConfigPath(overridePath?: string): string {
  if (overridePath) return path.resolve(overridePath);
  if (process.env.STACY_CONFIG) return path.resolve(process.env.STACY_CONFIG);
  return findConfigFileFromAncestors(process.cwd()) ?? resolveDefaultConfigPath();
}

export function resolveStacyEnvPath(overrideConfigPath?: string): string {
  return path.resolve(path.dirname(resolveStacyConfigPath(overrideConfigPath)), STACY_ENV_FILENAME);
}
