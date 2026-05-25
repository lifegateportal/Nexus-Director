import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { FrontMatterRequestSchema, FrontBackMatterSchema } from "@/lib/schemas/ebook";
import { PREMIUM_BOOK_STYLE_RULES, READER_NORMALIZATION_RULES, SOURCE_LOCK_RULES } from "@/lib/editorial-style-bible";
import { stripAudienceLanguage } from "@/lib/editorial-style-bible";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = FrontMatterRequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input" }, { status: 400 });
  }

  const transcript = typeof input.masterTranscript === "string" ? input.masterTranscript : "";

  try {
    const { object } = await generateObject({
      model: deepSeekModel,
      schema: FrontBackMatterSchema,
      mode: "tool",
      temperature: 0.2,
      system: `You are an editorial assistant writing the front and back matter of a published teaching book.

ABSOLUTE CONTENT RULE — ZERO FABRICATION:
Every sentence must come verbatim-idea from the provided transcript. You may not add content, context, or ideas not present in the audio/transcript — not even plausible extensions, inferred background, theological context the author "probably" knows, or biographical details you can reasonably assume. If you cannot point to the exact idea in the transcript text below, delete the sentence. Write shorter output rather than pad with invented content.

════════════════════════════════════════════
PREFACE — STRICT GUARDRAILS
════════════════════════════════════════════
The preface is an author's note to a reader holding the book — not an address to a congregation.

WHAT THE PREFACE MUST BE:
- Written in first person as the author speaking directly to an individual reader.
- Grounded in what the author said about why this teaching matters, what prompted it, or what they hope it accomplishes.
- Warm, personal, and purposeful — the author's own voice explaining what the reader is about to receive.

HARD PROHIBITIONS — delete or rewrite every instance:
- Any greeting to a crowd: "Good morning," "Welcome everyone," "Thank you for being here," "It's good to see you all."
- Any acknowledgement of staff, choir, church workers, guests, or attendees.
- Any room/stage reference: "as we gather today," "in this house," "this morning as you sit here," "those of you in the room."
- Any sermon-opener command: "Turn with me to," "Open your Bibles to," "Let's pray," "Say amen."
- Any plural-crowd address: "you all," "each of you here today," "everyone in this room," "those of you joining us."
- Any live-event framing: "this series," "today's message," "last week we covered," "part 2 of our series."

REWRITE RULES FOR THE PREFACE:
- "You all" / "everyone here" → "you" (singular reader)
- "This morning's message" → "this book" or "these pages"
- "Those of you in the room" → "you, the reader"
- "We as a church" → omit or rephrase as the author's own conviction
- First-person plural "we" (as a congregation) → first-person singular "I" (as the author)

════════════════════════════════════════════
INTRODUCTION
════════════════════════════════════════════
- Speak in first person as the author introducing the book directly to the reader.
- Focus on the book's purpose, core themes, and invitation to the reader.
- Do not describe the author from a third-person perspective.
- 3–5 paragraphs. Apply all preface guardrails above.

════════════════════════════════════════════
BACK MATTER
════════════════════════════════════════════
- conclusion: Drawn from the closing moments of the teaching, rewritten as a book closing — not an altar call or dismissal. 2–4 paragraphs.
- aboutAuthor: ONLY write if the author spoke about themselves, their background, or their story. Return null if not.
- resourcesList: Books, tools, websites, or resources the author explicitly recommended. Return [] if none mentioned.

SCRIPTURE & QUOTE FORMATTING: Apply Chicago Manual of Style rules as established in the chapter content.
VOICE ENFORCEMENT: Match the author's tone profile and signature phrases.

${SOURCE_LOCK_RULES}

${READER_NORMALIZATION_RULES}

${PREMIUM_BOOK_STYLE_RULES}`,
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
${transcript.slice(0, 5000)}

[… middle omitted …]

${transcript.slice(-3000)}`,
    });

    return NextResponse.json({
      ...object,
      preface: stripAudienceLanguage(object.preface ?? ""),
      introduction: stripAudienceLanguage(object.introduction ?? ""),
      conclusion: stripAudienceLanguage(object.conclusion ?? ""),
      aboutAuthor: object.aboutAuthor ? stripAudienceLanguage(object.aboutAuthor) : null,
      resourcesList: (object.resourcesList ?? []).map((r) => stripAudienceLanguage(r)),
      scriptureIndex: (() => {
        const seenRefs = new Set<string>();
        return (input.architecture?.chapters ?? [])
          .flatMap((c) => c.quotesInChapter ?? [])
          .filter((q) => q.type === "scripture" && q.reference?.trim())
          .sort((a, b) => a.reference.localeCompare(b.reference))
          .reduce<string[]>((acc, q) => {
            const entry = `${q.reference}${q.translation ? ` (${q.translation})` : ""}`;
            if (!seenRefs.has(entry)) { seenRefs.add(entry); acc.push(entry); }
            return acc;
          }, []);
      })(),
    }, { status: 200 });
  } catch (err) {
    const opening = transcript.slice(0, 2600).trim();
    const middle = transcript.slice(2600, 5200).trim();
    const closing = transcript.slice(-2200).trim();
    return NextResponse.json({
      preface: stripAudienceLanguage(opening || "Preface unavailable."),
      introduction: stripAudienceLanguage(middle || opening || "Introduction unavailable."),
      conclusion: stripAudienceLanguage(closing || opening || "Conclusion unavailable."),
      aboutAuthor: null,
      resourcesList: [],
      scriptureIndex: [],
    }, { status: 200 });
  }
}
