# AI QA Platform

An AI-assisted QA platform built with **Next.js, TypeScript, and Playwright**. It turns requirements into reviewable test cases, executes supported browser plans, and reports requirement links and browser evidence.

## What it does

- Generates a requirement-driven number of positive, negative, and edge-case scenarios through a locally configured Ollama model. There is no fixed case quota per category; the response is capped at 50 cases per request.
- Validates AI responses, retries malformed output, and creates one clearly labelled manual fallback case per extracted acceptance criterion if the provider fails.
- Shows generated counts by category and links each case to a requirement reference. Missing links and categories with no applicable scenarios are reported as coverage gaps.
- Runs supported structured browser plans. Cases without a supported plan are labelled **Manual** instead of being reported as executed.
- Separates the initial page navigation result from each test case's assertion results.
- Captures console errors, page errors, failed requests, HTTP error responses, page details, and screenshots where available.
- Blocks private and reserved IP destinations, validates DNS results, and routes browser traffic through a proxy that checks every request, including redirects.

Requirement links are review aids. A link does not prove that a test case semantically covers the criterion; review the case and expected result.

## Supported browser actions

Generated plans can navigate to a same-origin path, fill an accessible field, click a named button or link, and assert visible text, a role, or a URL. Unsupported plans remain manual.

Field filling and clicks are disabled by default. Enabling them can submit forms or change the target page. Use interactions only on an authorized QA/UAT target with synthetic data.

## Tech stack

| Technology | Purpose |
|---|---|
| Next.js and React | Dashboard and API routes |
| TypeScript and Zod | Application code and response validation |
| Ollama | Local AI test-case generation (default model: `qwen2.5:7b`) |
| Playwright | Chromium browser execution and test-runner evidence |
| Tailwind CSS | Dashboard styling |

## Getting started

### Prerequisites

- Node.js and npm
- Git
- Ollama with the configured model available
- Playwright Chromium, or Google Chrome if using the `PLAYWRIGHT_CHANNEL=chrome` option

### Install and run

```bash
git clone https://github.com/Chaitanyamark/ai-qa-platform.git
cd ai-qa-platform
npm install
npx playwright install chromium
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). By default, the app uses Ollama at `http://127.0.0.1:11434` with model `qwen2.5:7b`. Configure `OLLAMA_URL`, `OLLAMA_MODEL`, and `OLLAMA_TIMEOUT_MS` in `.env.local` to change those settings.

### Run the platform tests

```bash
npm test
```

The Playwright suite starts a local mock Ollama service and a local Next.js server. It uses test fixtures and does not visit a public website. Set `PLAYWRIGHT_CHANNEL=chrome` to use installed Google Chrome instead of the Playwright Chromium browser.

Test-runner screenshots and traces are saved in `evidence/playwright/`. The dashboard also displays screenshots returned by a browser execution run.

## Execution scope and security

- The browser runner accepts public HTTP and HTTPS URLs on ports 80 and 443. It rejects localhost, private/reserved IP addresses, and hostnames that resolve to any non-public address.
- Redirect requests pass through the same egress proxy and are revalidated. Browser traffic is limited to HTTP and HTTPS.
- Each request accepts 1–50 generated cases and is limited to 512 KB.
- In production, `/api/execute` requires `QA_EXECUTION_TOKEN` to be configured with at least 32 characters and supplied as a bearer token. Browser execution returns an error when the token is missing or invalid.
- Before a public deployment, add and review application-level authentication, authorization, rate limits, and resource limits. The protections here do not replace deployment security review.
- Test case generation uses the configured local Ollama model. The model plans
  scenarios from independently testable requirement behaviors, so the number
  of cases can vary even when two tickets contain the same number of criteria.
- Each planned scenario is linked to one generated case. Missing cases are
  reported as partial coverage. If Ollama fails, the app labels its
  criterion-specific template cases as a manual fallback, not as AI-generated
  scenarios.
- Ollama responses use a structured JSON schema and a response token budget
  derived from the prompt size and context window. The default output ceiling is
  8,192 tokens and can be changed with `OLLAMA_NUM_PREDICT`.
- Generated cases with supported browser plans execute as Playwright actions with assertions. Cases without a supported plan are marked manual.
- Navigation status, generated case results, browser errors, failed requests, and screenshots are reported separately where available.
- Screenshot capture is best-effort and may be unavailable for some websites.

Do not use real passwords, personal data, job applications, or other externally visible actions in test runs. Keep destructive scenarios manual and use an authorized test environment.

## Known limitations and planned work

- Test-case count and scenario selection depend on the AI response. Check the requirement-to-test links and any missing-coverage warning; the platform does not claim that a category count alone proves coverage.
- The fallback creates one manual case per extracted criterion; split criteria containing multiple independent behaviors and review each case before execution.
- Automation currently supports same-origin navigation, filling labelled fields, clicking named buttons or links, and a limited set of assertions. Login setup, file uploads, multi-window workflows, and application-specific setup are not implemented yet.
- Jira API integration, downloadable HTML/JSON reports, and CI execution are planned improvements.
- The installed Next.js CLI currently emits a security advisory. Its applicability to this project has not been independently verified and is tracked separately from these QA behavior changes.

## Author

**Chaitanya Desai**

QA Automation Engineer | Playwright | TypeScript | Selenium | API Testing

GitHub: [Chaitanyamark](https://github.com/Chaitanyamark)
