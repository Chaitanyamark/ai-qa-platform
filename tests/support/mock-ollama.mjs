import { createServer } from "node:http";

const port = Number(process.env.MOCK_OLLAMA_PORT) || 11435;
const state = {
  totalCalls: 0,
  callsByType: {},
  lastPromptsByType: {},
};

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function extractCriteria(requirement) {
  const listed = requirement
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^\s*(\d+)[.)]\\?\s+(.+)$/);
      return match ? [{ reference: "AC-" + match[1], text: match[2].trim() }] : [];
    });

  if (listed.length > 0) return listed;

  const text = requirement
    .replace(/\[\[mock:[^\]]+\]\]/g, "")
    .replace(/^\s*#+\s*/gm, "")
    .trim();

  return text ? [{ reference: "Supplied requirement", text }] : [];
}

// This deterministic mock stands in for the model's semantic scenario planner.
// It deliberately splits independent negative conditions in the 15-criterion
// regression fixture; production code does not use these keyword rules.
function planScenarios(type, requirement) {
  if (requirement.includes("[[mock:many]]")) {
    return Array.from({ length: 12 }, (_, index) => ({
      scenarioId: type.replace(/\W/g, "") + "-S" + (index + 1),
      requirementRef: "Supplied requirement",
      objective: "Mock scenario " + (index + 1),
    }));
  }

  const criteria = extractCriteria(requirement);
  const scenarios = [];

  for (const criterion of criteria) {
    const text = criterion.text;
    let applies = false;

    if (type === "Positive") {
      applies = true;
    } else if (type === "Negative") {
      applies = /\b(invalid|reject|rejected|required|missing|duplicate|already|fail|error|mismatch|incorrect|expired|blank|malformed)\b/i.test(text);
    } else if (type === "Edge Cases") {
      applies = /\b(boundary|minimum|maximum|limit|whitespace|leading|trailing|retry|repeated|loading|timeout|concurrent|multiple)\b/i.test(text);
    } else if (type === "Integration") {
      applies = /\b(api|server|backend|database|service|network)\b/i.test(text);
    } else if (type === "Security") {
      applies = /\b(security|password|credential|authentication|authorization|permission)\b/i.test(text);
    } else if (type === "Usability") {
      applies = /\b(message|feedback|loading|retry|accessible|mask|guidance)\b/i.test(text);
    } else if (type === "Compatibility") {
      applies = /\b(browser|device|mobile|viewport|responsive|screen size)\b/i.test(text);
    }

    if (!applies) continue;

    const conditions =
      type === "Negative"
        ? text.split(/\s+and\s+(?=(?:(?:an?|the)\s+)?(?:invalid|expired|missing|duplicate|already|blank|malformed|incorrect))/i)
        : [text];

    conditions.forEach((condition, index) => {
      const scenarioIndex = scenarios.length + 1;
      scenarios.push({
        scenarioId:
          type.replace(/\W/g, "") +
          "-" +
          criterion.reference.replace(/\W/g, "") +
          "-" +
          index,
        requirementRef: criterion.reference,
        objective: condition.trim() || "Criterion behavior " + scenarioIndex,
      });
    });
  }

  return scenarios;
}

function makeCase(type, scenario, index, options = {}) {
  return {
    id: "MOCK" + String(index).padStart(3, "0"),
    scenarioId: scenario.scenarioId,
    title:
      options.title ||
      type + " scenario " + index + " verifies " + scenario.objective,
    type,
    priority: "Medium",
    preconditions: ["The test environment is available to the user."],
    steps: [
      "1. Open the account settings page.",
      "2. Enter the supplied synthetic test value.",
      "3. Submit the form using the visible save control.",
      "4. Review the resulting page state.",
    ],
    testData: options.testData || "Synthetic value: qa-user-" + index,
    expectedResult:
      options.expectedResult ||
      "The page displays the expected result for scenario " + index + ".",
    requirementRef: scenario.requirementRef,
  };
}

function makePayload(type, plannedScenarios, cases) {
  return {
    summary: "Deterministic mock response for " + type + ".",
    openQuestions: [],
    plannedScenarios,
    testCases: cases,
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return sendJson(response, 200, { ready: true });
  }

  if (request.method === "POST" && request.url === "/__reset") {
    state.totalCalls = 0;
    state.callsByType = {};
    state.lastPromptsByType = {};
    return sendJson(response, 200, { reset: true });
  }

  if (request.method === "GET" && request.url === "/__stats") {
    return sendJson(response, 200, state);
  }

  if (request.method !== "POST" || request.url !== "/api/chat") {
    return sendJson(response, 404, { error: "Unknown mock endpoint." });
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return sendJson(response, 400, { error: "Invalid request JSON." });
  }

  const prompt = String(body?.messages?.[1]?.content || "");
  const match = prompt.match(/test cases of type "([^"]+)"/i);
  const type = match?.[1] || "Positive";
  const requirement =
    prompt.match(/<requirement>\s*([\s\S]*?)\s*<\/requirement>/i)?.[1] || "";

  state.totalCalls += 1;
  state.callsByType[type] = (state.callsByType[type] || 0) + 1;
  state.lastPromptsByType[type] = prompt;

  if (requirement.includes("[[mock:provider-error]]")) {
    return sendJson(response, 503, { error: "Deterministic provider error." });
  }

  let content;
  let doneReason = "stop";
  const plannedScenarios = planScenarios(type, requirement);

  if (requirement.includes("[[mock:malformed]]")) {
    content = '{"testCases": [}';
  } else if (requirement.includes("[[mock:empty]]")) {
    content = "";
  } else if (requirement.includes("[[mock:missing-field]]")) {
    const item = makeCase(type, plannedScenarios[0], 1);
    delete item.expectedResult;
    content = JSON.stringify(
      makePayload(type, plannedScenarios, [item])
    );
  } else if (requirement.includes("[[mock:missing-requirement-ref]]")) {
    const item = makeCase(type, plannedScenarios[0], 1);
    delete item.requirementRef;
    content = JSON.stringify(
      makePayload(type, plannedScenarios, [item])
    );
  } else if (requirement.includes("[[mock:unexpected-type]]")) {
    const item = makeCase(type, plannedScenarios[0], 1);
    item.steps = "not-an-array";
    content = JSON.stringify(
      makePayload(type, plannedScenarios, [item])
    );
  } else if (requirement.includes("[[mock:truncated]]")) {
    content = JSON.stringify(
      makePayload(type, plannedScenarios, [
        makeCase(type, plannedScenarios[0], 1),
      ])
    );
    doneReason = "length";
  } else if (
    requirement.includes("[[mock:partial]]") &&
    type === "Negative"
  ) {
    content = '{"testCases": [}';
  } else {
    let scenarios = plannedScenarios;
    if (requirement.includes("[[mock:duplicate-title]]")) {
      scenarios = plannedScenarios.slice(0, 4);
    }

    let cases = scenarios.map((scenario, index) =>
      makeCase(type, scenario, index + 1)
    );

    if (requirement.includes("[[mock:short]]")) {
      cases = cases.slice(0, 1);
    }

    if (requirement.includes("[[mock:duplicate-title]]")) {
      cases = [
        makeCase(type, scenarios[0], 1, {
          title: "Verify that a valid profile update is saved",
          testData: "Display name: Asha",
          expectedResult: "The profile displays the saved name Asha after reload.",
        }),
        makeCase(type, scenarios[1], 2, {
          title: "Verify that a valid profile update is saved",
          testData: "Display name: Kavya",
          expectedResult: "The profile displays the saved name Kavya after reload.",
        }),
      ];
    } else if (requirement.includes("[[mock:exact-duplicate]]")) {
      const scenario = scenarios[0];
      const exactCase = makeCase(type, scenario, 1);
      cases = [exactCase, { ...exactCase, id: "MOCK002" }];
    } else if (
      requirement.includes("[[mock:testdata-object]]") &&
      cases.length > 0
    ) {
      cases[0].testData = {
        email: "qa-user@example.test",
        password: "Synthetic-Pass-123",
      };
    }

    content = JSON.stringify(makePayload(type, scenarios, cases));
    if (requirement.includes("[[mock:fenced]]")) {
      content =
        String.fromCharCode(96).repeat(3) +
        "json\n" +
        content +
        "\n" +
        String.fromCharCode(96).repeat(3);
    }
  }

  return sendJson(response, 200, {
    message: { role: "assistant", content },
    done_reason: doneReason,
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log("Mock Ollama listening at http://127.0.0.1:" + port);
});
