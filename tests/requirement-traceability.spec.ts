import { expect, test } from "@playwright/test";
import {
  buildRequirementCoverage,
  extractRequirementItems,
  normalizeRequirementReference,
} from "../src/lib/requirement-traceability";
import type { TestCase } from "../src/lib/test-generator-schema";

test("extracts every numbered acceptance criterion instead of using a fixed count", () => {
  const source = [
    "Acceptance Criteria",
    ...Array.from({ length: 15 }, (_, index) => `${index + 1}. Criterion ${index + 1} is observable.`),
  ].join("\n");
  const items = extractRequirementItems(source);

  expect(items).toHaveLength(15);
  expect(items[0].requirementId).toBe("AC-001");
  expect(items[14]).toEqual({
    requirementId: "AC-015",
    criterion: "Criterion 15 is observable.",
  });
});

test("maps references by exact criterion number, not a shared numeric prefix", () => {
  const items = extractRequirementItems(
    "Acceptance Criteria\n1. First criterion.\n10. Tenth criterion.",
  );

  expect(normalizeRequirementReference("AC-10", items)).toBe("AC-010");
  expect(normalizeRequirementReference("Acceptance Criterion 1", items)).toBe(
    "AC-001",
  );
});

test("shows criteria with no referenced test case as missing", () => {
  const items = extractRequirementItems(
    "Acceptance Criteria\n1. First criterion.\n2. Second criterion.",
  );
  const testCases = [
    {
      id: "TC001",
      title: "First case verifies the first criterion",
      type: "Positive",
      priority: "Medium",
      preconditions: [],
      steps: ["Open the first page."],
      expectedResult: "The first criterion is visible on the page.",
      requirementRef: "AC-001",
      automationPlan: { mode: "manual", reason: "Manual review." },
    },
  ] satisfies TestCase[];

  expect(buildRequirementCoverage(items, testCases)).toEqual([
    {
      requirementId: "AC-001",
      criterion: "First criterion.",
      testCaseIds: ["TC001"],
      status: "linked",
    },
    {
      requirementId: "AC-002",
      criterion: "Second criterion.",
      testCaseIds: [],
      status: "missing",
    },
  ]);
});
