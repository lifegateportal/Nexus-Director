import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { deepSeekModel } from "@/lib/ai-providers";
import { IngestInputSchema, IngestResultSchema } from "@/lib/schemas/blueprint";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const input = IngestInputSchema.parse(json);

    const { object } = await generateObject({
      model: deepSeekModel,
      schema: IngestResultSchema,
      mode: "json",
      temperature: 0.2,
      system:
        "You are the Nexus Director Analyst. Given raw media transcripts, workshop recordings, podcast streams, or content archives, extract a structured blueprint: map course chapters, identify key semantic segments, categorise all assets by type, and define the workflow steps needed to build a premium digital product.",
      prompt: [
        "Analyse the source content and extract a structured blueprint.",
        "- Identify logical chapters or modules as workflow steps with clear labels and intent.",
        "- Categorise all referenced media assets by type (video, audio, document, log).",
        "- Flag content gaps, quality issues, or production risks.",
        "- Return only data that validates against the schema.",
        `Locale: ${input.locale}`,
        `Source: ${input.sourceText}`
      ].join("\n")
    });

    return NextResponse.json(object, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to ingest source media context", detail: message },
      { status: 400 }
    );
  }
}
