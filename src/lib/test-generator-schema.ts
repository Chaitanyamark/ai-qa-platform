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

const BrowserRoleSchema = z.enum([
  "alert",
  "button",
  "checkbox",
  "heading",
  "link",
  "radio",
  "status",
  "textbox",
]);

export const BrowserActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("navigate"),
    path: z
      .string()
      .min(1)
      .max(2000)
      .refine(
        (path) => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\"),
        "Navigation must use a same-origin path.",
      ),
  }),
  z.object({
    action: z.literal("fill"),
    label: z.string().min(1).max(200),
    value: z.string().max(1000),
  }),
  z.object({
    action: z.literal("click"),
    role: z.enum(["button", "link"]),
    name: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("assert-visible"),
    role: BrowserRoleSchema,
    name: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("assert-text"),
    text: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal("assert-url"),
    contains: z.string().min(1).max(500),
  }),
]);

export const AutomationPlanSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("automated"),
    actions: z.array(BrowserActionSchema).min(1).max(12).refine(
      (actions) => actions.some((action) => action.action.startsWith("assert-")),
      "An automated plan needs at least one assertion.",
    ),
  }),
  z.object({
    mode: z.literal("manual"),
    reason: z.string().min(1).max(500),
  }),
]);

export const RequirementCoverageItemSchema = z.object({
  requirementId: z.string().min(1),
  criterion: z.string().min(1),
  testCaseIds: z.array(z.string()),
  status: z.enum(["linked", "missing"]),
});

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
  automationPlan: AutomationPlanSchema.optional(),
});

export const GenerationResultSchema = z.object({
  summary: z.string(),
  openQuestions: z.array(z.string()),
  testCases: z.array(TestCaseSchema),
  requirementCoverage: z.array(RequirementCoverageItemSchema).optional(),
});

export type TestType = z.infer<typeof TestTypeSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export type AutomationPlan = z.infer<typeof AutomationPlanSchema>;
export type RequirementCoverageItem = z.infer<
  typeof RequirementCoverageItemSchema
>;

export type GenerationCoverage = {
  requestedTypes: TestType[];
  caseCounts: Array<{ type: TestType; count: number }>;
  failedTypes: TestType[];
  emptyTypes: TestType[];
  missingRequirementIds: string[];
  status: "complete" | "partial";
};

export type GenerationResult = z.infer<
  typeof GenerationResultSchema
> & {
  generationMethod: "ai" | "template-fallback";
  fallbackReason?: string;
  coverage?: GenerationCoverage;
};
