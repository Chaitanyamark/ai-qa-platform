import { callLLM } from "@/lib/ai-provider";
import { deduplicateTestCases as deduplicateCases } from "@/lib/test-case-deduplication";
import { generateWithTemplates } from "@/lib/template-generator";
import {
  AutomationPlanSchema,
  GenerationResultSchema,
  type TestType as GeneratedTestType,
  type TestCase as GeneratedTestCase,
  type GenerationCoverage,
  type GenerationResult,
} from "@/lib/test-generator-schema";
import {
  buildRequirementCoverage,
  extractRequirementItems,
  normalizeRequirementReference,
  type RequirementItem,
} from "@/lib/requirement-traceability";

const DEFAULT_TEST_TYPES: GeneratedTestType[] = [
  "Positive",
  "Negative",
  "Edge Cases",
];

const MAX_REQUIREMENT_LENGTH = 20000;
// Lower this to 2 if your local model keeps producing short step lists.
const MIN_STEPS_FOR_DETAILED_CASE = 3;
const MAX_TEST_CASES = 50;

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

// "Edge Case", "edge-cases", "EDGE CASES" -> "edgecase"
function typeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/s$/, "");
}

/**
 * Maps whatever label the model used ("Edge Case", "negative", ...) onto the
 * exact test type the user selected. Must run BEFORE schema validation, because
 * a strict z.enum would otherwise reject the whole response.
 */
function normalizeRawTypes(raw: unknown, selectedTypes: GeneratedTestType[]): unknown {
  if (!raw || typeof raw !== "object") return raw;

  const obj = raw as { testCases?: unknown };
  if (!Array.isArray(obj.testCases)) return raw;

  const lookup = new Map<string, GeneratedTestType>(
    selectedTypes.map((type) => [typeKey(type), type])
  );

  return {
    ...obj,
    testCases: obj.testCases.map((item) => {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { type?: unknown }).type === "string"
      ) {
        const canonical = lookup.get(
          typeKey((item as { type: string }).type)
        );
        if (canonical) {
          return { ...item, type: canonical };
        }
      }
      return item;
    }),
  };
}

function normalizeRawAutomationPlans(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as { testCases?: unknown };
  if (!Array.isArray(obj.testCases)) return raw;

  return {
    ...obj,
    testCases: obj.testCases.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const testCase = item as Record<string, unknown>;
      const plan = AutomationPlanSchema.safeParse(testCase.automationPlan);
      return {
        ...testCase,
        automationPlan: plan.success
          ? plan.data
          : {
              mode: "manual",
              reason: testCase.automationPlan
                ? "The generated action plan did not match the supported browser actions."
                : "The model did not provide a supported browser action plan.",
            },
      };
    }),
  };
}

function normalizeRawRequirementRefs(
  raw: unknown,
  requirements: RequirementItem[],
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as { testCases?: unknown };
  if (!Array.isArray(obj.testCases)) return raw;

  return {
    ...obj,
    testCases: obj.testCases.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const testCase = item as Record<string, unknown>;
      const requirementRef =
        typeof testCase.requirementRef === "string"
          ? normalizeRequirementReference(testCase.requirementRef, requirements)
          : "UNMAPPED";
      return { ...testCase, requirementRef };
    }),
  };
}

function isMeaningfulTestCase(testCase: GeneratedTestCase): boolean {
  const title = normalizeText(testCase.title);
  const expectedResult = normalizeText(testCase.expectedResult);

  // Reject empty or excessively generic titles.
  if (
    title.length < 8 ||
    /^(verify the primary requirement|test case \d+)$/i.test(title)
  ) {
    return false;
  }

  // A test must explain what to do, not just say "perform the action".
  const meaningfulSteps = testCase.steps
    .map(normalizeText)
    .filter((step) => step.length >= 8);

  if (meaningfulSteps.length < MIN_STEPS_FOR_DETAILED_CASE) {
    return false;
  }

  // Expected results should describe an observable outcome.
  if (
    expectedResult.length < 20 ||
    /^(the feature behaves according to the supplied requirement|expected result)$/i.test(
      expectedResult
    )
  ) {
    return false;
  }

  return true;
}

function deduplicateTestCases(
  testCases: GeneratedTestCase[]
): GeneratedTestCase[] {
  return deduplicateCases(testCases).slice(0, MAX_TEST_CASES);
}

function assignTestCaseIds(testCases: GeneratedTestCase[]): GeneratedTestCase[] {
  return testCases.map((testCase, index) => ({
    ...testCase,
    id: `TC${String(index + 1).padStart(3, "0")}`,
    title: normalizeText(testCase.title),
    preconditions: testCase.preconditions.map(normalizeText),
    steps: testCase.steps.map(normalizeText),
    expectedResult: normalizeText(testCase.expectedResult),
    requirementRef: normalizeText(testCase.requirementRef),
    ...(testCase.testData
      ? { testData: testCase.testData.trim() }
      : {}),
  }));
}

function filterSelectedTypes(
  testCases: GeneratedTestCase[],
  selectedTypes: GeneratedTestType[]
): GeneratedTestCase[] {
  const allowedTypes = new Set(selectedTypes);

  return testCases.filter((testCase) =>
    allowedTypes.has(testCase.type)
  );
}

function buildCoverage(
  requestedTypes: GeneratedTestType[],
  testCases: GeneratedTestCase[],
  targetCaseCounts: Array<{ type: GeneratedTestType; count: number }>,
  failedTypes: GeneratedTestType[] = [],
  targetWasCapped = false,
  notApplicableTypes: GeneratedTestType[] = [],
  missingRequirementIds: string[] = [],
): GenerationCoverage {
  const caseCounts = requestedTypes.map((type) => ({
    type,
    count: testCases.filter((testCase) => testCase.type === type).length,
  }));
  const underfilledTypes = caseCounts
    .filter(
      ({ type, count }) =>
        count <
          (targetCaseCounts.find((target) => target.type === type)?.count ?? 0) &&
        !failedTypes.includes(type) &&
        !notApplicableTypes.includes(type)
    )
    .map(({ type }) => type);

  return {
    requestedTypes,
    targetCaseCounts,
    caseCounts,
    failedTypes,
    underfilledTypes,
    targetWasCapped,
    notApplicableTypes,
    missingRequirementIds,
    status:
      failedTypes.length > 0 ||
      underfilledTypes.length > 0 ||
      targetWasCapped ||
      notApplicableTypes.length > 0 ||
      missingRequirementIds.length > 0
        ? "partial"
        : "complete",
  };
}

export type TestType = "Positive" | "Negative" | "Edge Cases";

export interface TestCase {
  id: string;
  title: string;
  type: TestType;
  steps: string[];
  expectedResult: string;
}

/**
 * Keep the original synchronous template API available while the dashboard
 * is migrated to the AI generation endpoint in a separate change.
 */
export function generateTestCases(ticket: string): TestCase[] {
  return generateWithTemplates(ticket).testCases
    .filter(
      (testCase) =>
        testCase.type === "Positive" ||
        testCase.type === "Negative" ||
        testCase.type === "Edge Cases"
    )
    .map(({ id, title, type, steps, expectedResult }) => ({
      id,
      title,
      type: type as TestType,
      steps,
      expectedResult,
    }));
}


export async function generateTestCasesWithAI(
  ticket: string,
  selectedTypes: GeneratedTestType[] = DEFAULT_TEST_TYPES
): Promise<GenerationResult> {
  const requirement = ticket.trim();

  if (!requirement) {
    throw new Error(
      "Enter a Jira ticket, application description, or acceptance criteria."
    );
  }

  if (requirement.length > MAX_REQUIREMENT_LENGTH) {
    throw new Error(
      `The requirement must be ${MAX_REQUIREMENT_LENGTH.toLocaleString()} characters or fewer.`
    );
  }

  if (selectedTypes.length === 0) {
    throw new Error("Select at least one test type.");
  }

  let fallbackReason = "";
  const requirements = extractRequirementItems(requirement);

  try {
    // Stage 1: call the configured local AI model.
    const raw = await callLLM(requirement, selectedTypes);

    // Stage 2: normalize type labels, then validate the shape.
    const normalized = normalizeRawRequirementRefs(
      normalizeRawAutomationPlans(normalizeRawTypes(raw, selectedTypes)),
      requirements,
    );
    const validated = GenerationResultSchema.parse(normalized);
    console.log("[testgen] raw cases:", validated.testCases.length);

    // Stage 3: keep only selected categories.
    const selectedCases = filterSelectedTypes(
      validated.testCases,
      selectedTypes
    );
    console.log("[testgen] after type filter:", selectedCases.length);

    // Stage 4: remove duplicate titles.
    const uniqueCases = deduplicateTestCases(selectedCases);
    console.log("[testgen] after dedupe:", uniqueCases.length);

    // Stage 5: reject generic cases without meaningful steps.
    const detailedCases = uniqueCases.filter(isMeaningfulTestCase);
    console.log("[testgen] after meaningful filter:", detailedCases.length);

    if (detailedCases.length === 0) {
      const requirementCoverage = buildRequirementCoverage(requirements, []);
      const missingRequirementIds = requirementCoverage
        .filter((item) => item.status === "missing")
        .map((item) => item.requirementId);
      return {
        ...validated,
        testCases: [],
        requirementCoverage,
        generationMethod: "ai",
        coverage: buildCoverage(
          selectedTypes,
          [],
          raw.targetCaseCounts,
          raw.failedTypes,
          raw.targetWasCapped,
          raw.notApplicableTypes,
          missingRequirementIds,
        ),
      };
    }

    const testCases = assignTestCaseIds(detailedCases);
    const requirementCoverage = buildRequirementCoverage(requirements, testCases);
    const missingRequirementIds = requirementCoverage
      .filter((item) => item.status === "missing")
      .map((item) => item.requirementId);

    return {
      ...validated,
      testCases,
      requirementCoverage,
      generationMethod: "ai",
      coverage: buildCoverage(
        selectedTypes,
        testCases,
        raw.targetCaseCounts,
        raw.failedTypes,
        raw.targetWasCapped,
        raw.notApplicableTypes,
        missingRequirementIds,
      ),
    };
  } catch (error) {
    fallbackReason =
      error instanceof Error ? error.message : String(error);
    console.error("AI test generation failed:", error);

    // Keep the existing fallback, but respect the user's selected types.
    const fallback = GenerationResultSchema.parse(
      generateWithTemplates(requirement)
    );
    const selectedFallbackCases = filterSelectedTypes(
      fallback.testCases,
      selectedTypes
    );

    const fallbackCases = assignTestCaseIds(
      deduplicateTestCases(
        selectedFallbackCases.map((testCase) => ({
          ...testCase,
          requirementRef: normalizeRequirementReference(
            testCase.requirementRef,
            requirements,
          ),
          automationPlan: {
            mode: "manual" as const,
            reason: "Template fallback cases require human review before execution.",
          },
        })),
      ),
    );
    const requirementCoverage = buildRequirementCoverage(requirements, fallbackCases);
    const missingRequirementIds = requirementCoverage
      .filter((item) => item.status === "missing")
      .map((item) => item.requirementId);
    const fallbackTargets = selectedTypes.map((type) => ({ type, count: 0 }));

    return {
      ...fallback,
      testCases: fallbackCases,
      requirementCoverage,
      generationMethod: "template-fallback",
      // Add `fallbackReason: z.string().optional()` to GenerationResultSchema.
      fallbackReason,
      coverage: buildCoverage(
        selectedTypes,
        fallbackCases,
        fallbackTargets,
        selectedTypes,
        false,
        [],
        missingRequirementIds,
      ),
    };
  }
}
