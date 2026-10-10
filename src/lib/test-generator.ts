
export type TestType = "Positive" | "Negative" | "Edge Cases";

export interface TestCase {
  id: string;
  title: string;
  type: TestType;
  steps: string[];
  expectedResult: string;
}

export function generateTestCases(
  ticket: string
): TestCase[] {
  const requirement = ticket.trim();

  return [
    {
      id: "TC001",
      title: "Verify expected functionality",
      type: "Positive",
      steps: [
        "Open the application",
        "Navigate to the feature described in the ticket",
        "Perform the expected user action",
      ],
      expectedResult:
        requirement ||
        "The feature works as expected.",
    },
    {
      id: "TC002",
      title: "Verify invalid input handling",
      type: "Negative",
      steps: [
        "Navigate to the feature",
        "Provide invalid or incomplete input where applicable",
        "Submit the action",
      ],
      expectedResult:
        "The application handles invalid input correctly and displays appropriate feedback.",
    },
    {
      id: "TC003",
      title: "Verify boundary conditions",
      type: "Edge Cases",
      steps: [
        "Navigate to the feature",
        "Try empty, minimum, maximum, or unusual inputs where applicable",
        "Observe the application behavior",
      ],
      expectedResult:
        "The application handles boundary conditions without unexpected errors.",
    },
  ];
}
