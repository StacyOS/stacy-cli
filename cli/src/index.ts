import { Command } from "commander";
import { onboard } from "./commands/onboard.js";
import { doctor } from "./commands/doctor.js";
import { envCommand } from "./commands/env.js";
import { configure } from "./commands/configure.js";
import { addAllowedHostname } from "./commands/allowed-hostname.js";
import { heartbeatRun } from "./commands/heartbeat-run.js";
import { runCommand } from "./commands/run.js";
import { bootstrapCeoInvite } from "./commands/auth-bootstrap-ceo.js";
import { dbBackupCommand, dbRestoreCommand } from "./commands/db-backup.js";
import { upgradeCheckCommand } from "./commands/upgrade-check.js";
import { registerEnvLabCommands } from "./commands/env-lab.js";
import { registerContextCommands } from "./commands/client/context.js";
import { registerCompanyCommands } from "./commands/client/company.js";
import { registerIssueCommands } from "./commands/client/issue.js";
import { registerAgentCommands } from "./commands/client/agent.js";
import { registerApprovalCommands } from "./commands/client/approval.js";
import { registerActivityCommands } from "./commands/client/activity.js";
import { registerDashboardCommands } from "./commands/client/dashboard.js";
import { registerRoutineCommands } from "./commands/routines.js";
import { registerFeedbackCommands } from "./commands/client/feedback.js";
import { applyDataDirOverride, type DataDirOptionLike } from "./config/data-dir.js";
import { loadStacyEnvFile } from "./config/env.js";
import { initTelemetryFromConfigFile, flushTelemetry } from "./telemetry.js";
import { registerWorktreeCommands } from "./commands/worktree.js";
import { registerPluginCommands } from "./commands/client/plugin.js";
import { registerClientAuthCommands } from "./commands/client/auth.js";
import { cliVersion } from "./version.js";
import { applyStacyEnvAliases } from "./config/env-aliases.js";
import { registerFederationCommands, runTaskCommand } from "@arpanstacy/stacy-federation/verbs";

const program = new Command();
applyStacyEnvAliases();
const DATA_DIR_OPTION_HELP =
  "Stacy data directory root (isolates state from ~/.stacy)";

program
  .name("stacy")
  .description("Stacy CLI — setup, diagnose, and configure your AI control plane")
  .version(cliVersion);

program.hook("preAction", (_thisCommand, actionCommand) => {
  const options = actionCommand.optsWithGlobals() as DataDirOptionLike;
  const optionNames = new Set(actionCommand.options.map((option) => option.attributeName()));
  applyDataDirOverride(options, {
    hasConfigOption: optionNames.has("config"),
    hasContextOption: optionNames.has("context"),
  });
  loadStacyEnvFile(options.config);
  initTelemetryFromConfigFile(options.config);
});

program
  .command("onboard")
  .description("Interactive first-run setup wizard")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
  .option("--bind <mode>", "Quickstart reachability preset (loopback, lan, tailnet)")
  .option("--federation-demo", "Show local federation demo next steps during onboarding", false)
  .option("--federation-peer-link <url>", "Import a signed federation contact share link during onboarding")
  .option("-y, --yes", "Accept quickstart defaults (trusted local loopback unless --bind is set) and start immediately", false)
  .option("--run", "Start Stacy immediately after saving config", false)
  .action(onboard);

program
  .command("doctor")
  .description("Run diagnostic checks on your Stacy setup")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
  .option("--repair", "Attempt to repair issues automatically")
  .alias("--fix")
  .option("-y, --yes", "Skip repair confirmation prompts")
  .action(async (opts) => {
    await doctor(opts);
  });

program
  .command("env")
  .description("Print environment variables for deployment")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
  .action(envCommand);

program
  .command("configure")
  .description("Update configuration sections")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
  .option("-s, --section <section>", "Section to configure (llm, database, logging, server, storage, secrets)")
  .action(configure);

program
  .command("db:backup")
  .description("Create a one-off database backup using current config")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
  .option("--dir <path>", "Backup output directory (overrides config)")
  .option("--retention-days <days>", "Retention window used for pruning", (value) => Number(value))
  .option("--filename-prefix <prefix>", "Backup filename prefix", "stacy")
  .option("--json", "Print backup metadata as JSON")
  .action(async (opts) => {
    await dbBackupCommand(opts);
  });

program
  .command("db:restore")
  .description("Restore a database backup into the current configured database")
  .argument("[backupFile]", "Backup .sql or .sql.gz file to restore")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
  .option("--file <path>", "Backup .sql or .sql.gz file to restore")
  .option("--latest", "Restore the newest backup from the configured backup directory")
  .option("--dry-run", "Resolve the restore target without applying SQL")
  .option("-y, --yes", "Skip the destructive restore confirmation prompt")
  .option("--json", "Print restore metadata as JSON")
  .action(async (backupFile, opts) => {
    await dbRestoreCommand(backupFile, opts);
  });

program
  .command("upgrade:check")
  .description("Run read-only upgrade readiness checks")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
  .option("--max-backup-age-hours <hours>", "Warn when newest backup is older than this", (value) => Number(value))
  .option("--json", "Print upgrade readiness metadata as JSON")
  .option("--strict", "Exit non-zero when warnings are found")
  .action(async (opts) => {
    await upgradeCheckCommand(opts);
  });

program
  .command("allowed-hostname")
  .description("Allow a hostname for authenticated/private mode access")
  .argument("<host>", "Hostname to allow (for example dotta-macbook-pro)")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
  .action(addAllowedHostname);

program
  .command("run")
  .description("Bootstrap local setup (onboard + doctor) and run Stacy")
  .argument("[task]", "Public federation demo task to turn into a signed Knowledge Object")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
  .option("-i, --instance <id>", "Local instance id (default: default)")
  .option("--bind <mode>", "On first run, use onboarding reachability preset (loopback, lan, tailnet)")
  .option("--repair", "Attempt automatic repairs during doctor", true)
  .option("--no-repair", "Disable automatic repairs during doctor")
  .option("--input <path>", "Input file for a public federation demo task")
  .option("--schema <path>", "Dashboard schema JSON for mapping CSV columns to widgets")
  .option("--adapter-command <command>", "Optional adapter-like command for task generation")
  .option("--adapter-arg <arg>", "Argument passed to --adapter-command; repeat for multiple args", collectOption, [])
  .option("--adapter-output <mode>", "Adapter output contract: text or json", "text")
  .option("--output-kind <kind>", "Knowledge Object content contract: dashboard, report, or table", "dashboard")
  .option("--adapter-timeout-ms <ms>", "Maximum adapter runtime before it is killed")
  .option("--redact-column <name>", "Column removed from adapter stdin; repeat or comma-separate", collectOption, [])
  .option("--ack-egress", "Acknowledge that adapter execution may send input records outside this install", false)
  .option("--ko-id <id>", "Deterministic Knowledge Object ID for demo runs")
  .option("--db-url <url>", "Database connection string")
  .option("--json", "Print raw JSON output", false)
  .action(async (task, opts) => {
    if (typeof task === "string" && task.trim()) {
      await runTaskCommand(task, opts);
      return;
    }
    await runCommand(opts);
  });

const heartbeat = program.command("heartbeat").description("Heartbeat utilities");

heartbeat
  .command("run")
  .description("Run one agent heartbeat and stream live logs")
  .requiredOption("-a, --agent-id <agentId>", "Agent ID to invoke")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
  .option("--context <path>", "Path to CLI context file")
  .option("--profile <name>", "CLI context profile name")
  .option("--api-base <url>", "Base URL for the Stacy server API")
  .option("--api-key <token>", "Bearer token for agent-authenticated calls")
  .option(
    "--source <source>",
    "Invocation source (timer | assignment | on_demand | automation)",
    "on_demand",
  )
  .option("--trigger <trigger>", "Trigger detail (manual | ping | callback | system)", "manual")
  .option("--timeout-ms <ms>", "Max time to wait before giving up", "0")
  .option("--json", "Output raw JSON where applicable")
  .option("--debug", "Show raw adapter stdout/stderr JSON chunks")
  .action(heartbeatRun);

registerContextCommands(program);
registerCompanyCommands(program);
registerIssueCommands(program);
registerAgentCommands(program);
registerApprovalCommands(program);
registerActivityCommands(program);
registerDashboardCommands(program);
registerRoutineCommands(program);
registerFeedbackCommands(program);
registerWorktreeCommands(program);
registerEnvLabCommands(program);
registerPluginCommands(program);
registerFederationCommands(program);

const auth = program.command("auth").description("Authentication and bootstrap utilities");

auth
  .command("bootstrap-ceo")
  .description("Create a one-time bootstrap invite URL for first instance admin")
  .option("-c, --config <path>", "Path to config file")
  .option("-d, --data-dir <path>", DATA_DIR_OPTION_HELP)
  .option("--force", "Create new invite even if admin already exists", false)
  .option("--expires-hours <hours>", "Invite expiration window in hours", (value) => Number(value))
  .option("--base-url <url>", "Public base URL used to print invite link")
  .action(bootstrapCeoInvite);

registerClientAuthCommands(auth);

async function main(): Promise<void> {
  let failed = false;
  try {
    await program.parseAsync();
  } catch (err) {
    failed = true;
    console.error(err instanceof Error ? err.message : String(err));
  } finally {
    await flushTelemetry();
  }

  if (failed) {
    process.exit(1);
  }
}

void main();

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}
