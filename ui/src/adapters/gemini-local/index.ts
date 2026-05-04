import type { UIAdapterModule } from "../types";
import { parseGeminiStdoutLine } from "@arpanstacy/stacy-adapter-gemini-local/ui";
import { GeminiLocalConfigFields } from "./config-fields";
import { buildGeminiLocalConfig } from "@arpanstacy/stacy-adapter-gemini-local/ui";

export const geminiLocalUIAdapter: UIAdapterModule = {
  type: "gemini_local",
  label: "Gemini CLI (local)",
  parseStdoutLine: parseGeminiStdoutLine,
  ConfigFields: GeminiLocalConfigFields,
  buildAdapterConfig: buildGeminiLocalConfig,
};
