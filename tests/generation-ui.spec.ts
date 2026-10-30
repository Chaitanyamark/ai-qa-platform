import { expect, test } from "@playwright/test";

const mockPort = Number(process.env.MOCK_OLLAMA_PORT) || 11436;
const mockService = `http://127.0.0.1:${mockPort}`;

test("dashboard sends only the selected test category and renders the result", async ({
  page,
  request,
}) => {
  await request.post(mockService + "/__reset");
  const requirement = [
    "Profile update [[mock:short]]",
    "1. The user can change their profile name.",
    "2. The saved profile name appears in the header.",
    "3. The saved name remains after reload.",
    "4. The profile update displays a success message.",
  ].join("\n");
  await page.goto("/");
  await page.getByLabel("Jira ticket and acceptance criteria").fill(requirement);

  const categories = page.locator('input[type="checkbox"]');
  await expect(categories).toHaveCount(3);
  await categories.nth(1).uncheck();
  await categories.nth(2).uncheck();

  const generationRequest = page.waitForRequest(
    (candidate) =>
      candidate.url().endsWith("/api/generate") &&
      candidate.method() === "POST"
  );

  await page.getByRole("button", { name: "Generate Test Cases" }).click();
  const sentRequest = await generationRequest;

  expect(sentRequest.postDataJSON()).toEqual({
    ticket: requirement,
    selectedTypes: ["Positive"],
  });

  await expect(
    page.getByRole("heading", { name: "Generated Test Cases (1)" })
  ).toBeVisible();
  const coverageWarning = page.getByRole("alert", {
    name: "Generation coverage warning",
  });
  await expect(coverageWarning).toContainText("Coverage needs review");
  await expect(coverageWarning).toContainText(
    "Positive: 1 of 4 planned cases (below target)"
  );
  await expect(coverageWarning).toContainText(
    "No generated case is linked to: AC-002, AC-003, AC-004"
  );

  const statsResponse = await request.get(mockService + "/__stats");
  const stats = (await statsResponse.json()) as { totalCalls: number };
  expect(stats.totalCalls).toBe(1);
});
