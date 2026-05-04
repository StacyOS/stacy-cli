#!/usr/bin/env node
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const baseUrl = (process.env.STACY_E2E_BASE_URL ?? "http://127.0.0.1:3240").replace(/\/$/, "");
const timeoutMs = Number(process.env.STACY_TODO_E2E_TIMEOUT_MS ?? 10 * 60 * 1000);
const headless = process.env.STACY_E2E_HEADLESS !== "false";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const companyName = `Todo App E2E ${stamp}`;
const goalTitle = "Create a working browser to-do app";
const taskTitle = "Build a tiny static to-do app";
const screenshotDir = process.env.STACY_QA_SCREENSHOT_DIR
  ? path.resolve(process.env.STACY_QA_SCREENSHOT_DIR)
  : path.resolve(".gstack/qa-reports/screenshots");
const workspaceDir = process.env.STACY_TODO_E2E_WORKSPACE
  ? path.resolve(process.env.STACY_TODO_E2E_WORKSPACE)
  : await fs.mkdtemp(path.join(os.tmpdir(), "stacy-todo-app-workspace-"));

const terminalRunStatuses = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function verifyGeneratedTodoApp(browser, workspaceDir, screenshotPath) {
  const appPage = await browser.newPage({ viewport: { width: 900, height: 720 } });
  const consoleErrors = [];
  const pageErrors = [];
  appPage.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  appPage.on("pageerror", (err) => pageErrors.push(err.message));

  try {
    await appPage.goto(pathToFileURL(path.join(workspaceDir, "index.html")).href, { waitUntil: "load" });

    const input = appPage.locator('input[type="text"], input:not([type]), textarea').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("Buy milk");

    const addButton = appPage.getByRole("button", { name: /add/i }).first();
    if (await addButton.count()) {
      await addButton.click();
    } else {
      await input.press("Enter");
    }

    await expect(appPage.getByText("Buy milk")).toBeVisible({ timeout: 10_000 });

    const checkbox = appPage.locator('input[type="checkbox"]').first();
    await expect(checkbox).toBeVisible({ timeout: 10_000 });
    await checkbox.check();
    await expect(checkbox).toBeChecked();

    await appPage.reload({ waitUntil: "load" });
    await expect(appPage.getByText("Buy milk")).toBeVisible({ timeout: 10_000 });
    await expect(appPage.locator('input[type="checkbox"]').first()).toBeChecked();

    const deleteButton = appPage.getByRole("button", { name: /delete|remove/i }).first();
    await expect(deleteButton).toBeVisible({ timeout: 10_000 });
    await deleteButton.click();
    await expect(appPage.getByText("Buy milk")).toHaveCount(0);

    await appPage.reload({ waitUntil: "load" });
    await expect(appPage.getByText("Buy milk")).toHaveCount(0);
    await appPage.screenshot({ path: screenshotPath, fullPage: true });

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(`Generated to-do app emitted browser errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
    }

    return {
      addedTask: true,
      toggledTask: true,
      persistedAfterReload: true,
      deletedTask: true,
      stayedDeletedAfterReload: true,
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
    const screenshotPath = path.join(screenshotDir, `todo-e2e-${stamp}-generated-app.png`);
    const todoApp = await verifyGeneratedTodoApp(browser, workspaceDir, screenshotPath);
    console.log(JSON.stringify({ ok: true, workspaceDir, screenshotPath, todoApp }, null, 2));
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
    todoApp: null,
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

  async function latestIssue() {
    return api("GET", `/issues/${encodeURIComponent(report.ids.issueId)}`);
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
    report.screenshots.home = path.join(screenshotDir, `todo-e2e-${stamp}-home.png`);
    await page.screenshot({ path: report.screenshots.home, fullPage: true });

    const company = await api("POST", "/companies", { name: companyName });
    report.ids.companyId = company.id;
    report.ids.companyPrefix = company.issuePrefix;

    const goal = await api("POST", `/companies/${encodeURIComponent(company.id)}/goals`, {
      title: goalTitle,
      description: "End-to-end QA goal: create a small, usable static to-do application and verify it as complete.",
      level: "company",
      status: "active",
    });
    report.ids.goalId = goal.id;

    const hire = await api("POST", `/companies/${encodeURIComponent(company.id)}/agent-hires`, {
      name: "Codex Engineer",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {
        model: "gpt-5.3-codex",
        timeoutSec: 600,
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
        decisionNote: "Approved by todo-app E2E QA.",
      });
      agent = await api("GET", `/agents/${encodeURIComponent(agent.id)}?companyId=${encodeURIComponent(company.id)}`);
    }
    report.ids.agentId = agent.id;

    const project = await api("POST", `/companies/${encodeURIComponent(company.id)}/projects`, {
      name: "Todo App",
      status: "in_progress",
      goalIds: [goal.id],
      workspace: {
        name: "Todo App Workspace",
        sourceType: "local_path",
        cwd: workspaceDir,
        isPrimary: true,
      },
    });
    report.ids.projectId = project.id;

    const issue = await api("POST", `/companies/${encodeURIComponent(company.id)}/issues`, {
      title: taskTitle,
      description: [
        "Create a tiny static browser to-do app in the current workspace.",
        "",
        "Acceptance criteria:",
        "- Create index.html, styles.css, and app.js.",
        "- Users can add tasks, toggle tasks complete, delete tasks, and persist tasks in localStorage.",
        "- Keep the implementation dependency-free and small.",
        "- Verify the files exist before finishing.",
        "- When finished, PATCH /api/issues/$STACY_TASK_ID using Authorization: Bearer $STACY_API_KEY and X-Stacy-Run-Id: $STACY_RUN_ID with status=done and a concise completion comment.",
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
    report.screenshots.issueOpened = path.join(screenshotDir, `todo-e2e-${stamp}-issue-opened.png`);
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
          reason: "todo_app_e2e_manual_safety_wakeup",
          payload: { issueId: issue.id, taskId: issue.id, taskKey: issue.id },
          idempotencyKey: `todo-app-e2e:${issue.id}`,
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
      const log = await api("GET", `/heartbeat-runs/${encodeURIComponent(run.id)}/log?limitBytes=12000`);
      throw new Error(`Run ${run.id} ended ${run.status}. Log preview:\n${log.text ?? log.chunk ?? JSON.stringify(log).slice(0, 4000)}`);
    }

    const log = await api("GET", `/heartbeat-runs/${encodeURIComponent(run.id)}/log?limitBytes=20000`);
    report.run.logPreview = (log.text ?? log.chunk ?? JSON.stringify(log)).slice(0, 2000);
    report.run.events = await api("GET", `/heartbeat-runs/${encodeURIComponent(run.id)}/events?limit=50`);

    const completedIssue = await latestIssue();
    report.issue = {
      id: completedIssue.id,
      identifier: completedIssue.identifier,
      status: completedIssue.status,
      title: completedIssue.title,
    };
    if (completedIssue.status !== "done") {
      throw new Error(`Issue ${completedIssue.identifier ?? completedIssue.id} is ${completedIssue.status}, expected done.`);
    }

    const requiredFiles = ["index.html", "styles.css", "app.js"];
    const files = await Promise.all(requiredFiles.map(async (file) => {
      const filePath = path.join(workspaceDir, file);
      const stat = await fs.stat(filePath).catch(() => null);
      return { file, path: filePath, size: stat?.size ?? 0, exists: Boolean(stat?.isFile()) };
    }));
    report.files = files;
    const missing = files.filter((file) => !file.exists || file.size <= 0);
    if (missing.length > 0) {
      throw new Error(`Missing or empty to-do app files: ${missing.map((file) => file.file).join(", ")}`);
    }

    report.screenshots.generatedApp = path.join(screenshotDir, `todo-e2e-${stamp}-generated-app.png`);
    report.todoApp = await verifyGeneratedTodoApp(browser, workspaceDir, report.screenshots.generatedApp);

    await page.reload({ waitUntil: "networkidle" });
    report.screenshots.issueDone = path.join(screenshotDir, `todo-e2e-${stamp}-issue-done.png`);
    await page.screenshot({ path: report.screenshots.issueDone, fullPage: true });

    console.log(JSON.stringify({ ok: true, report }, null, 2));
  } finally {
    await browser.close();
  }
}

const entrypoint = process.env.STACY_TODO_E2E_VERIFY_WORKSPACE_ONLY === "1" ? verifyWorkspaceOnly : main;
entrypoint().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
