import { callLLM, MIN_CASES_PER_TYPE } from "@/lib/ai-provider";
import { deduplicateTestCases as deduplicateCases } from "@/lib/test-case-deduplication";
import { generateWithTemplates } from "@/lib/template-generator";
import {
  GenerationResultSchema,
  type TestType as GeneratedTestType,
  type TestCase as GeneratedTestCase,
  type GenerationCoverage,
  type GenerationResult,
} from "@/lib/test-generator-schema";

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
  failedTypes: GeneratedTestType[] = [],
  minimumCasesPerType = MIN_CASES_PER_TYPE
): GenerationCoverage {
  const caseCounts = requestedTypes.map((type) => ({
    type,
    count: testCases.filter((testCase) => testCase.type === type).length,
  }));
  const underfilledTypes = caseCounts
    .filter(
      ({ type, count }) =>
        count < minimumCasesPerType && !failedTypes.includes(type)
    )
    .map(({ type }) => type);

  return {
    requestedTypes,
    minimumCasesPerType,
    caseCounts,
    failedTypes,
    underfilledTypes,
    status:
      failedTypes.length > 0 || underfilledTypes.length > 0
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

  try {
    // Stage 1: call the configured local AI model.
    const raw = await callLLM(requirement, selectedTypes);

    // Stage 2: normalize type labels, then validate the shape.
    const validated = GenerationResultSchema.parse(
      normalizeRawTypes(raw, selectedTypes)
    );
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
      throw new Error(
        `The AI returned no sufficiently detailed test cases ` +
          `(raw: ${validated.testCases.length}, ` +
          `after type filter: ${selectedCases.length}, ` +
          `after dedupe: ${uniqueCases.length}, ` +
          `after detail filter: 0). ` +
          "Review the AI prompt in src/lib/ai-provider.ts."
      );
    }

    const testCases = assignTestCaseIds(detailedCases);

    return {
      ...validated,
      testCases,
      generationMethod: "ai",
      coverage: buildCoverage(
        selectedTypes,
        testCases,
        raw.failedTypes,
        raw.minimumCasesPerType
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
      deduplicateTestCases(selectedFallbackCases)
    );

    return {
      ...fallback,
      testCases: fallbackCases,
      generationMethod: "template-fallback",
      // Add `fallbackReason: z.string().optional()` to GenerationResultSchema.
      fallbackReason,
      coverage: buildCoverage(selectedTypes, fallbackCases, selectedTypes),
    };
  }
}
