
import type {
  GenerationResult,
  TestCase,
  TestType,
} from "@/lib/test-generator-schema";

export function generateWithTemplates(
  ticket: string
): GenerationResult {
  const text = ticket.toLowerCase();

  const templates: Array<{
    title: string;
    type: TestType;
    priority: "High" | "Medium" | "Low";
    keywords: string[];
    steps: string[];
    expectedResult: string;
  }> = [
    {
      title: "Verify the primary requirement",
      type: "Positive",
      priority: "High",
      keywords: [],
      steps: [
        "Open the relevant application feature.",
        "Perform the action described in the requirement.",
        "Verify the resulting behavior.",
      ],
      expectedResult:
        "The feature behaves according to the supplied requirement.",
    },
    {
      title: "Verify invalid input handling",
      type: "Negative",
      priority: "High",
      keywords: ["invalid", "validation", "required", "input"],
      steps: [
        "Enter invalid or incomplete data.",
        "Submit the input.",
        "Observe the response.",
      ],
      expectedResult:
        "Invalid input is handled according to the specified rules.",
    },
    {
      title: "Verify error handling",
      type: "Negative",
      priority: "High",
      keywords: ["error", "failure", "unavailable", "timeout"],
      steps: [
        "Trigger the relevant failure condition in a test environment.",
        "Observe the resulting state.",
      ],
      expectedResult:
        "The failure is handled and appropriate feedback is provided.",
    },
    {
      title: "Verify loading behavior",
      type: "Positive",
      priority: "Medium",
      keywords: ["loading", "animation", "processing", "response"],
      steps: [
        "Start the operation.",
        "Observe the loading indicator.",
        "Wait for completion.",
      ],
      expectedResult:
        "Loading feedback appears and transitions to the final state.",
    },
    {
      title: "Verify boundary conditions",
      type: "Edge Cases",
      priority: "Medium",
      keywords: ["maximum", "minimum", "boundary", "limit", "range"],
      steps: [
        "Identify documented input boundaries.",
        "Test the boundary values.",
        "Observe the outcome.",
      ],
      expectedResult:
        "Boundary values follow the documented rules.",
    },
  ];

  const matching = templates.filter(
    (template) =>
      template.keywords.length === 0 ||
      template.keywords.some((keyword) => text.includes(keyword))
  );

  const testCases: TestCase[] = matching.map((template, index) => ({
    id: `TC${String(index + 1).padStart(3, "0")}`,
    title: template.title,
    type: template.type,
    priority: template.priority,
    preconditions: ["The relevant test environment is available."],
    steps: template.steps,
    expectedResult: template.expectedResult,
    requirementRef: "REQ-001: Supplied ticket (template fallback)",
  }));

  return {
    summary:
      "Template fallback used. Review these suggested scenarios against the actual acceptance criteria.",
    openQuestions: [
      "Are there additional business rules or acceptance criteria?",
    ],
    testCases,
    generationMethod: "template-fallback",
  };
}
