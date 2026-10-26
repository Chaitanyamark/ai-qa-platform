
import { NextResponse } from "next/server";
import { generateTestCasesWithAI } from "@/lib/test-generator";
import { TestTypeSchema } from "@/lib/test-generator-schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const ticket =
      typeof body.ticket === "string" ? body.ticket.trim() : "";

    if (!ticket) {
      return NextResponse.json(
        { error: "Enter a Jira ticket or acceptance criteria." },
        { status: 400 }
      );
    }

    if (ticket.length > 20000) {
      return NextResponse.json(
        { error: "The ticket must be 20,000 characters or fewer." },
        { status: 400 }
      );
    }

    const requestedTypes: unknown = body.selectedTypes;

    const selectedTypes = Array.isArray(requestedTypes)
      ? requestedTypes.filter(
          (type): type is string =>
            typeof type === "string" &&
            TestTypeSchema.safeParse(type).success
        )
      : ["Positive", "Negative", "Edge Cases"];

    const validTypes = [...new Set(selectedTypes)];

    if (validTypes.length === 0) {
      return NextResponse.json(
        { error: "Select at least one valid test type." },
        { status: 400 }
      );
    }

    const result = await generateTestCasesWithAI(
      ticket,
      validTypes as Array<
        | "Positive"
        | "Negative"
        | "Edge Cases"
        | "Integration"
        | "Security"
        | "Usability"
        | "Compatibility"
      >
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Test generation failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred during test generation.",
      },
      { status: 500 }
    );
  }
}
