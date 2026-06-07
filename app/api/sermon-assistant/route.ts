import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { deepSeekReasonerModel } from "@/lib/ai-providers";

export const runtime = "nodejs";
export const maxDuration = 120;

const RequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("outline"),
    rawTranscript: z.string().min(1).max(120000),
  }),
  z.object({
    action: z.literal("command"),
    rawTranscript: z.string().min(1).max(120000),
    organizedMarkdown: z.string().max(120000).optional().default(""),
    command: z.string().min(1).max(2000),
  }),
]);

function outlineSystemPrompt(): string {
  return [
    "You are Nexus Sermon Assistant.",
    "Transform spoken transcript into a clear, well-organized sermon manuscript outline in Markdown.",
    "The user wants organized notes they can preach from and manually edit later.",
    "Use this structure whenever source supports it:",
    "# Sermon Title",
    "## Central Theme",
    "## Key Scriptures",
    "### Scripture Reference",
    "> Full scripture text",
    "- Why it matters in the sermon",
    "## Opening",
    "## Main Movement 1",
    "## Main Movement 2",
    "## Main Movement 3",
    "## Supporting Notes",
    "## Invitation / Response",
    "## Closing Prayer",
    "Keep it faithful to the transcript.",
    "If the speaker directly quoted scripture or clearly alluded to a scripture, identify it and include the full verse text when you can do so with high confidence.",
    "If a hinted scripture is plausible but not certain, place it under Key Scriptures with a note saying it is a likely reference.",
    "Do not invent stories, sermon points, or references not grounded in the transcript.",
    "Use bullet points for subpoints, transitions, applications, and supporting notes.",
    "Use blockquotes for scripture quotations.",
    "Preserve the speaker's language where it is strong, but rewrite into a clean, readable structure.",
    "Output only final Markdown.",
  ].join("\n");
}

function commandSystemPrompt(): string {
  return [
    "You are Nexus Sermon Assistant.",
    "You receive: transcript, current outline, and a user command.",
    "Apply the command precisely and return the complete updated sermon outline in Markdown.",
    "Keep the outline well organized and preachable.",
    "Retain or improve the Key Scriptures section with full verse text for clearly identified scriptures and likely-reference notes for hints/allusions.",
    "Preserve unaffected sections.",
    "Do not add fabricated details not inferable from source material.",
    "Output only final Markdown.",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof RequestSchema>;
  try {
    parsed = RequestSchema.parse(await req.json() as unknown);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 },
    );
  }

  try {
    if (parsed.action === "outline") {
      const { text } = await generateText({
        model: deepSeekReasonerModel,
        temperature: 0.3,
        maxTokens: 2800,
        system: outlineSystemPrompt(),
        prompt: `RAW TRANSCRIPT:\n${parsed.rawTranscript}`,
      });

      return NextResponse.json({ markdown: text.trim() });
    }

    const { text } = await generateText({
      model: deepSeekReasonerModel,
      temperature: 0.35,
      maxTokens: 3200,
      system: commandSystemPrompt(),
      prompt: [
        `RAW TRANSCRIPT:\n${parsed.rawTranscript}`,
        `CURRENT OUTLINE:\n${parsed.organizedMarkdown}`,
        `COMMAND:\n${parsed.command}`,
      ].join("\n\n"),
    });

    return NextResponse.json({ markdown: text.trim() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 },
    );
  }
}