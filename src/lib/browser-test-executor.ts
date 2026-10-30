import type { Page } from "playwright";
import type { AutomationPlan, TestCase } from "./test-generator-schema";

export type AssertionResult = {
  action: string;
  status: "PASSED" | "FAILED";
  detail: string;
};

export type CaseExecutionResult = {
  id: string;
  title: string;
  status: "PASSED" | "FAILED" | "MANUAL" | "BLOCKED";
  reason: string | null;
  assertions: AssertionResult[];
  screenshot: string | null;
};

export type PageDiagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  httpFailures: string[];
};

const ACTION_TIMEOUT_MS = 5_000;
const MAX_DIAGNOSTICS = 30;
const MAX_DIAGNOSTIC_LENGTH = 500;

function addBounded(target: string[], value: string): void {
  if (target.length >= MAX_DIAGNOSTICS) return;
  target.push(value.slice(0, MAX_DIAGNOSTIC_LENGTH));
}

export function attachPageDiagnostics(page: Page): PageDiagnostics {
  const diagnostics: PageDiagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpFailures: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") {
      addBounded(diagnostics.consoleErrors, message.text());
    }
  });
  page.on("pageerror", (error) => {
    addBounded(diagnostics.pageErrors, error.message);
  });
  page.on("requestfailed", (request) => {
    addBounded(
      diagnostics.failedRequests,
      `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "request failed"}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      addBounded(
        diagnostics.httpFailures,
        `${response.status()} ${response.request().method()} ${response.url()}`,
      );
    }
  });

  return diagnostics;
}

function manualResult(testCase: TestCase, reason: string): CaseExecutionResult {
  return {
    id: testCase.id,
    title: testCase.title,
    status: "MANUAL",
    reason,
    assertions: [],
    screenshot: null,
  };
}

function blockedResult(testCase: TestCase, reason: string): CaseExecutionResult {
  return {
    id: testCase.id,
    title: testCase.title,
    status: "BLOCKED",
    reason,
    assertions: [],
    screenshot: null,
  };
}

function isInteractivePlan(plan: Extract<AutomationPlan, { mode: "automated" }>): boolean {
  return plan.actions.some(
    (action) => action.action === "fill" || action.action === "click",
  );
}

export async function executeTestCase(
  page: Page,
  testCase: TestCase,
  options: { baseUrl: string; allowInteractions: boolean },
): Promise<CaseExecutionResult> {
  const plan = testCase.automationPlan;
  if (!plan || plan.mode === "manual") {
    return manualResult(
      testCase,
      plan?.mode === "manual"
        ? plan.reason
        : "No supported browser action plan was generated for this case.",
    );
  }

  if (isInteractivePlan(plan) && !options.allowInteractions) {
    return manualResult(
      testCase,
      "This case needs form or control interaction. Enable the explicit interaction option for an authorized test environment.",
    );
  }

  const base = new URL(options.baseUrl);
  const assertions: AssertionResult[] = [];

  for (const action of plan.actions) {
    try {
      switch (action.action) {
        case "navigate": {
          const destination = new URL(action.path, base);
          if (destination.origin !== base.origin) {
            return blockedResult(
              testCase,
              "A generated navigation action attempted to leave the supplied origin.",
            );
          }
          await page.goto(destination.toString(), {
            waitUntil: "domcontentloaded",
            timeout: ACTION_TIMEOUT_MS,
          });
          break;
        }
        case "fill":
          await page.getByLabel(action.label, { exact: true }).fill(action.value, {
            timeout: ACTION_TIMEOUT_MS,
          });
          break;
        case "click":
          await page.getByRole(action.role, { name: action.name, exact: true }).click({
            timeout: ACTION_TIMEOUT_MS,
          });
          break;
        case "assert-visible": {
          await page
            .getByRole(action.role, {
              ...(action.name ? { name: action.name, exact: true } : {}),
            })
            .waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
          assertions.push({
            action: "assert-visible",
            status: "PASSED",
            detail: action.name
              ? `Visible ${action.role} named “${action.name}”.`
              : `A visible ${action.role} was found.`,
          });
          break;
        }
        case "assert-text":
          await page
            .getByText(action.text, { exact: false })
            .first()
            .waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
          assertions.push({
            action: "assert-text",
            status: "PASSED",
            detail: `Visible page text contains “${action.text}”.`,
          });
          break;
        case "assert-url": {
          const currentUrl = page.url();
          const passed = currentUrl.includes(action.contains);
          assertions.push({
            action: "assert-url",
            status: passed ? "PASSED" : "FAILED",
            detail: passed
              ? `URL contains “${action.contains}”.`
              : `URL did not contain “${action.contains}” (current URL: ${currentUrl}).`,
          });
          if (!passed) {
            return {
              id: testCase.id,
              title: testCase.title,
              status: "FAILED",
              reason: "A generated URL assertion did not pass.",
              assertions,
              screenshot: null,
            };
          }
          break;
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const isAssertion = action.action.startsWith("assert-");
      if (isAssertion) {
        assertions.push({
          action: action.action,
          status: "FAILED",
          detail: detail.slice(0, MAX_DIAGNOSTIC_LENGTH),
        });
      }
      return {
        id: testCase.id,
        title: testCase.title,
        status: "FAILED",
        reason: `Browser action “${action.action}” failed.`,
        assertions,
        screenshot: null,
      };
    }
  }

  return {
    id: testCase.id,
    title: testCase.title,
    status: "PASSED",
    reason: null,
    assertions,
    screenshot: null,
  };
}

export function markCaseBlocked(testCase: TestCase, reason: string): CaseExecutionResult {
  return blockedResult(testCase, reason);
}

export function markCaseManual(testCase: TestCase, reason: string): CaseExecutionResult {
  return manualResult(testCase, reason);
}
