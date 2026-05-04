#!/usr/bin/env node
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const baseUrl = (process.env.STACY_E2E_BASE_URL ?? "http://127.0.0.1:3241").replace(/\/$/, "");
const timeoutMs = Number(process.env.STACY_COMPLEX_E2E_TIMEOUT_MS ?? 15 * 60 * 1000);
const headless = process.env.STACY_E2E_HEADLESS !== "false";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const companyName = `Complex App E2E ${stamp}`;
const goalTitle = "Create a complex browser operations app";
const taskTitle = "Build a static client operations command center";
const screenshotDir = process.env.STACY_QA_SCREENSHOT_DIR
  ? path.resolve(process.env.STACY_QA_SCREENSHOT_DIR)
  : path.resolve(".gstack/qa-reports/screenshots");
const workspaceDir = process.env.STACY_COMPLEX_E2E_WORKSPACE
  ? path.resolve(process.env.STACY_COMPLEX_E2E_WORKSPACE)
  : await fs.mkdtemp(path.join(os.tmpdir(), "stacy-complex-app-workspace-"));

const terminalRunStatuses = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function expectCountGreaterThan(locator, minimum, message) {
  await expect.poll(async () => locator.count(), { message }).toBeGreaterThan(minimum);
}

async function verifyGeneratedComplexApp(browser, workspaceDir, screenshotPath) {
  const appPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  appPage.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  appPage.on("pageerror", (err) => pageErrors.push(err.message));

  const cardFor = (name) => appPage.locator('[data-testid="client-card"]').filter({ hasText: name }).first();
  const metric = (testId) => appPage.locator(`[data-testid="${testId}"]`).first();

  try {
    await appPage.goto(pathToFileURL(path.join(workspaceDir, "index.html")).href, { waitUntil: "load" });
    await expect(appPage.locator('[data-testid="app-shell"]')).toBeVisible({ timeout: 10_000 });
    await expectCountGreaterThan(appPage.locator('[data-testid="client-card"]'), 2, "seed clients should render");
    await expect(metric("total-budget")).toContainText(/\d/);
    await expect(metric("active-count")).toContainText(/\d/);
    await expect(metric("blocked-count")).toContainText(/\d/);

    const search = appPage.locator('[data-testid="search-input"]').first();
    await search.fill("Atlas");
    await expect(cardFor("Atlas")).toBeVisible({ timeout: 10_000 });
    await search.fill("");

    const filter = appPage.locator('[data-testid="status-filter"]').first();
    await filter.selectOption("blocked");
    await expectCountGreaterThan(appPage.locator('[data-testid="client-card"]'), 0, "blocked filter should show at least one client");
    await filter.selectOption("all");

    await appPage.locator('[data-testid="client-name"]').fill("Apollo Labs");
    await appPage.locator('[data-testid="client-budget"]').fill("42000");
    await appPage.locator('[data-testid="client-owner"]').fill("Stacey");
    await appPage.locator('[data-testid="client-status"]').selectOption("active");
    await appPage.locator('[data-testid="client-note"]').fill("Ship a launch readiness plan with owner follow-up.");
    await appPage.locator('[data-testid="add-client"]').click();

    const apollo = cardFor("Apollo Labs");
    await expect(apollo).toBeVisible({ timeout: 10_000 });
    await expect(apollo).toContainText("Stacey");
    await expect(metric("total-budget")).toContainText(/\d/);

    await apollo.locator('[data-testid="move-blocked"]').click();
    await expect(apollo).toContainText(/blocked/i);

    await appPage.reload({ waitUntil: "load" });
    await expect(cardFor("Apollo Labs")).toBeVisible({ timeout: 10_000 });
    await expect(cardFor("Apollo Labs")).toContainText(/blocked/i);

    await appPage.locator('[data-testid="search-input"]').fill("Apollo");
    await expect(appPage.locator('[data-testid="client-card"]')).toHaveCount(1);
    await appPage.locator('[data-testid="search-input"]').fill("");

    await cardFor("Apollo Labs").locator('[data-testid="move-done"]').click();
    await expect(cardFor("Apollo Labs")).toContainText(/done/i);
    await appPage.locator('[data-testid="status-filter"]').selectOption("done");
    await expect(cardFor("Apollo Labs")).toBeVisible({ timeout: 10_000 });

    await appPage.locator('[data-testid="status-filter"]').selectOption("all");
    await cardFor("Apollo Labs").locator('[data-testid="delete-client"]').click();
    await expect(cardFor("Apollo Labs")).toHaveCount(0);
    await appPage.reload({ waitUntil: "load" });
    await expect(cardFor("Apollo Labs")).toHaveCount(0);
    await expect(appPage.locator('[data-testid="activity-log"]')).toBeVisible();

    await appPage.screenshot({ path: screenshotPath, fullPage: true });
    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(`Generated complex app emitted browser errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
    }

    return {
      loadedSeedData: true,
      searchWorks: true,
      filterWorks: true,
      createClientWorks: true,
      statusTransitionsWork: true,
      persistenceWorks: true,
      deleteWorks: true,
      consoleErrors,
      pageErrors,
    };
  } finally {
    await appPage.close();
  }
}

async function verifyWorkspaceOnly() {
  await fs.mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless });
  try {
    const screenshotPath = path.join(screenshotDir, `complex-e2e-${stamp}-generated-app.png`);
    const complexApp = await verifyGeneratedComplexApp(browser, workspaceDir, screenshotPath);
    console.log(JSON.stringify({ ok: true, workspaceDir, screenshotPath, complexApp }, null, 2));
  } finally {
    await browser.close();
  }
}

async function main() {
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  const report = {
    baseUrl,
    companyName,
    goalTitle,
    taskTitle,
    workspaceDir,
    screenshots: {},
    ids: {},
    manualWakeupUsed: false,
    run: null,
    issue: null,
    files: [],
    consoleErrors,
    pageErrors,
    complexApp: null,
  };

  async function api(method, apiPath, data) {
    const response = await page.request.fetch(`${baseUrl}/api${apiPath}`, {
      method,
      data,
      headers: data === undefined ? undefined : { "Content-Type": "application/json" },
    });
    if (!response.ok()) {
      throw new Error(`${method} ${apiPath} -> ${response.status()}: ${await response.text()}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function findRunForIssue() {
    const runs = await api(
      "GET",
      `/companies/${encodeURIComponent(report.ids.companyId)}/heartbeat-runs?agentId=${encodeURIComponent(report.ids.agentId)}&limit=50`,
    );
    return runs.find((run) => {
      const context = run.contextSnapshot && typeof run.contextSnapshot === "object" ? run.contextSnapshot : {};
      return context.issueId === report.ids.issueId || context.taskId === report.ids.issueId;
    }) ?? runs[0] ?? null;
  }

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await expect(page.getByText("New Issue").or(page.getByText("Name your company"))).toBeVisible({ timeout: 30_000 });
    report.screenshots.home = path.join(screenshotDir, `complex-e2e-${stamp}-home.png`);
    await page.screenshot({ path: report.screenshots.home, fullPage: true });

    const company = await api("POST", "/companies", { name: companyName });
    report.ids.companyId = company.id;
    report.ids.companyPrefix = company.issuePrefix;

    const goal = await api("POST", `/companies/${encodeURIComponent(company.id)}/goals`, {
      title: goalTitle,
      description: "Stress QA goal: create a multi-section browser app and prove persistence, filtering, mutation, and completion.",
      level: "company",
      status: "active",
    });
    report.ids.goalId = goal.id;

    const hire = await api("POST", `/companies/${encodeURIComponent(company.id)}/agent-hires`, {
      name: "Codex Product Engineer",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {
        model: "gpt-5.3-codex",
        timeoutSec: 900,
        graceSec: 15,
        dangerouslyBypassApprovalsAndSandbox: true,
        skipGitRepoCheck: true,
      },
      runtimeConfig: {
        heartbeat: {
          enabled: false,
          intervalSec: 300,
          wakeOnDemand: true,
          cooldownSec: 10,
          maxConcurrentRuns: 5,
        },
      },
    });
    let agent = hire.agent;
    if (hire.approval) {
      await api("POST", `/approvals/${encodeURIComponent(hire.approval.id)}/approve`, {
        decisionNote: "Approved by complex-app E2E QA.",
      });
      agent = await api("GET", `/agents/${encodeURIComponent(agent.id)}?companyId=${encodeURIComponent(company.id)}`);
    }
    report.ids.agentId = agent.id;

    const project = await api("POST", `/companies/${encodeURIComponent(company.id)}/projects`, {
      name: "Complex Ops App",
      status: "in_progress",
      goalIds: [goal.id],
      workspace: {
        name: "Complex Ops App Workspace",
        sourceType: "local_path",
        cwd: workspaceDir,
        isPrimary: true,
      },
    });
    report.ids.projectId = project.id;

    const issue = await api("POST", `/companies/${encodeURIComponent(company.id)}/issues`, {
      title: taskTitle,
      description: [
        "Create a dependency-free static browser app named Stacy Client Ops Command Center in the current workspace.",
        "",
        "Required files:",
        "- index.html",
        "- styles.css",
        "- app.js",
        "- README.md",
        "",
        "Functional acceptance criteria:",
        "- The app has seeded clients, including one named Atlas.",
        "- It has dashboard metrics for active, blocked, done, and total budget.",
        "- Users can add a client with name, owner, budget, status, and note.",
        "- Users can search by name/owner/note.",
        "- Users can filter by all/active/blocked/done.",
        "- Users can move a client to blocked and done.",
        "- Users can delete a client.",
        "- All client data persists in localStorage across reloads.",
        "- Include a visible activity log.",
        "- Keep the implementation dependency-free and small.",
        "",
        "Automation contract: include these exact data-testid attributes so QA can verify it:",
        "- app-shell",
        "- search-input",
        "- status-filter",
        "- client-form",
        "- client-name",
        "- client-owner",
        "- client-budget",
        "- client-status",
        "- client-note",
        "- add-client",
        "- client-list",
        "- client-card on every client card",
        "- move-blocked inside each card",
        "- move-done inside each card",
        "- delete-client inside each card",
        "- total-budget",
        "- active-count",
        "- blocked-count",
        "- done-count",
        "- activity-log",
        "",
        "When finished, PATCH /api/issues/$STACY_TASK_ID using Authorization: Bearer $STACY_API_KEY and X-Stacy-Run-Id: $STACY_RUN_ID with status=done and a concise completion comment.",
      ].join("\n"),
      assigneeAgentId: agent.id,
      projectId: project.id,
      goalId: goal.id,
      status: "todo",
    });
    report.ids.issueId = issue.id;
    report.ids.issueIdentifier = issue.identifier;

    const issuePath = `/${encodeURIComponent(company.issuePrefix)}/issues/${encodeURIComponent(issue.identifier ?? issue.id)}`;
    await page.goto(`${baseUrl}${issuePath}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: taskTitle })).toBeVisible({ timeout: 30_000 });
    report.screenshots.issueOpened = path.join(screenshotDir, `complex-e2e-${stamp}-issue-opened.png`);
    await page.screenshot({ path: report.screenshots.issueOpened, fullPage: true });

    let run = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      run = await findRunForIssue();
      if (run && terminalRunStatuses.has(run.status)) break;
      if (!run && !report.manualWakeupUsed && Date.now() - startedAt > 45_000) {
        await api("POST", `/agents/${encodeURIComponent(agent.id)}/wakeup`, {
          source: "on_demand",
          triggerDetail: "manual",
          reason: "complex_app_e2e_manual_safety_wakeup",
          payload: { issueId: issue.id, taskId: issue.id, taskKey: issue.id },
          idempotencyKey: `complex-app-e2e:${issue.id}`,
          forceFreshSession: true,
        });
        report.manualWakeupUsed = true;
      }
      await sleep(5_000);
    }

    if (!run) throw new Error(`No heartbeat run appeared for issue ${issue.id}`);
    report.run = {
      id: run.id,
      status: run.status,
      logBytes: run.logBytes ?? null,
      costUsd: run.costUsd ?? null,
      costCents: run.costCents ?? null,
      issueId: run.contextSnapshot?.issueId ?? null,
    };
    if (run.status !== "succeeded") {
      const log = await api("GET", `/heartbeat-runs/${encodeURIComponent(run.id)}/log?limitBytes=16000`);
      throw new Error(`Run ${run.id} ended ${run.status}. Log preview:\n${log.text ?? log.chunk ?? JSON.stringify(log).slice(0, 5000)}`);
    }

    const log = await api("GET", `/heartbeat-runs/${encodeURIComponent(run.id)}/log?limitBytes=20000`);
    report.run.logPreview = (log.text ?? log.chunk ?? JSON.stringify(log)).slice(0, 2000);
    report.run.events = await api("GET", `/heartbeat-runs/${encodeURIComponent(run.id)}/events?limit=50`);

    const completedIssue = await api("GET", `/issues/${encodeURIComponent(report.ids.issueId)}`);
    report.issue = {
      id: completedIssue.id,
      identifier: completedIssue.identifier,
      status: completedIssue.status,
      title: completedIssue.title,
    };
    if (completedIssue.status !== "done") {
      throw new Error(`Issue ${completedIssue.identifier ?? completedIssue.id} is ${completedIssue.status}, expected done.`);
    }

    const requiredFiles = ["index.html", "styles.css", "app.js", "README.md"];
    const files = await Promise.all(requiredFiles.map(async (file) => {
      const filePath = path.join(workspaceDir, file);
      const stat = await fs.stat(filePath).catch(() => null);
      return { file, path: filePath, size: stat?.size ?? 0, exists: Boolean(stat?.isFile()) };
    }));
    report.files = files;
    const missing = files.filter((file) => !file.exists || file.size <= 0);
    if (missing.length > 0) {
      throw new Error(`Missing or empty complex app files: ${missing.map((file) => file.file).join(", ")}`);
    }

    report.screenshots.generatedApp = path.join(screenshotDir, `complex-e2e-${stamp}-generated-app.png`);
    report.complexApp = await verifyGeneratedComplexApp(browser, workspaceDir, report.screenshots.generatedApp);

    await page.reload({ waitUntil: "networkidle" });
    report.screenshots.issueDone = path.join(screenshotDir, `complex-e2e-${stamp}-issue-done.png`);
    await page.screenshot({ path: report.screenshots.issueDone, fullPage: true });

    console.log(JSON.stringify({ ok: true, report }, null, 2));
  } finally {
    await browser.close();
  }
}

const entrypoint = process.env.STACY_COMPLEX_E2E_VERIFY_WORKSPACE_ONLY === "1" ? verifyWorkspaceOnly : main;
entrypoint().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
