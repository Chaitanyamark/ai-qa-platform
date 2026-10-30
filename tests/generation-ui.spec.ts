import { expect, test } from "@playwright/test";

test("dashboard sends only the selected test category and renders the result", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:12436/__reset");
  const requirement =
    "Acceptance Criteria\n1. A valid profile name saves.\n2. An invalid profile name is rejected.\n3. Repeated saves do not create duplicates. [[mock:short]]";
  await page.goto("/");
  await page.getByLabel("Jira ticket and acceptance criteria").fill(requirement);

  await page.getByRole("checkbox", { name: /Negative/ }).uncheck();
  await page.getByRole("checkbox", { name: /Edge Cases/ }).uncheck();
  await expect(page.getByRole("checkbox", { name: /Positive/ })).toBeChecked();

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
    "No generated case is linked to: AC-002, AC-003"
  );

  const statsResponse = await request.get("http://127.0.0.1:12436/__stats");
  const stats = (await statsResponse.json()) as { totalCalls: number };
  expect(stats.totalCalls).toBe(1);
});
