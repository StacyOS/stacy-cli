#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(repoRoot, "packages", "stacy-cli");
const packagePath = path.join(packageDir, "package.json");
const npmCache = process.env.npm_config_cache || path.join(os.tmpdir(), "stacy-npm-cache");
let tempNpmUserConfigDir = "";
let tempPublishDir = "";

function usage() {
  console.log([
    "Usage:",
    "  node scripts/publish-stacy-cli.mjs [--status] [--publish] [--otp <code>] [--deprecate-old <version>] [--replacement-version <version>] [--deprecate-only] [--skip-smoke]",
    "",
    "Default mode is a dry run. Add --publish for the real npm publish.",
    "Set NPM_TOKEN or NODE_AUTH_TOKEN to use a granular npm token with 2FA bypass.",
    "",
    "Examples:",
    "  pnpm release:stacy-cli -- --status",
    "  pnpm release:stacy-cli",
    "  pnpm release:stacy-cli -- --publish --otp 123456",
    "  pnpm release:stacy-cli -- --publish --otp 123456 --deprecate-old 0.3.1",
    "  pnpm release:stacy-cli -- --deprecate-only --deprecate-old 0.3.1 --replacement-version 2026.501.0 --otp 123456",
  ].join("\n"));
}

function parseArgs(args) {
  const options = {
    publish: false,
    status: false,
    otp: process.env.NPM_CONFIG_OTP || process.env.npm_config_otp || "",
    deprecateOld: "",
    replacementVersion: "",
    deprecateOnly: false,
    skipSmoke: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--publish") {
      options.publish = true;
      continue;
    }
    if (arg === "--status") {
      options.status = true;
      continue;
    }
    if (arg === "--otp") {
      options.otp = args[++index] ?? "";
      if (!options.otp) throw new Error("--otp requires a one-time password.");
      continue;
    }
    if (arg === "--deprecate-old") {
      options.deprecateOld = args[++index] ?? "";
      if (!options.deprecateOld) throw new Error("--deprecate-old requires a version.");
      continue;
    }
    if (arg === "--replacement-version") {
      options.replacementVersion = args[++index] ?? "";
      if (!options.replacementVersion) throw new Error("--replacement-version requires a version.");
      continue;
    }
    if (arg === "--deprecate-only") {
      options.deprecateOnly = true;
      continue;
    }
    if (arg === "--skip-smoke") {
      options.skipSmoke = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  return options;
}

function commandEnv() {
  const env = {
    ...process.env,
    npm_config_cache: npmCache,
  };

  const hasUserConfig = Boolean(env.npm_config_userconfig || env.NPM_CONFIG_USERCONFIG);
  const token = env.NPM_TOKEN || env.NODE_AUTH_TOKEN || "";
  if (/[<>]/.test(token)) {
    throw new Error("NPM_TOKEN/NODE_AUTH_TOKEN must be the raw npm token value, without angle brackets.");
  }
  if (token && !hasUserConfig) {
    tempNpmUserConfigDir ||= mkdtempSync(path.join(os.tmpdir(), "stacy-npm-userconfig-"));
    const userConfigPath = path.join(tempNpmUserConfigDir, ".npmrc");
    writeFileSync(
      userConfigPath,
      [
        "registry=https://registry.npmjs.org/",
        "//registry.npmjs.org/:_authToken=${NPM_TOKEN}",
        "always-auth=true",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    env.NPM_TOKEN = token;
    env.npm_config_userconfig = userConfigPath;
  }

  if (token) {
    env.NODE_AUTH_TOKEN = token;
  }

  return {
    ...env,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 60_000,
    env: commandEnv(),
  });

  if (options.allowFailure) return result;

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${output ? `:\n${output}` : ""}`);
  }

  return result;
}

function npmJson(args, label) {
  const result = run("npm", args, { timeout: 30_000 });
  const trimmed = result.stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function packageVersionExists(packageName, version) {
  const result = run("npm", ["view", `${packageName}@${version}`, "version", "--json"], {
    timeout: 30_000,
    allowFailure: true,
  });

  if (result.status !== 0) return false;
  try {
    return JSON.parse(result.stdout.trim()) === version;
  } catch {
    return false;
  }
}

function packageDeprecatedMessage(packageName, version) {
  const result = run("npm", ["view", `${packageName}@${version}`, "deprecated", "--json"], {
    timeout: 30_000,
    allowFailure: true,
  });

  if (result.status !== 0) return "";
  const trimmed = result.stdout.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
}

function printStatus(pkg, paperclipVersion) {
  const live = npmJson(
    ["view", "stacy-cli", "versions", "dist-tags", "dependencies", "--json"],
    "stacy-cli registry status",
  );
  const versions = Array.isArray(live?.versions) ? live.versions : [];
  const latest = live?.["dist-tags"]?.latest ?? "unknown";
  const latestPaperclip = live?.dependencies?.paperclipai ?? "unknown";
  const targetIsLive = versions.includes(pkg.version);
  const oldVersion = "0.3.1";
  const oldIsLive = versions.includes(oldVersion);
  const oldDeprecated = oldIsLive ? packageDeprecatedMessage("stacy-cli", oldVersion) : "";

  console.log(`local wrapper: stacy-cli@${pkg.version} -> paperclipai@${paperclipVersion}`);
  console.log(`npm latest:    stacy-cli@${latest} -> paperclipai@${latestPaperclip}`);
  console.log(`target live:   ${targetIsLive ? "yes" : "no"}`);
  if (oldIsLive) {
    console.log(`old wrapper:   stacy-cli@${oldVersion} ${oldDeprecated ? "deprecated" : "active"}`);
  }

  if (targetIsLive) {
    console.log(`next smoke:    pnpm smoke:stacy-cli-npm -- --version ${pkg.version} --expected-paperclip ${paperclipVersion}`);
    if (!oldDeprecated && oldVersion !== pkg.version) {
      console.log(`next deprecate: pnpm release:stacy-cli:deprecate-old -- --replacement-version ${pkg.version} --otp <code>`);
      console.log("token path:    set NPM_TOKEN or NODE_AUTH_TOKEN, then run pnpm release:stacy-cli:deprecate-old");
    }
  } else {
    console.log("next publish:  pnpm release:stacy-cli:publish -- --otp <code>");
    console.log("token path:    set NPM_TOKEN or NODE_AUTH_TOKEN, then run pnpm release:stacy-cli:publish");
  }
}

function resolvePaperclipPublishVersion(pkg) {
  const paperclipVersion = pkg.dependencies?.paperclipai;
  if (!paperclipVersion || typeof paperclipVersion !== "string") {
    throw new Error("stacy-cli must depend on paperclipai.");
  }
  if (paperclipVersion.startsWith("workspace:")) {
    return pkg.version;
  }
  if (paperclipVersion !== pkg.version) {
    throw new Error(`stacy-cli@${pkg.version} must wrap matching paperclipai@${pkg.version}; found ${paperclipVersion}.`);
  }
  return paperclipVersion;
}

function stagePublishPackage(pkg, paperclipVersion) {
  tempPublishDir ||= mkdtempSync(path.join(os.tmpdir(), "stacy-cli-publish-"));
  cpSync(path.join(packageDir, "bin"), path.join(tempPublishDir, "bin"), { recursive: true });
  cpSync(path.join(packageDir, "README.md"), path.join(tempPublishDir, "README.md"));

  const publishPkg = {
    ...pkg,
    dependencies: {
      ...(pkg.dependencies ?? {}),
      paperclipai: paperclipVersion,
    },
  };
  writeFileSync(path.join(tempPublishDir, "package.json"), `${JSON.stringify(publishPkg, null, 2)}\n`);
  return tempPublishDir;
}

function publishArgs(options, dryRun) {
  const args = ["publish", "--access", "public"];
  if (dryRun) args.push("--dry-run");
  if (options.otp) args.push("--otp", options.otp);
  return args;
}

function deprecateArgs(version, replacementVersion, options) {
  const message = `Reserved package name only; use stacy-cli@${replacementVersion} or newer.`;
  const args = ["deprecate", `stacy-cli@${version}`, message];
  if (options.otp) args.push("--otp", options.otp);
  return args;
}

function withOtpHint(error, action) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("NPM_TOKEN") || message.includes("NODE_AUTH_TOKEN")) return message;
  return [
    message,
    "",
    `${action} may require npm 2FA. Re-run with --otp <code>, or set NPM_TOKEN/NODE_AUTH_TOKEN to a granular npm token with 2FA bypass enabled.`,
  ].join("\n");
}

let exitCode = 0;

try {
  const options = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));

  if (options.deprecateOnly && !options.deprecateOld) {
    throw new Error("--deprecate-only requires --deprecate-old <version>.");
  }
  if (options.deprecateOnly && options.publish) {
    throw new Error("--deprecate-only cannot be combined with --publish.");
  }

  if (pkg.name !== "stacy-cli") {
    throw new Error(`Expected package name stacy-cli, found ${pkg.name}.`);
  }
  if (!pkg.version || typeof pkg.version !== "string") {
    throw new Error("packages/stacy-cli/package.json must define a string version.");
  }
  const paperclipVersion = resolvePaperclipPublishVersion(pkg);

  const paperclipResolved = npmJson(
    ["view", `paperclipai@${paperclipVersion}`, "version", "--json"],
    `paperclipai@${paperclipVersion}`,
  );
  if (paperclipResolved !== paperclipVersion) {
    throw new Error(`paperclipai@${paperclipVersion} is not available on npm.`);
  }

  if (options.status) {
    printStatus(pkg, paperclipVersion);
    console.log("PASS: stacy-cli release status checked.");
  } else {
    const requiresAuth = options.publish || Boolean(options.deprecateOld);
    const whoami = run("npm", ["whoami"], { timeout: 30_000, allowFailure: !requiresAuth });
    if (whoami.status === 0) {
      console.log(`npm user: ${whoami.stdout.trim()}`);
    } else if (requiresAuth) {
      const output = [whoami.stdout, whoami.stderr].filter(Boolean).join("\n").trim();
      throw new Error(
        [
          "npm authentication is required for publish/deprecate actions.",
          output,
          "Re-run with --otp <code>, or set NPM_TOKEN/NODE_AUTH_TOKEN to a granular npm token with 2FA bypass enabled.",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } else {
      console.log("npm user: unauthenticated (continuing dry-run only)");
    }

    const replacementVersion = options.replacementVersion || pkg.version;
    const alreadyPublished = options.deprecateOnly ? false : packageVersionExists("stacy-cli", pkg.version);
    if (!options.deprecateOnly) {
      if (alreadyPublished) {
        console.log(`stacy-cli@${pkg.version} is already published; skipping publish.`);
      } else {
        const publishDir = stagePublishPackage(pkg, paperclipVersion);
        console.log(`==> Dry-running stacy-cli@${pkg.version}`);
        run("npm", publishArgs(options, true), { cwd: publishDir, inherit: true, timeout: 120_000 });

        if (options.publish) {
          console.log(`==> Publishing stacy-cli@${pkg.version}`);
          try {
            run("npm", publishArgs(options, false), { cwd: publishDir, inherit: true, timeout: 120_000 });
          } catch (error) {
            throw new Error(withOtpHint(error, "Publishing stacy-cli"));
          }
        } else {
          console.log("Dry run only. Re-run with --publish to publish for real.");
        }
      }
    }

    if (!options.skipSmoke && (options.publish || alreadyPublished)) {
      console.log(`==> Running npm smoke for stacy-cli@${pkg.version}`);
      run(
        "pnpm",
        [
          "smoke:stacy-cli-npm",
          "--",
          "--version",
          pkg.version,
          "--expected-paperclip",
          paperclipVersion,
        ],
        { inherit: true, timeout: 240_000 },
      );
    }

    if (options.deprecateOld) {
      const replacementIsLive =
        replacementVersion === pkg.version
          ? options.publish || alreadyPublished || packageVersionExists("stacy-cli", replacementVersion)
          : packageVersionExists("stacy-cli", replacementVersion);

      if (!replacementIsLive) {
        throw new Error(`--deprecate-old requires stacy-cli@${replacementVersion} to be published first.`);
      }
      console.log(`==> Deprecating stacy-cli@${options.deprecateOld}`);
      try {
        run("npm", deprecateArgs(options.deprecateOld, replacementVersion, options), { inherit: true, timeout: 60_000 });
      } catch (error) {
        throw new Error(withOtpHint(error, "Deprecating the old stacy-cli wrapper"));
      }
    }

    console.log("PASS: stacy-cli release helper completed.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  if (tempNpmUserConfigDir) {
    rmSync(tempNpmUserConfigDir, { force: true, recursive: true });
  }
  if (tempPublishDir) {
    rmSync(tempPublishDir, { force: true, recursive: true });
  }
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
