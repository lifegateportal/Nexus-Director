import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekModel } from "@/lib/ai-providers";

export const runtime = "nodejs";
export const maxDuration = 120;

const RequestSchema = z.object({
  masterTranscript: z.string().min(50),
});

// What we ask the LLM to strip
const FilterResultSchema = z.object({
  cleanedTranscript: z.string(),
  removedSegments: z.array(
    z.object({
      reason: z.enum([
        "opening-prayer",
        "closing-prayer",
        "announcement",
        "housekeeping",
        "altar-call",
        "offering-appeal",
        "greeting-pleasantries",
        "off-topic-tangent",
        "technical-break",
      ]),
      excerpt: z.string().max(200), // first ~200 chars of what was removed
    })
  ),
  teachingStartsAt: z.string(), // first sentence of the core teaching
  summary: z.string(),          // one-sentence description of what was removed
});

export type FilterSignalResult = z.infer<typeof FilterResultSchema>;

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
