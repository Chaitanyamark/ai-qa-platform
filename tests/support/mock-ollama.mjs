import { createServer } from "node:http";

const port = 11435;
const state = { totalCalls: 0, callsByType: {} };

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function makeCase(type, index, options = {}) {
  return {
    id: "MOCK" + String(index).padStart(3, "0"),
    title: options.title || type + " scenario " + index + " checks a distinct behavior",
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
    requirementRef: "REQ-1",
  };
}

function makePayload(type, cases) {
  return {
    summary: "Deterministic mock response for " + type + ".",
    openQuestions: [],
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
  const match = prompt.match(/distinct test cases of type "([^"]+)"/i);
  const type = match?.[1] || "Positive";
  const requirement = prompt.match(/<requirement>\s*([\s\S]*?)\s*<\/requirement>/i)?.[1] || "";

  state.totalCalls += 1;
  state.callsByType[type] = (state.callsByType[type] || 0) + 1;

  if (requirement.includes("[[mock:provider-error]]")) {
    return sendJson(response, 503, { error: "Deterministic provider error." });
  }

  let content;
  let doneReason = "stop";

  if (requirement.includes("[[mock:malformed]]")) {
    content = '{"testCases": [}';
  } else if (requirement.includes("[[mock:empty]]")) {
    content = "";
  } else if (requirement.includes("[[mock:missing-field]]")) {
    const item = makeCase(type, 1);
    delete item.expectedResult;
    content = JSON.stringify(makePayload(type, [item]));
  } else if (requirement.includes("[[mock:unexpected-type]]")) {
    const item = makeCase(type, 1);
    item.steps = "not-an-array";
    content = JSON.stringify(makePayload(type, [item]));
  } else if (requirement.includes("[[mock:truncated]]")) {
    content = JSON.stringify(makePayload(type, [makeCase(type, 1)]));
    doneReason = "length";
  } else if (
    requirement.includes("[[mock:partial]]") &&
    type === "Negative"
  ) {
    content = '{"testCases": [}';
  } else {
    let count = 5;
    if (requirement.includes("[[mock:short]]")) count = 1;
    if (requirement.includes("[[mock:many]]")) count = 12;

    let cases = Array.from({ length: count }, (_, index) =>
      makeCase(type, index + 1)
    );

    if (requirement.includes("[[mock:duplicate-title]]")) {
      cases = [
        makeCase(type, 1, {
          title: "Verify that a valid profile update is saved",
          testData: "Display name: Asha",
          expectedResult: "The profile displays the saved name Asha after reload.",
        }),
        makeCase(type, 2, {
          title: "Verify that a valid profile update is saved",
          testData: "Display name: Kavya",
          expectedResult: "The profile displays the saved name Kavya after reload.",
        }),
      ];
    }

    content = JSON.stringify(makePayload(type, cases));
    if (requirement.includes("[[mock:fenced]]")) {
      content = String.fromCharCode(96).repeat(3) + "json\n" + content + "\n" +
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
