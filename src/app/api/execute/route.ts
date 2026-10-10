
import { NextRequest, NextResponse } from "next/server";
import { chromium } from "playwright";

export async function POST(request: NextRequest) {
    let browser;

    try {
        const body = await request.json();
        const rawUrl = body.url;

        if (typeof rawUrl !== "string" || !rawUrl.trim()) {
            return NextResponse.json(
                { error: "A website URL is required." },
                { status: 400 }
            );
        }

        let target: URL;

        try {
            target = new URL(rawUrl);
        } catch {
            return NextResponse.json(
                { error: "Please provide a valid URL." },
                { status: 400 }
            );
        }

        if (!["http:", "https:"].includes(target.protocol)) {
            return NextResponse.json(
                { error: "Only HTTP and HTTPS URLs are supported." },
                { status: 400 }
            );
        }

        const host = target.hostname.toLowerCase();

        // Basic protection for this local demo.
        const blockedHost =
            host === "localhost" ||
            host.endsWith(".localhost") ||
            host.endsWith(".local") ||
            host === "::1" ||
            host === "[::1]" ||
            host === "0.0.0.0" ||
            host === "169.254.169.254" ||
            /^\d+$/.test(host) ||
            /^127\./.test(host) ||
            /^10\./.test(host) ||
            /^192\.168\./.test(host) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
            /^169\.254\./.test(host) ||
            /^0\./.test(host);

        if (blockedHost) {
            return NextResponse.json(
                { error: "This demo only accepts public website URLs." },
                { status: 400 }
            );
        }

        browser = await chromium.launch({ headless: true });

        const page = await browser.newPage();
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];

        page.on("console", (message) => {
            if (message.type() === "error") {
                consoleErrors.push(message.text());
            }
        });

        page.on("pageerror", (error) => {
            pageErrors.push(error.message);
        });

        const response = await page.goto(target.toString(), {
            waitUntil: "commit",
            timeout: 60000,
        });

        const title = await page.title();
        const finalUrl = page.url();

        const pageInfo = await page.evaluate(() => ({
            headingCount: document.querySelectorAll("h1, h2, h3").length,
            linkCount: document.querySelectorAll("a").length,
            buttonCount: document.querySelectorAll("button").length,
            inputCount: document.querySelectorAll(
                "input, textarea, select"
            ).length,
        }));

        let screenshot: Buffer | null = null;

        try {
            await page.evaluate(() => document.fonts?.ready);

            screenshot = await page.screenshot({
                fullPage: true,
                type: "png",
                timeout: 10000,
                animations: "disabled",
                scale: "css",
            });
        } catch (error) {
            console.error("Screenshot capture failed:", error);
        }

        const status = response?.status() ?? null;
        const passed = status !== null && status >= 200 && status < 400;

        return NextResponse.json({
            summary: {
                total: 1,
                passed: passed ? 1 : 0,
                failed: passed ? 0 : 1,
            },
            results: [
                {
                    id: "TC001",
                    title: "Verify website loads",
                    status: passed ? "PASSED" : "FAILED",
                    httpStatus: status,
                    pageTitle: title,
                    finalUrl,
                    pageInfo,
                    consoleErrors,
                    pageErrors,
                    screenshot: screenshot
                        ? `data:image/png;base64,${screenshot.toString("base64")}`
                        : null,
                },
            ],
        });
    } catch (error) {
        console.error("API execution failed:", error);

        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "An unexpected execution error occurred.",
            },
            { status: 500 }
        );
    } finally {
        await browser?.close();
    }
}
