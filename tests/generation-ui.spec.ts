import { expect, test } from "@playwright/test";

test("dashboard sends only the selected test category and renders the result", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:11435/__reset");
  const requirement = "Profile update [[mock:short]]";
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
  await expect(coverageWarning).toContainText("Partial generation");
  await expect(coverageWarning).toContainText(
    "Positive: 1 of at least 5 cases (below minimum)"
  );

  const statsResponse = await request.get("http://127.0.0.1:11435/__stats");
  const stats = (await statsResponse.json()) as { totalCalls: number };
  expect(stats.totalCalls).toBe(1);
});
