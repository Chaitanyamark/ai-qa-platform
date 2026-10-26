import { expect, test, type APIRequestContext } from "@playwright/test";

const mockService = "http://127.0.0.1:11435";

type Coverage = {
  requestedTypes: string[];
  minimumCasesPerType: number;
  caseCounts: Array<{ type: string; count: number }>;
  failedTypes: string[];
  underfilledTypes: string[];
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

test("reports complete coverage when the requested minimum is met", async ({ request }) => {
  const { response, body } = await generate(request, "A simple profile requirement");

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(Array.isArray(body.testCases)).toBeTruthy();

  const cases = body.testCases as Array<Record<string, unknown>>;
  expect(cases).toHaveLength(5);
  expect(cases.every((item) => item.type === "Positive")).toBeTruthy();
  expect(cases[0].id).toBe("TC001");
  expect(cases[0].steps).toHaveLength(4);

  expect(getCoverage(body)).toMatchObject({
    status: "complete",
    minimumCasesPerType: 5,
    caseCounts: [{ type: "Positive", count: 5 }],
  });
});

test("accepts valid JSON wrapped in Markdown fences", async ({ request }) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:fenced]]"
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(5);
  expect(getCoverage(body).status).toBe("complete");
});

test("reports a partial result when a category returns fewer than the minimum", async ({
  request,
}) => {
  const { response, body } = await generate(request, "Requirement [[mock:short]]");

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(1);
  expect(getCoverage(body)).toMatchObject({
    status: "partial",
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
    underfilledTypes: [],
    caseCounts: [
      { type: "Positive", count: 5 },
      { type: "Negative", count: 0 },
      { type: "Edge Cases", count: 5 },
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
    status: "partial",
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
