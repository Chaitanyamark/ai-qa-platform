import type { RequirementCoverageItem, TestCase } from "./test-generator-schema";

export type RequirementItem = {
  requirementId: string;
  criterion: string;
};

const MAX_CRITERION_LENGTH = 1000;

function cleanCriterion(value: string): string {
  return value
    .replace(/^\s*[-*+]\s*/, "")
    .replace(/^\s*\*\*(.*?)\*\*\s*$/, "$1")
    .trim();
}

function makeId(number: number): string {
  return `AC-${String(number).padStart(3, "0")}`;
}

/** Extract explicit acceptance-criterion list items; never infer semantic coverage. */
export function extractRequirementItems(text: string): RequirementItem[] {
  const items: RequirementItem[] = [];
  const used = new Set<string>();
  let inAcceptanceCriteria = false;
  let nextNumber = 1;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/acceptance criteria|acceptance criterion/i.test(line)) {
      inAcceptanceCriteria = true;
      continue;
    }

    if (/^#{1,6}\s+/.test(line) && inAcceptanceCriteria) {
      inAcceptanceCriteria = false;
    }

    const explicit = line.match(
      /^\s*(?:[-*+]\s*)?(AC|REQ|Requirement|Acceptance\s+Criterion|Criterion)\s*[-#:]?\s*(\d{1,4})\s*[:.)-]\s*(.+)$/i,
    );
    const numbered = line.match(/^\s*(?:[-*+]\s*)?(\d{1,4})[.)]\s+(.+)$/);
    const bullet = inAcceptanceCriteria
      ? line.match(/^\s*[-*+]\s+(.+)$/)
      : null;

    const sourceText = explicit?.[3] ?? numbered?.[2] ?? bullet?.[1];
    if (!sourceText) continue;

    const number = explicit
      ? Number(explicit[2])
      : numbered
        ? Number(numbered[1])
        : nextNumber;
    nextNumber = Math.max(nextNumber, number + 1);

    const requirementId = explicit?.[1].toLowerCase() === "req"
      ? `REQ-${String(number).padStart(3, "0")}`
      : makeId(number);
    const criterion = cleanCriterion(sourceText).slice(0, MAX_CRITERION_LENGTH);

    if (!criterion || used.has(requirementId)) continue;
    used.add(requirementId);
    items.push({ requirementId, criterion });
  }

  if (items.length > 0) return items;

  const fallbackText = text.trim().slice(0, MAX_CRITERION_LENGTH);
  return fallbackText
    ? [{ requirementId: "REQ-001", criterion: fallbackText }]
    : [];
}

function referenceKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Map common model variants like AC-1 or "Requirement 1" to known IDs. */
export function normalizeRequirementReference(
  reference: string,
  requirements: RequirementItem[],
): string {
  const key = referenceKey(reference);
  const labeledReferences = [
    ...reference.matchAll(
      /\b(AC|REQ|Requirement|Acceptance\s+Criterion|Criterion)\s*[-#:]?\s*0*(\d+)\b/gi,
    ),
  ].map((match) => ({
    label: match[1].toLowerCase().replace(/\s+/g, " "),
    number: String(Number(match[2])),
  }));

  for (const item of requirements) {
    const idKey = referenceKey(item.requirementId);
    const match = item.requirementId.match(/^(?:AC|REQ)-(\d+)$/);
    if (!match) continue;

    const number = String(Number(match[1]));
    const isReqItem = item.requirementId.startsWith("REQ-");
    const labelMatches = labeledReferences.some(({ label, number: refNumber }) => {
      if (refNumber !== number) return false;
      if (label === "req") return isReqItem;
      if (label === "ac") return !isReqItem;
      return true;
    });
    const standaloneNumbers = [
      ...reference.matchAll(/(?:^|[^a-z0-9])0*(\d+)(?=$|[^a-z0-9])/gi),
    ].map((entry) => String(Number(entry[1])));
    const numberMatches = standaloneNumbers.includes(number);

    if (key === idKey || labelMatches || (!labeledReferences.length && numberMatches)) {
      return item.requirementId;
    }
  }

  if (
    requirements.length === 1 &&
    /supplied requirement|supplied ticket|requirement 1/i.test(reference)
  ) {
    return requirements[0].requirementId;
  }

  return "UNMAPPED";
}

export function buildRequirementCoverage(
  requirements: RequirementItem[],
  testCases: TestCase[],
): RequirementCoverageItem[] {
  return requirements.map((requirement) => {
    const testCaseIds = testCases
      .filter((testCase) => testCase.requirementRef === requirement.requirementId)
      .map((testCase) => testCase.id);

    return {
      ...requirement,
      testCaseIds,
      status: testCaseIds.length > 0 ? "linked" : "missing",
    };
  });
}
