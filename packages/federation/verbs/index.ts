import { brainDeriveCommand, type BrainDeriveDependencies } from "./brain-derive.js";
import { brainCreateCommand, type BrainCreateDependencies } from "./brain-create.js";
import { brainExportCommand, type BrainExportDependencies } from "./brain-export.js";
import { brainImportCommand, type BrainImportDependencies } from "./brain-import.js";
import { brainListCommand, type BrainListDependencies } from "./brain-list.js";
import { brainShowCommand, type BrainShowDependencies } from "./brain-show.js";
import { brainVerifyCommand, type BrainVerifyDependencies } from "./brain-verify.js";
import {
  contactsAddCommand,
  contactsExportCommand,
  contactsImportCommand,
  contactsImportLinkCommand,
  contactsListCommand,
  contactsShareLinkCommand,
  contactsShowCommand,
  type ContactsDependencies,
} from "./contacts.js";
import { connectGithubCommand, type ConnectDependencies } from "./connect.js";
import {
  connectorsDisconnectCommand,
  connectorsListCommand,
  connectorsStatusCommand,
  type ConnectorsDependencies,
} from "./connectors.js";
import { ingestGithubCommand, type IngestDependencies } from "./ingest.js";
import { receiptsListCommand, receiptsVerifyCommand, type ReceiptsDependencies } from "./receipts.js";
import {
  identityBackupCommand,
  identityRotateCommand,
  identityShowCommand,
  identityVerifyChainCommand,
  type IdentityDependencies,
} from "./identity.js";
import { revokeCommand, type RevokeDependencies } from "./revoke.js";
import { agentRunCommand, type AgentRunDependencies } from "./run.js";
import { runTaskCommand, type RunTaskDependencies } from "./run-task.js";
import { shareCommand, type ShareDependencies } from "./share.js";

interface CommandLike {
  command(nameAndArgs: string): CommandLike;
  description(text: string): CommandLike;
  argument(name: string, description: string): CommandLike;
  option(flags: string, description: string, ...extra: unknown[]): CommandLike;
  requiredOption(flags: string, description: string): CommandLike;
  action(handler: (...args: unknown[]) => unknown): CommandLike;
}

export const federationCliCommands = {
  brain: "brain",
  brainCreate: "create",
  brainList: "list",
  brainExport: "export",
  brainImport: "import",
  brainDerive: "derive",
  brainShow: "show",
  brainVerify: "verify",
  share: "share",
  revoke: "revoke",
} as const;

export interface RegisterFederationCommandsOptions {
  readonly brainCreate?: BrainCreateDependencies;
  readonly brainList?: BrainListDependencies;
  readonly brainExport?: BrainExportDependencies;
  readonly brainImport?: BrainImportDependencies;
  readonly brainDerive?: BrainDeriveDependencies;
  readonly brainShow?: BrainShowDependencies;
  readonly brainVerify?: BrainVerifyDependencies;
  readonly share?: ShareDependencies;
  readonly revoke?: RevokeDependencies;
  readonly contacts?: ContactsDependencies;
  readonly receipts?: ReceiptsDependencies;
  readonly identity?: IdentityDependencies;
  readonly runTask?: RunTaskDependencies;
  readonly connect?: ConnectDependencies;
  readonly connectors?: ConnectorsDependencies;
  readonly ingest?: IngestDependencies;
}

export function registerFederationCommands(
  program: CommandLike,
  options: RegisterFederationCommandsOptions = {},
): void {
  const brain = program
    .command(federationCliCommands.brain)
    .description("StacyOS Brain Knowledge Object operations");

  brain
    .command(federationCliCommands.brainCreate)
    .description("Create and store a local signed Knowledge Object")
    .option("--content-json <json>", "Knowledge Object content as JSON")
    .option("--prompt <text>", "Generate Knowledge Object content from a prompt")
    .option("--adapter-command <command>", "Optional adapter-like command that reads the prompt on stdin and writes output")
    .option("--adapter-arg <arg>", "Argument passed to --adapter-command; repeat for multiple args", collectOption, [])
    .option("--content-type <type>", "Knowledge Object content type", "application/json")
    .option("--ko-id <id>", "Deterministic Knowledge Object ID for harness runs")
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .option("--json", "Print raw JSON output", false)
    .action(async (commandOptions) => {
      await brainCreateCommand(commandOptions as Parameters<typeof brainCreateCommand>[0], options.brainCreate);
    });

  brain
    .command(federationCliCommands.brainList)
    .description("List locally stored signed Knowledge Objects")
    .option("--content-type <type>", "Filter by Knowledge Object content type")
    .option("--source <source>", "Filter by source: local or federated")
    .option("--limit <n>", "Maximum rows to return (1-100, default 20)")
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .option("--json", "Print raw JSON output", false)
    .action(async (commandOptions) => {
      await brainListCommand(commandOptions as Parameters<typeof brainListCommand>[0], options.brainList);
    });

  brain
    .command(federationCliCommands.brainShow)
    .description("Show a signed Knowledge Object with provenance")
    .argument("<ko_id>", "Knowledge Object ID or content hash")
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .option("--as-consumer <install_id>", "Enforce federated read consent as this consumer install")
    .option("--json", "Print raw JSON output", false)
    .action(async (koId, commandOptions) => {
      await brainShowCommand(String(koId), commandOptions as Parameters<typeof brainShowCommand>[1], options.brainShow);
    });

  brain
    .command(federationCliCommands.brainExport)
    .description("Export a signed Knowledge Object to a portable file")
    .argument("<ko_id>", "Knowledge Object ID or content hash")
    .option("--out <path>", "Write the export to a file (default <ko_id>.stacy-ko.json)")
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .option("--json", "Print raw JSON output", false)
    .action(async (koId, commandOptions) => {
      await brainExportCommand(String(koId), commandOptions as Parameters<typeof brainExportCommand>[1], options.brainExport);
    });

  brain
    .command(federationCliCommands.brainImport)
    .description("Import and verify a signed Knowledge Object from a portable file")
    .argument("<path>", "Path to a Knowledge Object export JSON file")
    .option("--source <source>", "Record the imported KO source: local or federated (default federated)")
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .option("--json", "Print raw JSON output", false)
    .action(async (path, commandOptions) => {
      await brainImportCommand(String(path), commandOptions as Parameters<typeof brainImportCommand>[1], options.brainImport);
    });

  brain
    .command(federationCliCommands.brainDerive)
    .description("Create a consumer-signed derived Knowledge Object from a write-granted federated KO")
    .argument("<source_ko_id>", "Federated source Knowledge Object ID")
    .requiredOption("--content-json <json>", "Derived Knowledge Object content as JSON")
    .option("--content-type <type>", "Derived Knowledge Object content type")
    .option("--ko-id <id>", "Deterministic Knowledge Object ID for harness runs")
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .option("--json", "Print raw JSON output", false)
    .action(async (sourceKoId, commandOptions) => {
      await brainDeriveCommand(
        String(sourceKoId),
        commandOptions as Parameters<typeof brainDeriveCommand>[1],
        options.brainDerive,
      );
    });

  brain
    .command(federationCliCommands.brainVerify)
    .description("Create a signed verification report for a Knowledge Object")
    .argument("<source_ko_id>", "Knowledge Object ID to verify")
    .option("--input <path>", "Original input file used by the Knowledge Object")
    .option("--schema <path>", "Dashboard schema used for deterministic reconciliation")
    .option("--ko-id <id>", "Deterministic verification Knowledge Object ID for harness runs")
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .option("--json", "Print raw JSON output", false)
    .action(async (sourceKoId, commandOptions) => {
      await brainVerifyCommand(
        String(sourceKoId),
        commandOptions as Parameters<typeof brainVerifyCommand>[1],
        options.brainVerify,
      );
    });

  program
    .command(federationCliCommands.share)
    .description("Federate a signed Knowledge Object with per-object consent")
    .argument("<ko_id>", "Knowledge Object ID or content hash")
    .option("--with <install>", "Consumer install ID")
    .option("--with-contact <name>", "Consumer contact name from the federation contacts book")
    .option("--to <url>", "Consumer /api/federation endpoint URL")
    .option("--revocation-url <url>", "Producer revocation lookup URL for consumer next-read checks")
    .option("--scope <scope>", "Consent scope: read or write; admin is reserved", "read")
    .option("--expires <duration>", "Consent expiry duration", "30d")
    .option("--revocable", "Mark the consent grant revocable", false)
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (koId, commandOptions) => {
      await shareCommand(String(koId), commandOptions as Parameters<typeof shareCommand>[1], options.share);
    });

  const contacts = program
    .command("contacts")
    .description("Federation contact address book operations");

  contacts
    .command("add")
    .description("Add or update a federation contact")
    .argument("<name>", "Contact name")
    .requiredOption("--install-id <id>", "Contact install ID")
    .requiredOption("--endpoint <url>", "Contact /api/federation endpoint URL")
    .requiredOption("--revocation-url <url>", "Contact revocation lookup URL")
    .option("--label <text>", "Human-readable label")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (name, commandOptions) => {
      await contactsAddCommand(String(name), commandOptions as Parameters<typeof contactsAddCommand>[1], options.contacts);
    });

  contacts
    .command("list")
    .description("List federation contacts")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await contactsListCommand(commandOptions as Parameters<typeof contactsListCommand>[0], options.contacts);
    });

  contacts
    .command("show")
    .description("Show a federation contact")
    .argument("<name>", "Contact name")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (name, commandOptions) => {
      await contactsShowCommand(String(name), commandOptions as Parameters<typeof contactsShowCommand>[1], options.contacts);
    });

  contacts
    .command("export")
    .description("Export this install as a signed federation contact card")
    .argument("<name>", "Contact name recipients should save")
    .requiredOption("--endpoint <url>", "This install's /api/federation endpoint URL")
    .requiredOption("--revocation-url <url>", "This install's revocation lookup URL")
    .option("--label <text>", "Human-readable label")
    .option("--out <path>", "Write the signed contact card to a file")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (name, commandOptions) => {
      await contactsExportCommand(String(name), commandOptions as Parameters<typeof contactsExportCommand>[1], options.contacts);
    });

  contacts
    .command("import")
    .description("Import and verify a signed federation contact card")
    .argument("<path>", "Path to a signed contact card JSON file")
    .option("--as <name>", "Save the contact under a local alias")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (path, commandOptions) => {
      await contactsImportCommand(String(path), commandOptions as Parameters<typeof contactsImportCommand>[1], options.contacts);
    });

  contacts
    .command("share-link")
    .description("Create a short-lived signed federation contact import link")
    .argument("<name>", "Contact name recipients should save")
    .requiredOption("--endpoint <url>", "This install's /api/federation endpoint URL")
    .requiredOption("--revocation-url <url>", "This install's revocation lookup URL")
    .option("--label <text>", "Human-readable label")
    .option("--expires <duration>", "Share link expiry duration", "15m")
    .option("--base-url <url>", "URL prefix for the share link", "stacy://contacts/import")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (name, commandOptions) => {
      await contactsShareLinkCommand(
        String(name),
        commandOptions as Parameters<typeof contactsShareLinkCommand>[1],
        options.contacts,
      );
    });

  contacts
    .command("import-link")
    .description("Import and verify a signed federation contact share link")
    .argument("<url>", "Signed contact share link")
    .option("--as <name>", "Save the contact under a local alias")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (link, commandOptions) => {
      await contactsImportLinkCommand(
        String(link),
        commandOptions as Parameters<typeof contactsImportLinkCommand>[1],
        options.contacts,
      );
    });

  program
    .command("connect")
    .description("Connect an external tool via OAuth (device-code flow)")
    .argument("<connector>", "Connector id (github)")
    .option("--client-id <id>", "OAuth client id (or set STACY_GITHUB_CLIENT_ID)")
    .option("--org <org>", "Restrict access to a single organization")
    .option("--scope <scope>", "Override the requested OAuth scope")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (connector, commandOptions) => {
      assertGithubConnector(String(connector));
      await connectGithubCommand(commandOptions as Parameters<typeof connectGithubCommand>[0], options.connect);
    });

  const connectors = program
    .command("connectors")
    .description("Manage connected external tools");

  connectors
    .command("list")
    .description("List available connectors and their connection status")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await connectorsListCommand(commandOptions as Parameters<typeof connectorsListCommand>[0], options.connectors);
    });

  connectors
    .command("status")
    .description("Show the live status of a connected tool")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await connectorsStatusCommand(commandOptions as Parameters<typeof connectorsStatusCommand>[0], options.connectors);
    });

  connectors
    .command("disconnect")
    .description("Remove a connector's stored token")
    .argument("<connector>", "Connector id (github)")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (connector, commandOptions) => {
      await connectorsDisconnectCommand(
        String(connector),
        commandOptions as Parameters<typeof connectorsDisconnectCommand>[1],
        options.connectors,
      );
    });

  program
    .command("ingest")
    .description("Ingest external-tool data as signed Knowledge Objects")
    .argument("<connector>", "Connector id (github)")
    .requiredOption("--repo <owner/name>", "Repository to ingest from")
    .option("--pulls", "Ingest pull requests (default when neither --pulls nor --issues given)", false)
    .option("--issues", "Ingest issues", false)
    .option("--state <state>", "Filter by state: open, closed, or all", "open")
    .option("--label <label>", "Only ingest objects with this label")
    .option("--since <duration>", "Only ingest objects updated since (7d, 24h, ISO date)")
    .option("--yes", "Skip the confirmation prompt (for scripting)", false)
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (connector, commandOptions) => {
      assertGithubConnector(String(connector));
      await ingestGithubCommand(commandOptions as Parameters<typeof ingestGithubCommand>[0], options.ingest);
    });

  const receipts = program
    .command("receipts")
    .description("Federation receipt log operations");

  receipts
    .command("list")
    .description("List federation receipts")
    .option("--ko <ko_id>", "Filter receipts by Knowledge Object ID")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await receiptsListCommand(commandOptions as Parameters<typeof receiptsListCommand>[0], options.receipts);
    });

  receipts
    .command("verify")
    .description("Verify the tamper-evident receipt hash chain")
    .option("--ko <ko_id>", "Filter receipts by Knowledge Object ID")
    .option("--global", "Verify the global instance receipt anchor chain", false)
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await receiptsVerifyCommand(commandOptions as Parameters<typeof receiptsVerifyCommand>[0], options.receipts);
    });

  const identity = program
    .command("identity")
    .description("Federation install identity operations");

  identity
    .command("show")
    .description("Show this install's federation identity and public key")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await identityShowCommand(
        commandOptions as Parameters<typeof identityShowCommand>[0],
        options.identity,
      );
    });

  identity
    .command("backup")
    .description("Write a private backup of this install's federation identity")
    .option("--out <path>", "Write the backup to a file (default federation-install-identity.<install>.backup.json)")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await identityBackupCommand(
        commandOptions as Parameters<typeof identityBackupCommand>[0],
        options.identity,
      );
    });

  identity
    .command("rotate")
    .description("Rotate this install's federation keypair and record a dual-signed transition")
    .option("--reason <text>", "Reason recorded in the signed key transition")
    .option("--effective-at <iso>", "ISO timestamp when the new key becomes effective")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await identityRotateCommand(
        commandOptions as Parameters<typeof identityRotateCommand>[0],
        options.identity,
      );
    });

  identity
    .command("verify-chain")
    .description("Verify the dual-signed federation install key transition chain")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (commandOptions) => {
      await identityVerifyChainCommand(
        commandOptions as Parameters<typeof identityVerifyChainCommand>[0],
        options.identity,
      );
    });

  program
    .command(federationCliCommands.revoke)
    .description("Revoke a federated Knowledge Object grant")
    .argument("<ko_id>", "Knowledge Object ID or content hash")
    .requiredOption("--reason <text>", "Revocation reason")
    .option("--grant-id <id>", "Specific consent grant id to revoke")
    .option("--json", "Print raw JSON output", false)
    .option("-c, --config <path>", "Path to config file")
    .option("--db-url <url>", "Database connection string")
    .action(async (koId, commandOptions) => {
      await revokeCommand(String(koId), commandOptions as Parameters<typeof revokeCommand>[1], options.revoke);
    });
}

export {
  brainExportCommand,
  brainImportCommand,
  connectGithubCommand,
  connectorsDisconnectCommand,
  connectorsListCommand,
  connectorsStatusCommand,
  ingestGithubCommand,
  contactsImportLinkCommand,
  contactsShareLinkCommand,
  identityBackupCommand,
  identityRotateCommand,
  identityShowCommand,
  identityVerifyChainCommand,
  agentRunCommand,
  runTaskCommand,
  type BrainExportDependencies,
  type BrainImportDependencies,
  type ConnectDependencies,
  type ConnectorsDependencies,
  type IngestDependencies,
  type IdentityDependencies,
  type AgentRunDependencies,
  type RunTaskDependencies,
};

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function assertGithubConnector(connector: string): void {
  if (connector.trim().toLowerCase() !== "github") {
    throw new Error(`Unsupported connector "${connector}". Only "github" is available in v0.2.`);
  }
}
