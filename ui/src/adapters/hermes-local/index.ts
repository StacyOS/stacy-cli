import type { UIAdapterModule } from "../types";
import { SchemaConfigFields } from "../schema-config-fields";

export const hermesLocalUIAdapter: UIAdapterModule = {
  type: "hermes_local",
  label: "Hermes Agent",
  parseStdoutLine: () => [],
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: (values) => ({ ...values }),
};
