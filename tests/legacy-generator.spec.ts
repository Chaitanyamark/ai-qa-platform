import { expect, test } from "@playwright/test";
import { generateTestCases } from "../src/lib/test-generator";

test("keeps the original synchronous template API usable", () => {
  const cases = generateTestCases("Update a profile display name");

  expect(cases.length).toBeGreaterThan(0);
  expect(cases.every((item) => typeof item.title === "string")).toBeTruthy();
  expect(cases.every((item) => Array.isArray(item.steps))).toBeTruthy();
  expect(cases.every((item) => typeof item.expectedResult === "string")).toBeTruthy();
});
