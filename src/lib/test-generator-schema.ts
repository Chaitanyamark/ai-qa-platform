import { z } from "zod";

export const TestTypeSchema = z.enum([
  "Positive",
  "Negative",
  "Edge Cases",
  "Integration",
  "Security",
  "Usability",
  "Compatibility",
]);

export const TestCaseSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  type: TestTypeSchema,
  priority: z.enum(["High", "Medium", "Low"]),
  preconditions: z.array(z.string()),
  steps: z.array(z.string()).min(1),
  testData: z.string().optional(),
  expectedResult: z.string().min(1),
  requirementRef: z.string().min(1),
});

export const GenerationResultSchema = z.object({
  summary: z.string(),
  openQuestions: z.array(z.string()),
  testCases: z.array(TestCaseSchema),
});

export type TestType = z.infer<typeof TestTypeSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;

export type GenerationCoverage = {
  requestedTypes: TestType[];
  minimumCasesPerType: number;
  caseCounts: Array<{ type: TestType; count: number }>;
  failedTypes: TestType[];
  underfilledTypes: TestType[];
  status: "complete" | "partial";
};

export type GenerationResult = z.infer<
  typeof GenerationResultSchema
> & {
  generationMethod: "ai" | "template-fallback";
  fallbackReason?: string;
  coverage?: GenerationCoverage;
};
