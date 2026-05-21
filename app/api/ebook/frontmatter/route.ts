import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { FrontMatterRequestSchema, FrontBackMatterSchema } from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = FrontMatterRequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input" }, { status: 400 });
  }

  try {
    const { object } = await generateObject({
      model: deepSeekModel,
      schema: FrontBackMatterSchema,
      mode: "tool",
      temperature: 0.2,
      system: `You are an editorial assistant writing the front and back matter of a published teaching book.

ABSOLUTE CONTENT RULE: Every sentence must come from the provided transcript. You may not add content, context, or ideas not present in the audio/transcript.

FRONT MATTER:
- preface: Drawn from the opening moments of the teaching. What did the author say at the start? Use their exact tone and words. 2–4 paragraphs.
- introduction: A written introduction to the full teaching. Synthesize the overarching theme and purpose of the teaching using ONLY what the author expressed. 3–5 paragraphs.

BACK MATTER:
- conclusion: Drawn from the closing moments of the teaching. How did the author wrap up? 2–4 paragraphs.
- aboutAuthor: ONLY write this if the author spoke about themselves, their background, or their story in the transcript. If they did not, return null.
- resourcesList: List any books, tools, websites, courses, or resources the author explicitly mentioned or recommended. Return as an array of strings (e.g., "The Bible, NIV translation"). If none mentioned, return [].

SCRIPTURE & QUOTE FORMATTING: Apply Chicago Manual of Style rules as established in the chapter content.
VOICE ENFORCEMENT: Match the author's tone profile and signature phrases.`,
      prompt: `Write the front and back matter for this ebook.

BOOK TITLE: ${input.architecture.bookTitle}
AUTHOR: ${input.architecture.authorName}

ARCHITECTURE CONTEXT:
- Chapters: ${input.architecture.chapters.map((c) => c.title).join(", ")}
- Front matter notes (opening): ${input.architecture.frontMatterNotes}
- Back matter notes (closing): ${input.architecture.backMatterNotes}

VOICE DNA:
${JSON.stringify(input.voiceDNA, null, 2)}

FULL TRANSCRIPT (source of truth — opening & closing only):
${input.masterTranscript.slice(0, 5000)}

[… middle omitted …]

${input.masterTranscript.slice(-3000)}`,
    });

    return NextResponse.json(object, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Front matter generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
