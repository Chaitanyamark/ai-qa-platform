import { expect, test } from "@playwright/test";
import { executeTestCase } from "../src/lib/browser-test-executor";
import type { TestCase } from "../src/lib/test-generator-schema";

const mockPort = Number(process.env.MOCK_OLLAMA_PORT) || 11436;
const mockService = `http://127.0.0.1:${mockPort}`;

function makeCase(automationPlan: TestCase["automationPlan"]): TestCase {
  return {
    id: "TC001",
    title: "Verify the sign-in form reports invalid test credentials",
    type: "Negative",
    priority: "Medium",
    preconditions: ["The local execution fixture is open."],
    steps: ["Fill the synthetic credentials.", "Submit and check the alert."],
    testData: "Synthetic test credentials",
    expectedResult: "The form displays its invalid credentials message.",
    requirementRef: "AC-001",
    automationPlan,
  };
}

test("executes an API-generated browser plan and reports its assertion", async ({
  page,
  request,
}) => {
  await request.post(mockService + "/__reset");
  const generationResponse = await request.post("/api/generate", {
    data: {
      ticket: "A local page contains the text Execution harness ready. [[mock:automatable]]",
      selectedTypes: ["Positive"],
    },
  });
  expect(generationResponse.ok()).toBeTruthy();
  const generated = (await generationResponse.json()) as { testCases: TestCase[] };
  const testCase = generated.testCases[0];
  expect(testCase.automationPlan?.mode).toBe("automated");

  await page.setContent("<main><h1>Execution harness ready</h1></main>");
  const result = await executeTestCase(page, testCase, {
    baseUrl: "https://qa.example.test/",
    allowInteractions: false,
  });

  expect(result.status).toBe("PASSED");
  expect(result.assertions).toEqual([
    {
      action: "assert-text",
      status: "PASSED",
      detail: 'Visible page text contains “Execution harness ready”.',
    },
  ]);
});

test("executes form interaction only after the explicit opt-in", async ({ page }) => {
  await page.setContent(`
    <form>
      <label>Email<input name="email" /></label>
      <label>Password<input name="password" type="password" /></label>
      <button type="submit">Sign in</button>
    </form>
    <p role="alert" hidden></p>
    <script>
      document.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        const alert = document.querySelector('[role="alert"]');
        alert.hidden = false;
        alert.textContent = 'Invalid credentials';
      });
    </script>
  `);
  const testCase = makeCase({
    mode: "automated",
    actions: [
      { action: "fill", label: "Email", value: "qa-user@example.test" },
      { action: "fill", label: "Password", value: "Synthetic-Pass-123" },
      { action: "click", role: "button", name: "Sign in" },
      { action: "assert-visible", role: "alert" },
      { action: "assert-text", text: "Invalid credentials" },
    ],
  });

  const withoutOptIn = await executeTestCase(page, testCase, {
    baseUrl: "https://qa.example.test/login",
    allowInteractions: false,
  });
  expect(withoutOptIn.status).toBe("MANUAL");
  await expect(page.getByRole("alert")).toBeHidden();

  const withOptIn = await executeTestCase(page, testCase, {
    baseUrl: "https://qa.example.test/login",
    allowInteractions: true,
  });
  expect(withOptIn.status).toBe("PASSED");
  expect(withOptIn.assertions).toHaveLength(2);
  await expect(page.getByRole("alert")).toBeVisible();
});

test("a failed functional assertion fails the case", async ({ page }) => {
  await page.setContent("<h1>Profile</h1>");
  const result = await executeTestCase(
    page,
    makeCase({
      mode: "automated",
      actions: [{ action: "assert-text", text: "Account created" }],
    }),
    { baseUrl: "https://qa.example.test/", allowInteractions: false },
  );

  expect(result.status).toBe("FAILED");
  expect(result.assertions[0].status).toBe("FAILED");
});

test("a case without a structured plan is manual", async ({ page }) => {
  await page.setContent("<h1>Page</h1>");
  const result = await executeTestCase(
    page,
    makeCase(undefined),
    { baseUrl: "https://qa.example.test/", allowInteractions: true },
  );

  expect(result.status).toBe("MANUAL");
  expect(result.assertions).toHaveLength(0);
});
