# AI QA Platform 🚀

An AI-assisted QA automation platform built with **Next.js, TypeScript, and Playwright** to streamline test case generation and browser-based application validation.

## Overview

The AI QA Platform provides a foundation for generating test scenarios from Jira requirements and executing browser checks against QA and UAT environments.

The project combines a web-based dashboard with a Playwright-powered API to collect execution results and browser diagnostics.

## Features

- **Test Case Generation:** Generate predefined test scenarios based on a Jira ticket description.
- **Test Coverage Selection:** Select positive, negative, and edge-case categories.
- **Environment Selection:** Configure QA or UAT as the target environment.
- **Browser Automation:** Launch a headless Chromium browser using Playwright.
- **Application Validation:** Check page navigation, HTTP response status, and page title.
- **Page Inspection:** Collect heading, link, button, and input counts.
- **Browser Diagnostics:** Capture browser console errors and page errors.
- **Screenshot Evidence:** Attempt to capture screenshots and return them with execution results when available.
- **Execution Summary:** Display passed and failed counts in the dashboard.

## Tech Stack

| Technology | Purpose |
|---|---|
| Next.js | Web application and API routes |
| React | Interactive user interface |
| TypeScript | Type-safe development |
| Playwright | Browser automation |
| Tailwind CSS | Dashboard styling |
| Node.js | Runtime environment |

## Getting Started

### Prerequisites

- Node.js and npm
- Git

### 1. Clone the repository

```bash
git clone https://github.com/Chaitanyamark/ai-qa-platform.git
cd ai-qa-platform
```

### 2. Install dependencies

```bash
npm install
```

### 3. Install the Playwright Chromium browser

```bash
npx playwright install chromium
```

### 4. Start the development server

```bash
npm run dev
```

### 5. Open the application

Navigate to [http://localhost:3000](http://localhost:3000).

## How to Use

1. Enter a Jira ticket description and acceptance criteria.
2. Provide the URL of an application you are authorized to test.
3. Select the target environment.
4. Choose the desired test coverage categories.
5. Generate test scenarios.
6. Click **Run Browser Test** to execute the current Playwright page-load check.
7. Review the HTTP status, page details, browser errors, and screenshot when available.

## Current Implementation

The current version is an MVP.

- Test case generation uses the configured local Ollama model. The model plans
  scenarios from independently testable requirement behaviors, so the number
  of cases can vary even when two tickets contain the same number of criteria.
- Each planned scenario is linked to one generated case. Missing cases are
  reported as partial coverage. If Ollama fails, the app labels its generic
  template suggestions as a fallback; those suggestions are not a content-based
  scenario plan.
- Ollama responses use a structured JSON schema and a response token budget
  derived from the prompt size and context window. The default output ceiling is
  8,192 tokens and can be changed with `OLLAMA_NUM_PREDICT`.
- Browser execution currently performs a page-load check rather than executing every generated scenario.
- Screenshot capture is best-effort and may be unavailable for some websites.
- Jira integration and full scenario execution are planned enhancements.

## Roadmap

- [ ] Execute generated scenarios as real Playwright tests.
- [ ] Add assertions for expected application behavior.
- [ ] Integrate with the Jira API.
- [ ] Add downloadable HTML and JSON reports.
- [ ] Improve failure diagnostics and screenshot evidence.
- [ ] Add automated tests for the platform itself.
- [ ] Add CI/CD execution with GitHub Actions.

## Security Notes

- Use only application URLs you are authorized to test.
- Do not commit API keys, credentials, or environment secrets.
- The browser-execution endpoint is intended for local development and is not yet hardened for public deployment.

## Author

**Chaitanya Desai**

QA Automation Engineer | Playwright | TypeScript | Selenium | API Testing

GitHub: [Chaitanyamark](https://github.com/Chaitanyamark)

---

*This project is under active development as a hands-on QA automation engineering project.*
