import type { TestCase } from "@/lib/test-generator-schema";

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function getCaseKey(testCase: TestCase): string {
  return JSON.stringify({
    type: testCase.type,
    title: normalize(testCase.title).toLowerCase(),
    preconditions: testCase.preconditions.map(normalize),
    steps: testCase.steps.map(normalize),
    testData: testCase.testData ? normalize(testCase.testData) : "",
    expectedResult: normalize(testCase.expectedResult),
    requirementRef: normalize(testCase.requirementRef),
  });
}

export function deduplicateTestCases<T extends TestCase>(
  testCases: T[]
): T[] {
  const seen = new Set<string>();

  return testCases.filter((testCase) => {
    const key = getCaseKey(testCase);

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}
