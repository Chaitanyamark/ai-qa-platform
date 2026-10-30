import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { chromium, type Browser } from "playwright";
import { z } from "zod";
import {
  attachPageDiagnostics,
  executeTestCase,
  markCaseBlocked,
  markCaseManual,
  type CaseExecutionResult,
  type PageDiagnostics,
} from "@/lib/browser-test-executor";
import { createPublicEgressProxy, validatePublicHttpUrl } from "@/lib/public-egress-proxy";
import { TestCaseSchema } from "@/lib/test-generator-schema";

const MAX_REQUEST_BYTES = 512_000;
const MAX_CASES_PER_RUN = 50;
const NAVIGATION_TIMEOUT_MS = 20_000;
const TEST_CASES_SCHEMA = z.array(TestCaseSchema).min(1).max(MAX_CASES_PER_RUN);
const EXECUTION_REQUEST_SCHEMA = z.object({
  url: z.string().min(1).max(2048),
  testCases: TEST_CASES_SCHEMA,
  allowInteractions: z.boolean().optional().default(false),
});

type NavigationResult = {
  status: "PASSED" | "FAILED";
  httpStatus: number | null;
  pageTitle: string;
  finalUrl: string;
  pageInfo: {
    headingCount: number;
    linkCount: number;
    buttonCount: number;
    inputCount: number;
  } | null;
  error: string | null;
  screenshot: string | null;
};

type CaseResult = CaseExecutionResult & {
  navigation: {
    status: "PASSED" | "FAILED" | "SKIPPED";
    httpStatus: number | null;
    finalUrl: string;
    error: string | null;
  };
  diagnostics: PageDiagnostics;
};

function emptyDiagnostics(): PageDiagnostics {
  return { consoleErrors: [], pageErrors: [], failedRequests: [], httpFailures: [] };
}

function mergeDiagnostics(target: PageDiagnostics, source: PageDiagnostics): void {
  for (const key of Object.keys(target) as Array<keyof PageDiagnostics>) {
    target[key].push(...source[key]);
  }
}

function trimDiagnostics(diagnostics: PageDiagnostics): PageDiagnostics {
  return {
    consoleErrors: diagnostics.consoleErrors.slice(0, 100),
    pageErrors: diagnostics.pageErrors.slice(0, 100),
    failedRequests: diagnostics.failedRequests.slice(0, 100),
    httpFailures: diagnostics.httpFailures.slice(0, 100),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tokenIsValid(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expectedToken);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

function guardProductionAccess(request: Request): NextResponse | null {
  if (process.env.NODE_ENV !== "production") return null;

  const expectedToken = process.env.QA_EXECUTION_TOKEN;
  if (!expectedToken || expectedToken.length < 32) {
    return NextResponse.json(
      { error: "Browser execution is disabled until a strong QA_EXECUTION_TOKEN is configured." },
      { status: 503 },
    );
  }
  if (!tokenIsValid(request, expectedToken)) {
    return NextResponse.json({ error: "A valid execution token is required." }, { status: 401 });
  }
  return null;
}

async function installProtocolGuard(page: import("playwright").Page): Promise<void> {
  await page.route("**/*", (route) => {
    let protocol = "";
    try {
      protocol = new URL(route.request().url()).protocol;
    } catch {
      return route.abort("blockedbyclient");
    }
    return protocol === "http:" || protocol === "https:"
      ? route.continue()
      : route.abort("blockedbyclient");
  });
}

async function takeScreenshot(page: import("playwright").Page): Promise<string | null> {
  try {
    const screenshot = await page.screenshot({
      type: "png",
      fullPage: false,
      timeout: 5_000,
      animations: "disabled",
    });
    return `data:image/png;base64,${screenshot.toString("base64")}`;
  } catch {
    return null;
  }
}

async function inspectPage(page: import("playwright").Page) {
  try {
    return await page.evaluate(() => ({
      headingCount: document.querySelectorAll("h1, h2, h3").length,
      linkCount: document.querySelectorAll("a").length,
      buttonCount: document.querySelectorAll("button").length,
      inputCount: document.querySelectorAll("input, textarea, select").length,
    }));
  } catch {
    return null;
  }
}

async function closeBrowser(browser: Browser | undefined): Promise<void> {
  try {
    await browser?.close();
  } catch {
    // Browser shutdown should not hide the run report.
  }
}

export async function POST(request: Request) {
  const accessError = guardProductionAccess(request);
  if (accessError) return accessError;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "The execution request is too large." }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "The execution request could not be read." }, { status: 400 });
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "The execution request is too large." }, { status: 413 });
  }

  let untrustedBody: unknown;
  try {
    untrustedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "The execution request must contain valid JSON." }, { status: 400 });
  }

  const parsedRequest = EXECUTION_REQUEST_SCHEMA.safeParse(untrustedBody);
  if (!parsedRequest.success) {
    return NextResponse.json(
      {
        error: "Provide a URL and between 1 and 50 valid generated test cases.",
        details: parsedRequest.error.issues.map(({ path, message }) => ({ path, message })),
      },
      { status: 400 },
    );
  }

  let target: URL;
  try {
    target = await validatePublicHttpUrl(parsedRequest.data.url);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }

  const proxy = createPublicEgressProxy();
  let browser: Browser | undefined;

  try {
    const proxyServer = await proxy.listen();
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      ...(process.env.PLAYWRIGHT_CHANNEL === "chrome" ? { channel: "chrome" } : {}),
      proxy: { server: proxyServer },
      args: [
        "--proxy-bypass-list=<-loopback>",
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    });

    const aggregateDiagnostics = emptyDiagnostics();
    const baselineContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const baselinePage = await baselineContext.newPage();
    const baselineDiagnostics = attachPageDiagnostics(baselinePage);
    await installProtocolGuard(baselinePage);

    let baselineResponse: Awaited<ReturnType<typeof baselinePage.goto>> = null;
    let navigationError: string | null = null;
    try {
      baselineResponse = await baselinePage.goto(target.toString(), {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch (error) {
      navigationError = errorMessage(error).slice(0, 500);
    }

    const navigationStatus = baselineResponse?.status() ?? null;
    const navigationPassed =
      navigationStatus !== null && navigationStatus >= 200 && navigationStatus < 400;
    if (!navigationPassed && !navigationError) {
      navigationError = `The page returned HTTP ${navigationStatus ?? "no response"}.`;
    }

    const navigation: NavigationResult = {
      status: navigationPassed ? "PASSED" : "FAILED",
      httpStatus: navigationStatus,
      pageTitle: await baselinePage.title().catch(() => ""),
      finalUrl: baselinePage.url(),
      pageInfo: await inspectPage(baselinePage),
      error: navigationError,
      screenshot: await takeScreenshot(baselinePage),
    };

    mergeDiagnostics(aggregateDiagnostics, baselineDiagnostics);

    const results: CaseResult[] = [];
    let screenshotAttachedToCase = false;

    for (const testCase of parsedRequest.data.testCases) {
      const plan = testCase.automationPlan;
      const requiresInteractions =
        plan?.mode === "automated" &&
        plan.actions.some((action) => action.action === "fill" || action.action === "click");

      if (!plan || plan.mode === "manual") {
        const result = await executeTestCase(baselinePage, testCase, {
          baseUrl: target.toString(),
          allowInteractions: parsedRequest.data.allowInteractions,
        });
        results.push({
          ...result,
          navigation: { status: "SKIPPED", httpStatus: null, finalUrl: "", error: null },
          diagnostics: emptyDiagnostics(),
        });
        continue;
      }

      if (requiresInteractions && !parsedRequest.data.allowInteractions) {
        results.push({
          ...markCaseManual(
            testCase,
            "This case needs form or control interaction. Enable the explicit interaction option for an authorized test environment.",
          ),
          navigation: { status: "SKIPPED", httpStatus: null, finalUrl: "", error: null },
          diagnostics: emptyDiagnostics(),
        });
        continue;
      }

      if (!navigationPassed) {
        results.push({
          ...markCaseBlocked(testCase, "The page did not pass the separate navigation check."),
          navigation: {
            status: "FAILED",
            httpStatus: navigationStatus,
            finalUrl: navigation.finalUrl,
            error: navigationError,
          },
          diagnostics: emptyDiagnostics(),
        });
        continue;
      }

      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const diagnostics = attachPageDiagnostics(page);
      await installProtocolGuard(page);
      let response: Awaited<ReturnType<typeof page.goto>> = null;
      let caseNavigationError: string | null = null;
      let outcome: CaseExecutionResult;

      try {
        response = await page.goto(target.toString(), {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });
        const status = response?.status() ?? null;
        if (status === null || status < 200 || status >= 400) {
          caseNavigationError = `The page returned HTTP ${status ?? "no response"}.`;
          outcome = markCaseBlocked(testCase, caseNavigationError);
        } else {
          outcome = await executeTestCase(page, testCase, {
            baseUrl: target.toString(),
            allowInteractions: parsedRequest.data.allowInteractions,
          });
        }
      } catch (error) {
        caseNavigationError = errorMessage(error).slice(0, 500);
        outcome = markCaseBlocked(testCase, "The browser could not load the supplied page.");
      }

      const caseNavigationStatus = caseNavigationError ? "FAILED" : "PASSED";
      if (!screenshotAttachedToCase) {
        outcome.screenshot = await takeScreenshot(page);
        screenshotAttachedToCase = outcome.screenshot !== null;
      }

      mergeDiagnostics(aggregateDiagnostics, diagnostics);
      results.push({
        ...outcome,
        navigation: {
          status: caseNavigationStatus,
          httpStatus: response?.status() ?? null,
          finalUrl: page.url(),
          error: caseNavigationError,
        },
        diagnostics,
      });
      await context.close().catch(() => undefined);
    }

    const passed = results.filter((result) => result.status === "PASSED").length;
    const failed = results.filter((result) => result.status === "FAILED").length;
    const manual = results.filter((result) => result.status === "MANUAL").length;
    const blocked = results.filter((result) => result.status === "BLOCKED").length;

    await baselineContext.close().catch(() => undefined);

    return NextResponse.json({
      summary: { total: results.length, passed, failed, manual, blocked },
      navigation,
      diagnostics: trimDiagnostics(aggregateDiagnostics),
      results,
    });
  } catch (error) {
    console.error("API execution failed:", error);
    return NextResponse.json(
      { error: "Browser execution could not be completed.", details: errorMessage(error).slice(0, 500) },
      { status: 500 },
    );
  } finally {
    await closeBrowser(browser);
    await proxy.close().catch(() => undefined);
  }
}
