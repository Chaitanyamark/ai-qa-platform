import { expect, test } from "@playwright/test";

const minimalCase = {
  id: "TC001",
  title: "Verify that the page displays the QA heading",
  type: "Positive",
  priority: "Medium",
  preconditions: [],
  steps: ["Open the page.", "Verify the heading."],
  expectedResult: "The QA heading is visible on the page.",
  requirementRef: "REQ-001",
  automationPlan: {
    mode: "automated",
    actions: [{ action: "assert-text", text: "QA" }],
  },
};

test("requires generated test cases and rejects malformed JSON", async ({ request }) => {
  const missingCases = await request.post("/api/execute", {
    data: { url: "https://example.com", testCases: [] },
  });
  expect(missingCases.status()).toBe(400);

  const malformed = await request.post("/api/execute", {
    data: Buffer.from("{"),
    headers: { "content-type": "application/json" },
  });
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toMatchObject({
    error: "The execution request must contain valid JSON.",
  });
});

test("rejects private and alternate-form target addresses before launching a browser", async ({
  request,
}) => {
  for (const url of [
    "http://localhost",
    "http://127.0.0.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://169.254.169.254",
  ]) {
    const response = await request.post("/api/execute", {
      data: { url, testCases: [minimalCase] },
    });
    expect(response.status(), url).toBe(400);
  }
});

test("rejects nonstandard ports and unsupported browser actions", async ({ request }) => {
  const portResponse = await request.post("/api/execute", {
    data: { url: "https://example.com:8443", testCases: [minimalCase] },
  });
  expect(portResponse.status()).toBe(400);

  const actionResponse = await request.post("/api/execute", {
    data: {
      url: "https://example.com",
      testCases: [
        {
          ...minimalCase,
          automationPlan: {
            mode: "automated",
            actions: [{ action: "run-javascript", code: "alert(1)" }],
          },
        },
      ],
    },
  });
  expect(actionResponse.status()).toBe(400);
});
