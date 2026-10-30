import type {
  GenerationResult,
  TestCase,
  TestType,
} from "@/lib/test-generator-schema";
import { extractRequirementItems } from "@/lib/requirement-traceability";

const MAX_TITLE_CRITERION_LENGTH = 96;

function classifyCriterion(criterion: string): TestType {
  const text = criterion.toLowerCase();

  if (/\b(authentication|authorization|security|privacy|encryption|sensitive data|permission|role-based|access control|token|session)\b/.test(text)) {
    return "Security";
  }
  if (/\b(browser|device|viewport|screen size|operating system|chrome|firefox|safari)\b/.test(text)) {
    return "Compatibility";
  }
  if (/\b(api|third[- ]party|service|database|integration|synchroni[sz]e)\b/.test(text)) {
    return "Integration";
  }
  if (/\b(usability|accessible|accessibility|keyboard|screen reader|intuitive|readable)\b/.test(text)) {
    return "Usability";
  }
  if (/\b(leading|trailing|whitespace|boundary|minimum|maximum|limit|empty|blank|zero|repeated|rapid|simultaneous)\b/.test(text)) {
    return "Edge Cases";
  }
  if (/\b(invalid|incorrect|reject(?:ed|s)?|error|fail(?:ure|s|ed)?|mismatch|missing|must not|cannot|duplicate|already registered|unauthorized|blocked|required|exceed|not allowed)\b/.test(text)) {
    return "Negative";
  }
  return "Positive";
}
function titleCriterion(criterion: string): string {
  const normalized = criterion.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_TITLE_CRITERION_LENGTH
    ? `${normalized.slice(0, MAX_TITLE_CRITERION_LENGTH - 1)}…`
    : normalized;
}

export function generateWithTemplates(ticket: string): GenerationResult {
  const requirements = extractRequirementItems(ticket);
  const testCases: TestCase[] = requirements.map((requirement, index) => ({
    id: `TC${String(index + 1).padStart(3, "0")}`,
    title: `Review ${requirement.requirementId}: ${titleCriterion(requirement.criterion)}`,
    type: classifyCriterion(requirement.criterion),
    priority: "Medium",
    preconditions: [
      "An authorized test environment is available.",
      "Use synthetic data if the criterion requires input.",
    ],
    steps: [
      `Open the application feature relevant to ${requirement.requirementId}.`,
      `Perform the scenario described by this criterion: ${requirement.criterion}`,
      "Observe the resulting page, state, and feedback.",
      "Compare the observed behavior with the stated acceptance criterion.",
    ],
    expectedResult: `The application satisfies this criterion: ${requirement.criterion}`,
    requirementRef: requirement.requirementId,
    automationPlan: {
      mode: "manual",
      reason:
        "AI generation was unavailable. Review the criterion and add exact controls, test data, and assertions before automating.",
    },
  }));

  return {
    summary:
      "AI generation was unavailable. A manual fallback case was created for each extracted criterion; split criteria that contain multiple independent behaviors.",
    openQuestions: [
      "Do any criteria contain multiple independently testable behaviors that should become separate cases?",
    ],
    testCases,
    generationMethod: "template-fallback",
  };
}