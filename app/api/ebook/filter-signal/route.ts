import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekModel } from "@/lib/ai-providers";

export const runtime = "nodejs";
export const maxDuration = 60;

const RequestSchema = z.object({
  masterTranscript: z.string().min(50),
});

// Tiny schema — only extract start/end markers, NEVER the full transcript.
// Server reconstructs the cleaned transcript via string matching.
const MarkersSchema = z.object({
  teachingStartPhrase: z.string().describe("First 80-120 chars of the sentence where core teaching begins (verbatim)"),
  teachingEndPhrase: z.string().describe("Last 80-120 chars of the final teaching sentence before closing prayer/altar call (verbatim)"),
  removedCategories: z.array(
    z.enum([
      "opening-prayer", "closing-prayer", "announcement", "housekeeping",
      "altar-call", "offering-appeal", "greeting-pleasantries",
      "off-topic-tangent", "technical-break",
    ])
  ).default([]),
  summary: z.string().default(""),
});

export type FilterSignalResult = {
  cleanedTranscript: string;
  removedSegments: { reason: string; excerpt: string }[];
  summary: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = RequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid input" },
      { status: 400 }
    );
  }

  const transcript = input.masterTranscript;

  // Only sample the head + tail (non-teaching content is almost always at the edges).
  // Keep the LLM output tiny — just two phrase markers.
  const words = transcript.split(/\s+/);
  const headSample = words.slice(0, 2500).join(" ");
  const tailSample = words.length > 2500 ? words.slice(-1500).join(" ") : "";
  const sample = tailSample
    ? `${headSample}\n\n[…middle of transcript omitted…]\n\n${tailSample}`
    : headSample;

  try {
    const { object } = await generateObject({
      model: deepSeekModel,
      schema: MarkersSchema,
      mode: "tool",
      temperature: 0.1,
      system: `You are a content signal filter for a book production pipeline.

Find where the CORE TEACHING begins and ends in the transcript excerpt.

NON-TEACHING content (identify and skip):
- Opening/closing prayers and benedictions
- Church announcements and event notices
- Greetings: "Good morning", "how is everyone", banter before teaching
- Housekeeping: "turn to your neighbor", stand/sit cues, phone reminders
- Altar calls and salvation appeals
- Offering/tithing appeals
- Technical breaks

TEACHING content (preserve everything else):
- Scripture exposition, Bible references
- Theological and doctrinal points
- Stories and analogies that illustrate a teaching point
- Application, arguments, conclusions

Return VERBATIM phrases (exact words from the transcript) so the server can locate them.
If teaching starts at the very beginning, set teachingStartPhrase to the first sentence.
If no closing non-teaching is found, set teachingEndPhrase to the last teaching sentence.`,
      prompt: `Identify the teaching start and end markers:\n\n${sample}`,
    });

    // Reconstruct cleaned transcript using the markers (string-match, no LLM output of full text)
    let cleaned = transcript;

    const start = (object.teachingStartPhrase ?? "").trim();
    if (start.length > 20) {
      const idx = transcript.indexOf(start.slice(0, 60));
      if (idx > 10) cleaned = transcript.slice(idx);
    }

    const end = (object.teachingEndPhrase ?? "").trim();
    if (end.length > 20) {
      const searchKey = end.slice(0, 60);
      const idx = cleaned.lastIndexOf(searchKey);
      if (idx > 0) {
        const lineEnd = cleaned.indexOf("\n", idx + searchKey.length);
        cleaned = lineEnd > 0 ? cleaned.slice(0, lineEnd).trim() : cleaned;
      }
    }

    const removedSegments = object.removedCategories.map((reason) => ({ reason, excerpt: "" }));

    return NextResponse.json({
      cleanedTranscript: cleaned || transcript,
      removedSegments,
      summary: object.summary ||
        (removedSegments.length > 0 ? `Removed: ${object.removedCategories.join(", ")}` : "No non-teaching content detected"),
    }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signal filter failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


export const runtime = "nodejs";
export const maxDuration = 120;

const RequestSchema = z.object({
  masterTranscript: z.string().min(50),
});

export type FilterSignalResult = {
  cleanedTranscript: string;
  removedSegments: { reason: string; excerpt: string }[];
  summary: string;
};

const MetaSchema = z.object({
  removedSegments: z.array(
    z.object({
      reason: z.enum([
        "opening-prayer", "closing-prayer", "announcement", "housekeeping",
        "altar-call", "offering-appeal", "greeting-pleasantries",
        "off-topic-tangent", "technical-break",
      ]),
      excerpt: z.string().max(200),
    })
  ).default([]),
  summary: z.string().default(""),
});

const WHAT_TO_REMOVE = `WHAT TO REMOVE (strip every occurrence):
1. OPENING-PRAYER — opening prayer, invocation, or dedication before teaching.
2. CLOSING-PRAYER — closing prayer, benediction, or corporate prayer at the end.
3. ANNOUNCEMENT — church/event announcements, schedule notices, promotions.
4. HOUSEKEEPING — "welcome", "thanks for coming", "silence your phone", stand/sit cues, "turn to your neighbor and say…"
5. ALTAR-CALL — salvation appeals, "raise your hand if…", repeat-after-me prayers.
6. OFFERING-APPEAL — offering moments, tithing messages, giving appeals.
7. GREETING-PLEASANTRIES — "good morning", "how is everyone", extended greetings, banter before teaching.
8. OFF-TOPIC-TANGENT — personal anecdotes or jokes that do not illustrate a teaching point.
9. TECHNICAL-BREAK — "can everyone hear me", microphone issues, applause-only breaks.

WHAT TO KEEP — everything that is core teaching:
- Scripture exposition, Bible references, theological/doctrinal points
- Stories and analogies that directly illustrate a teaching point
- Application of principles, arguments, conclusions
- Quotes or proverbs used to support a teaching point

CRITICAL:
- Reproduce kept content VERBATIM — do not rephrase, condense, or edit.
- Preserve all slot markers ([Slot-N]) and separators (═══).
- Output ONLY the cleaned transcript text. No labels, no commentary, no JSON.`;

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = RequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid input" },
      { status: 400 }
    );
  }

  // Limit context to 12 000 words
  const words = input.masterTranscript.split(/\s+/);
  const transcript = words.length > 12_000
    ? words.slice(0, 12_000).join(" ") + "\n[… transcript continues beyond this filter window …]"
    : input.masterTranscript;

  try {
    // Step 1: Get the cleaned transcript as plain text (avoids JSON encoding of large strings)
    const { text: cleanedTranscript } = await generateText({
      model: deepSeekModel,
      temperature: 0.1,
      system: `You are a content signal filter for a book production pipeline.\n\n${WHAT_TO_REMOVE}`,
      prompt: `Filter this transcript to teaching-only content. Return ONLY the cleaned text:\n\n${transcript}`,
    });

    // Step 2: Lightweight metadata — small schema, fast call
    let meta = { removedSegments: [] as { reason: string; excerpt: string }[], summary: "" };
    try {
      const { object } = await generateObject({
        model: deepSeekModel,
        schema: MetaSchema,
        mode: "tool",
        temperature: 0.1,
        system: "You are a transcript analysis assistant.",
        prompt: `Compare the original and cleaned transcripts. List what was removed and write a one-sentence summary.\n\nORIGINAL (first 3000 chars):\n${transcript.slice(0, 3000)}\n\nCLEANED (first 3000 chars):\n${cleanedTranscript.slice(0, 3000)}`,
      });
      meta = { removedSegments: object.removedSegments, summary: object.summary };
    } catch {
      // metadata is optional — ignore failures
    }

    return NextResponse.json(
      { cleanedTranscript: cleanedTranscript.trim() || input.masterTranscript, ...meta },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signal filter failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = RequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid input" },
      { status: 400 }
    );
  }

  // Limit context — filter works on raw text; truncate at 12 000 words if very long
  const words = input.masterTranscript.split(/\s+/);
  const transcript = words.length > 12_000
    ? words.slice(0, 12_000).join(" ") + "\n[… transcript continues beyond this filter window …]"
    : input.masterTranscript;

  try {
    const { object } = await generateObject({
      model: deepSeekModel,
      schema: FilterResultSchema,
      mode: "tool",
      temperature: 0.1,
      system: `You are a content signal filter for a book production pipeline.

Your job is to identify and strip non-teaching content from a spoken sermon or teaching transcript, then return a clean teaching-only version.

════════════════════════════════════════════
WHAT TO REMOVE
════════════════════════════════════════════
Remove ALL of the following categories WITHOUT exception:

1. OPENING-PRAYER — Any opening prayer, invocation, or dedication before teaching begins.
2. CLOSING-PRAYER — Any closing prayer, benediction, or corporate prayer at the end.
3. ANNOUNCEMENT — Church or event announcements, schedule notices, promotional content.
4. HOUSEKEEPING — Administrative remarks: welcome greetings, thanks for coming, reminders to silence phones, calls to stand/sit, "turn to your neighbor and say…" instructions.
5. ALTAR-CALL — Altar calls, salvation appeals, "raise your hand if…" moments, repeat-after-me prayers.
6. OFFERING-APPEAL — Offering moments, tithing messages, financial giving appeals.
7. GREETING-PLEASANTRIES — Opening small talk, "good morning", "how is everyone", extended greetings, generic humor and banter before the teaching.
8. OFF-TOPIC-TANGENT — Personal anecdotes or stories that do not illustrate a teaching point, jokes unrelated to the message.
9. TECHNICAL-BREAK — Microphone issues, "can everyone hear me", applause breaks, mid-session pauses.

════════════════════════════════════════════
WHAT TO KEEP
════════════════════════════════════════════
Keep EVERYTHING that is part of the core teaching:
- Scripture exposition and Bible references
- The speaker's theological/doctrinal points
- Stories and analogies that directly illustrate a teaching point (keep these)
- Application of principles to real life
- Teaching points, arguments, and conclusions
- Any quotes or proverbs used to support a teaching point

════════════════════════════════════════════
CRITICAL OUTPUT RULES
════════════════════════════════════════════
- cleanedTranscript: Return ONLY the core teaching text. Preserve all slot markers ([Slot-N]) and separators (═══).
- Do NOT rephrase, edit, or condense the teaching content — reproduce it verbatim.
- removedSegments: List each distinct removed block with its category and first ~150 chars.
- teachingStartsAt: First sentence or phrase where the actual teaching begins.
- summary: E.g. "Removed opening prayer, 3 announcements, offering appeal, and altar call."`,
      prompt: `Filter this transcript to teaching-only content:\n\n${transcript}`,
    });

    return NextResponse.json(object, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Signal filter failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
