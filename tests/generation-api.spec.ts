import { expect, test, type APIRequestContext } from "@playwright/test";

const mockService = "http://127.0.0.1:12436";

type Coverage = {
  requestedTypes: string[];
  caseCounts: Array<{ type: string; count: number }>;
  failedTypes: string[];
  emptyTypes: string[];
  missingRequirementIds: string[];
  status: "complete" | "partial";
};

async function resetMock(request: APIRequestContext) {
  const response = await request.post(mockService + "/__reset");
  expect(response.ok()).toBeTruthy();
}

async function generate(
  request: APIRequestContext,
  ticket: string,
  selectedTypes: string[] = ["Positive"]
) {
  const response = await request.post("/api/generate", {
    data: { ticket, selectedTypes },
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
}

function getCoverage(body: Record<string, unknown>): Coverage {
  return body.coverage as Coverage;
}

async function getStats(request: APIRequestContext) {
  const response = await request.get(mockService + "/__stats");
  return (await response.json()) as Record<string, unknown>;
}

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("creates one criterion-specific manual case per acceptance criterion when AI is unavailable", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Acceptance Criteria\n1. Valid registration displays a success message.\n2. Invalid email is rejected with an appropriate validation message.\n3. Leading and trailing whitespace in email is handled correctly.\n4. Confirm password mismatch is rejected with clear feedback. [[mock:provider-error]]",
    ["Positive", "Negative", "Edge Cases"],
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("template-fallback");
  const cases = body.testCases as Array<Record<string, unknown>>;
  expect(cases).toHaveLength(4);
  expect(cases.map((item) => item.requirementRef)).toEqual([
    "AC-001",
    "AC-002",
    "AC-003",
    "AC-004",
  ]);
  expect(cases.map((item) => item.type)).toEqual([
    "Positive",
    "Negative",
    "Edge Cases",
    "Negative",
  ]);
  expect(cases.every((item) => (item.automationPlan as { mode?: string }).mode === "manual")).toBeTruthy();
  expect(body.requirementCoverage).toMatchObject([
    { requirementId: "AC-001", status: "linked" },
    { requirementId: "AC-002", status: "linked" },
    { requirementId: "AC-003", status: "linked" },
    { requirementId: "AC-004", status: "linked" },
  ]);
});
test("reports a requirement-driven case count without a category minimum", async ({ request }) => {
  const { response, body } = await generate(request, "A simple profile requirement");

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(Array.isArray(body.testCases)).toBeTruthy();

  const cases = body.testCases as Array<Record<string, unknown>>;
  expect(cases).toHaveLength(1);
  expect(cases.every((item) => item.type === "Positive")).toBeTruthy();
  expect(cases[0].id).toBe("TC001");
  expect(cases[0].steps).toHaveLength(4);
  expect(cases[0].automationPlan).toMatchObject({
    mode: "manual",
    reason: expect.any(String),
  });

  expect(getCoverage(body)).toMatchObject({
    status: "complete",
    emptyTypes: [],
    missingRequirementIds: [],
    caseCounts: [{ type: "Positive", count: 1 }],
  });
});

test("returns different counts for equally sized criteria with different complexity", async ({
  request,
}) => {
  const simple = await generate(
    request,
    "Acceptance Criteria\n1. The profile heading is displayed.",
  );
  const complex = await generate(
    request,
    "Acceptance Criteria\n1. The profile supports saving a valid name, rejects invalid lengths, and prevents a duplicate submission. [[mock:complex]]",
  );

  expect((simple.body.testCases as unknown[])).toHaveLength(1);
  expect((complex.body.testCases as unknown[])).toHaveLength(5);
  expect((await getStats(request)).lastPrompt).toContain(
    "Do not use a fixed count, minimum, or quota per category.",
  );
});

test("builds requirement-level links from the supplied acceptance criteria", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Acceptance Criteria\n1. The page shows the profile heading.\n2. The page shows the settings link.",
  );

  expect(response.status()).toBe(200);
  expect(body.requirementCoverage).toEqual([
    {
      requirementId: "AC-001",
      criterion: "The page shows the profile heading.",
      testCaseIds: ["TC001"],
      status: "linked",
    },
    {
      requirementId: "AC-002",
      criterion: "The page shows the settings link.",
      testCaseIds: ["TC002"],
      status: "linked",
    },
  ]);
});

test("accepts valid JSON wrapped in Markdown fences", async ({ request }) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:fenced]]"
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(1);
  expect(getCoverage(body).status).toBe("complete");
});

test("normalizes object-valued test data before response validation", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:testdata-object]]"
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  const cases = body.testCases as Array<Record<string, unknown>>;
  expect(cases).toHaveLength(1);
  expect(cases[0].testData).toBe(
    JSON.stringify({
      email: "qa-user@example.test",
      password: "Synthetic-Pass-123",
    })
  );
});

test("reports missing criteria when variable output does not link every criterion", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Acceptance Criteria\n1. A valid profile name is saved.\n2. An invalid profile name is rejected.\n3. Repeated saves do not create duplicates.\n4. A success message is shown. [[mock:short]]",
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(1);
  expect(getCoverage(body)).toMatchObject({
    status: "partial",
    failedTypes: [],
    emptyTypes: [],
    missingRequirementIds: ["AC-002", "AC-003", "AC-004"],
    caseCounts: [{ type: "Positive", count: 1 }],
  });

  const stats = await getStats(request);
  expect(stats.totalCalls).toBe(1);
});

test("keeps a valid empty category as partial AI output instead of inventing fallback cases", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Acceptance Criteria\n1. The requested behavior is not part of this feature. [[mock:no-scenarios]]",
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toEqual([]);
  expect(getCoverage(body)).toMatchObject({
    status: "partial",
    emptyTypes: ["Positive"],
    missingRequirementIds: ["AC-001"],
  });
});

test("reports a failed category while preserving successful categories", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:partial]]",
    ["Positive", "Negative", "Edge Cases"]
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  const cases = body.testCases as Array<Record<string, unknown>>;
  expect([...new Set(cases.map((item) => item.type))]).toEqual([
    "Positive",
    "Edge Cases",
  ]);
  expect(getCoverage(body)).toMatchObject({
    status: "partial",
    requestedTypes: ["Positive", "Negative", "Edge Cases"],
    failedTypes: ["Negative"],
    emptyTypes: [],
    caseCounts: [
      { type: "Positive", count: 1 },
      { type: "Negative", count: 0 },
      { type: "Edge Cases", count: 1 },
    ],
  });

  const stats = await getStats(request);
  expect(stats.totalCalls).toBe(4);
});

test("preserves distinct cases with identical titles", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:duplicate-title]]"
  );

  expect(response.status()).toBe(200);
  const cases = body.testCases as Array<Record<string, unknown>>;
  expect(cases).toHaveLength(2);
  expect(cases.map((testCase) => testCase.testData)).toEqual([
    "Display name: Asha",
    "Display name: Kavya",
  ]);
  expect(getCoverage(body)).toMatchObject({
    status: "complete",
    emptyTypes: [],
    caseCounts: [{ type: "Positive", count: 2 }],
  });
});

test("removes exact duplicate test cases", async ({ request }) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:exact-duplicate]]"
  );

  expect(response.status()).toBe(200);
  expect(body.testCases).toHaveLength(1);
  expect(getCoverage(body).caseCounts).toEqual([
    { type: "Positive", count: 1 },
  ]);
  expect(getCoverage(body).status).toBe("complete");
});

test("preserves all valid cases when the model returns many", async ({
  request,
}) => {
  const { response, body } = await generate(request, "Requirement [[mock:many]]");

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(12);
  expect(getCoverage(body).status).toBe("complete");
  expect(getCoverage(body).caseCounts).toEqual([
    { type: "Positive", count: 12 },
  ]);
});

for (const scenario of [
  "malformed",
  "empty",
  "missing-field",
  "unexpected-type",
  "truncated",
]) {
  test("retries twice then uses the template fallback for " + scenario, async ({
    request,
  }) => {
    const { response, body } = await generate(
      request,
      "Requirement [[mock:" + scenario + "]]"
    );

    expect(response.status()).toBe(200);
    expect(body.generationMethod).toBe("template-fallback");
    expect(typeof body.fallbackReason).toBe("string");
    expect(getCoverage(body).status).toBe("partial");
    expect(getCoverage(body).failedTypes).toEqual(["Positive"]);

    const stats = await getStats(request);
    expect(stats.totalCalls).toBe(2);
  });
}

test("uses the template fallback after a provider timeout without retrying", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:timeout]]",
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("template-fallback");
  expect(getCoverage(body).failedTypes).toEqual(["Positive"]);

  const stats = await getStats(request);
  expect(stats.totalCalls).toBe(1);
});

test("keeps valid generated cases and marks an unsupported action plan manual", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:invalid-automation]]",
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(1);
  expect((body.testCases as Array<Record<string, unknown>>)[0].automationPlan).toMatchObject({
    mode: "manual",
    reason: expect.stringContaining("supported browser actions"),
  });
});

test("uses the template fallback immediately for provider HTTP errors", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:provider-error]]"
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("template-fallback");
  expect(getCoverage(body).failedTypes).toEqual(["Positive"]);

  const stats = await getStats(request);
  expect(stats.totalCalls).toBe(1);
});

test("rejects empty requests before contacting the AI provider", async ({
  request,
}) => {
  const response = await request.post("/api/generate", {
    data: { ticket: " ", selectedTypes: ["Positive"] },
  });

  expect(response.status()).toBe(400);

  const stats = await getStats(request);
  expect(stats.totalCalls).toBe(0);
});
