import { expect, test, type APIRequestContext } from "@playwright/test";

const mockService = "http://127.0.0.1:11435";

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

async function getStats(request: APIRequestContext) {
  const response = await request.get(mockService + "/__stats");
  return (await response.json()) as Record<string, unknown>;
}

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("returns a valid AI case for a selected category", async ({ request }) => {
  const { response, body } = await generate(request, "A simple profile requirement");

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(Array.isArray(body.testCases)).toBeTruthy();

  const cases = body.testCases as Array<Record<string, unknown>>;
  expect(cases).toHaveLength(1);
  expect(cases[0].type).toBe("Positive");
  expect(cases[0].id).toBe("TC001");
  expect(cases[0].steps).toHaveLength(4);
});

test("accepts valid JSON wrapped in Markdown fences", async ({ request }) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:fenced]]"
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(1);
});

test("characterizes that fewer cases than requested are accepted as complete", async ({
  request,
}) => {
  const { response, body } = await generate(request, "Requirement [[mock:short]]");

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(1);

  const stats = await getStats(request);
  expect(stats.totalCalls).toBe(1);
});

test("characterizes silent partial success when one requested category fails", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:partial]]",
    ["Positive", "Negative", "Edge Cases"]
  );

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.partial).toBeUndefined();

  const cases = body.testCases as Array<Record<string, unknown>>;
  expect(cases.map((item) => item.type)).toEqual(["Positive", "Edge Cases"]);

  const stats = await getStats(request);
  expect(stats.totalCalls).toBe(4);
});

test("characterizes title-only deduplication of distinct same-title cases", async ({
  request,
}) => {
  const { response, body } = await generate(
    request,
    "Requirement [[mock:duplicate-title]]"
  );

  expect(response.status()).toBe(200);
  expect(body.testCases).toHaveLength(1);
});

test("preserves all valid cases when the model returns many", async ({
  request,
}) => {
  const { response, body } = await generate(request, "Requirement [[mock:many]]");

  expect(response.status()).toBe(200);
  expect(body.generationMethod).toBe("ai");
  expect(body.testCases).toHaveLength(12);
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
