import fs from "node:fs";
import { stacyConfigSchema, type StacyConfig } from "@arpanstacy/stacy-shared";
import { resolveStacyConfigPath } from "./paths.js";

export function readConfigFile(): StacyConfig | null {
  const configPath = resolveStacyConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return stacyConfigSchema.parse(raw);
  } catch {
    return null;
  }
}
