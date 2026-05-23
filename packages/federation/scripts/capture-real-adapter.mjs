import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const defaultFixture = resolve(
  scriptDir,
  "../test/fixtures/adapter-runs/referral-packet-claude.json",
);

const command = process.env.STACY_PUBLIC_DEMO_ADAPTER?.trim();
const args = parseArgs(process.env.STACY_PUBLIC_DEMO_ADAPTER_ARGS);
const outPath = resolve(repoRoot, process.argv[2] ?? defaultFixture);

if (!command) {
  console.error("STACY_PUBLIC_DEMO_ADAPTER is required to capture a real adapter fixture.");
  process.exit(1);
}

const adapterInput = {
  task: "Create a referral packet for specialist review.",
  outputKind: "referral_packet",
  redactedColumns: [],
  input: {
    fileName: "referral-packet.csv",
    contentHash: "sha256:fixture-input-capture",
    rows: 1,
    columns: [
      "patient_ref",
      "referral_reason",
      "clinical_summary",
      "lab_snapshot",
      "medications",
      "imaging_status",
      "consent_expires",
      "revocation_reason",
    ],
    records: [
      {
        patient_ref: "N.P.",
        referral_reason: "Second opinion after abnormal ECG",
        clinical_summary:
          "Patient N.P. reports intermittent chest tightness with elevated LDL and family history of coronary artery disease.",
        lab_snapshot: "LDL 162 mg/dL; hs-CRP 4.8 mg/L; troponin negative",
        medications: "Atorvastatin 20mg; aspirin 81mg pending specialist review",
        imaging_status: "ECG attached; echocardiogram scheduled",
        consent_expires: "2026-06-22T23:59:59Z",
        revocation_reason: "Patient withdrew consent",
      },
    ],
  },
};

const stdout = await runAdapter(command, args, JSON.stringify(adapterInput, null, 2));
const parsed = JSON.parse(stdout);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
console.log(`Captured adapter fixture: ${outPath}`);

function parseArgs(raw) {
  if (!raw?.trim()) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error("STACY_PUBLIC_DEMO_ADAPTER_ARGS must be a JSON array of strings.");
  }
  return parsed;
}

function runAdapter(commandToRun, argsToRun, stdin) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(commandToRun, argsToRun, {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error("Adapter capture timed out after 60000ms."));
    }, 60_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveRun(stdout.trim());
        return;
      }
      rejectRun(new Error(`Adapter exited with code ${code ?? "unknown"}: ${stderr.trim()}`));
    });
    child.stdin.end(stdin);
  });
}
