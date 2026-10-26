import { expect, test, type APIRequestContext } from "@playwright/test";

const mockPort = Number(process.env.MOCK_OLLAMA_PORT) || 11436;
const mockService = `http://127.0.0.1:${mockPort}`;

type Coverage = {
  requestedTypes: string[];
  targetCaseCounts: Array<{ type: string; count: number }>;
  caseCounts: Array<{ type: string; count: number }>;
  failedTypes: string[];
  underfilledTypes: string[];
  targetWasCapped: boolean;
  notApplicableTypes: string[];
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

test("reports complete coverage when every model-planned scenario is generated", async ({ request }) => {
  const { response, body } = await generate(request, "A simple profile requirement");

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(Array.isArray(body.testCases)).toBeTruthy();

  const cases = body.testCases as Array<Record<string, unknown>>;
  expect(cases).toHaveLength(1);
  expect(cases.every((item) => item.type === "Positive")).toBeTruthy();
  expect(cases[0].id).toBe("TC001");
  expect(cases[0].steps).toHaveLength(4);

  expect(getCoverage(body)).toMatchObject({
    status: "complete",
    targetCaseCounts: [{ type: "Positive", count: 1 }],
    caseCounts: [{ type: "Positive", count: 1 }],
  });
});

test("uses the model scenario plan for positive, negative and edge coverage", async ({
  request,
}) => {
  const ticket = [
    "Registration acceptance criteria:",
    "1. The user can register with valid details.",
    "2. Registration must reject an invalid email address.",
    "3. Leading and trailing whitespace is trimmed from the email.",
  ].join("\n");
  const { response, body } = await generate(request, ticket, [
    "Positive",
    "Negative",
    "Edge Cases",
  ]);

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(5);
  expect(getCoverage(body)).toMatchObject({
    status: "complete",
    targetCaseCounts: [
      { type: "Positive", count: 3 },
      { type: "Negative", count: 1 },
      { type: "Edge Cases", count: 1 },
    ],
    caseCounts: [
      { type: "Positive", count: 3 },
      { type: "Negative", count: 1 },
      { type: "Edge Cases", count: 1 },
    ],
  });
});

test("asks the model whether a category applies instead of guessing from keywords", async ({
  request,
}) => {
  const ticket = [
    "1. The user can update their profile name.",
    "2. The saved name appears in the profile header.",
  ].join("\n");
  const { response, body } = await generate(request, ticket, ["Negative"]);

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toEqual([]);
  expect(getCoverage(body)).toMatchObject({
    status: "partial",
    targetCaseCounts: [{ type: "Negative", count: 0 }],
    caseCounts: [{ type: "Negative", count: 0 }],
    notApplicableTypes: ["Negative"],
  });

  const stats = await getStats(request);
  expect(stats.totalCalls).toBe(1);
  const prompts = stats.lastPromptsByType as Record<string, string>;
  expect(prompts.Negative).toContain("Do not use a fixed count");
  expect(prompts.Negative).toContain("independently testable");
  expect(prompts.Negative).not.toMatch(/at least \d+ distinct test cases/i);
});

test("caps an oversized model scenario plan and reports the cap", async ({ request }) => {
  const ticket = Array.from(
    { length: 52 },
    (_, index) => `${index + 1}. The user can complete scenario ${index + 1}.`
  ).join("\n");
  const { response, body } = await generate(request, ticket);

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(50);
  expect(getCoverage(body)).toMatchObject({
    status: "partial",
    targetCaseCounts: [{ type: "Positive", count: 52 }],
    targetWasCapped: true,
  });

  const stats = await getStats(request);
  const schemaFormats = stats.schemaFormatByType as Record<string, unknown>;
  expect(schemaFormats.Positive).toMatchObject({
    type: "object",
    properties: {
      plannedScenarios: { type: "array" },
      testCases: { type: "array" },
    },
  });
  const responseBudgets = stats.numPredictByType as Record<string, number>;
  expect(responseBudgets.Positive).toBeGreaterThan(4096);
});

test("different 15-criterion tickets can produce different planned case counts", async ({
  request,
}) => {
  const straightforward = Array.from(
    { length: 15 },
    (_, index) => `${index + 1}. Reject an invalid token for resource ${index + 1}.`
  ).join("\n");
  const multiCondition = Array.from(
    { length: 15 },
    (_, index) =>
      `${index + 1}. Reject an invalid token and an expired token for resource ${index + 1}.`
  ).join("\n");

  const first = await generate(request, straightforward, ["Negative"]);
  const second = await generate(request, multiCondition, ["Negative"]);

  expect(first.response.status()).toBe(200);
  expect(second.response.status()).toBe(200);
  expect(first.body.generationMethod).toBe("ai");
  expect(second.body.generationMethod).toBe("ai");
  expect(first.body.testCases).toHaveLength(15);
  expect(second.body.testCases).toHaveLength(30);
  expect(getCoverage(first.body).targetCaseCounts).toEqual([
    { type: "Negative", count: 15 },
  ]);
  expect(getCoverage(second.body).targetCaseCounts).toEqual([
    { type: "Negative", count: 30 },
  ]);
  expect(getCoverage(first.body).status).toBe("complete");
  expect(getCoverage(second.body).status).toBe("complete");

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

test("fills a generic requirement reference when the model omits it", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:missing-requirement-ref]]"
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  const cases = body.testCases as Array<Record<string, unknown>>;
  expect(cases).toHaveLength(1);
  expect(cases.every((item) => item.requirementRef === "Supplied requirement")).toBeTruthy();
  expect(getCoverage(body).status).toBe("complete");
});

test("reports a partial result when a category returns fewer than its dynamic target", async ({
  request,
}) => {
  const ticket = [
    "Requirement [[mock:short]]",
    "1. A valid account is registered.",
    "2. A success message is displayed.",
    "3. The account details are saved.",
    "4. The profile header shows the user's name.",
  ].join("\n");
  const { response, body } = await generate(request, ticket);

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(1);
  expect(getCoverage(body)).toMatchObject({
    status: "partial",
    targetCaseCounts: [{ type: "Positive", count: 4 }],
    underfilledTypes: ["Positive"],
    failedTypes: [],
    caseCounts: [{ type: "Positive", count: 1 }],
  });

  const stats = await getStats(request);
  expect(stats.totalCalls).toBe(1);
});

test("reports a failed category while preserving successful categories", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    [
      "Requirement [[mock:partial]]",
      "1. A valid profile can be saved.",
      "2. An invalid email is rejected.",
    ].join("\n"),
    ["Positive", "Negative", "Edge Cases"]
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  const cases = body.testCases as Array<Record<string, unknown>>;
  expect([...new Set(cases.map((item) => item.type))]).toEqual(["Positive"]);
  expect(getCoverage(body)).toMatchObject({
    status: "partial",
    requestedTypes: ["Positive", "Negative", "Edge Cases"],
    targetCaseCounts: [
      { type: "Positive", count: 2 },
      { type: "Negative", count: 0 },
      { type: "Edge Cases", count: 0 },
    ],
    failedTypes: ["Negative"],
    underfilledTypes: [],
    notApplicableTypes: ["Edge Cases"],
    caseCounts: [
      { type: "Positive", count: 2 },
      { type: "Negative", count: 0 },
      { type: "Edge Cases", count: 0 },
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
    [
      "Requirement [[mock:duplicate-title]]",
      "1. The profile can be edited.",
      "2. The profile can be saved.",
      "3. The profile shows the saved value.",
      "4. The profile remains updated after reload.",
    ].join("\n")
  );

  expect(response.status()).toBe(200);
  const cases = body.testCases as Array<Record<string, unknown>>;
  expect(cases).toHaveLength(2);
  expect(cases.map((testCase) => testCase.testData)).toEqual([
    "Display name: Asha",
    "Display name: Kavya",
  ]);
  expect(getCoverage(body)).toMatchObject({
    status: "partial",
    targetCaseCounts: [{ type: "Positive", count: 4 }],
    underfilledTypes: ["Positive"],
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
