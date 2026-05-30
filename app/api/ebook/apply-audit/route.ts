import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { z } from "zod";
import { VoiceDNASchema } from "@/lib/schemas/ebook";

type VoiceDNAType = z.infer<typeof VoiceDNASchema>;

export const runtime = "nodejs";
export const maxDuration = 120;

// --- Strategy -----------------------------------------------------------------
// Tier 1 (no LLM) — pure string manipulation, zero risk of unintended rewrites:
//   r-N  repeated phrases  → replace 2nd+ occurrences with alternatives
//   w-N  overused words    → replace every other occurrence with alternatives
//
// Tier 2 (targeted LLM) — only the ONE affected section body is sent:
//   c-N  concept duplicate → revise just that section per the recommendation
//   p-N  similar pair      → rewrite just the section in this chapter to
//                            differentiate from its pair
//
// Sections that have NO applied findings are NEVER touched.

// --- Input Schemas ------------------------------------------------------------

const SectionSchema = z.object({
  sectionNumber: z.number(),
  heading: z.string(),
  body: z.string().default(""),
  wordCount: z.number().default(0),
  status: z.string().default("complete"),
});

const ChapterSchema = z.object({
  number: z.number(),
  title: z.string().default(""),
  intro: z.string().default(""),
  sections: z.array(SectionSchema),
  conclusion: z.string().default(""),
  keyTakeaways: z.array(z.string()).default([]),
  reflectionQuestions: z.array(z.string()).default([]),
  totalWordCount: z.number().default(0),
  status: z.string().default("complete"),
});

const RequestSchema = z.object({
  manifest: z.object({ chapters: z.array(ChapterSchema) }),
  report: z.object({
    conceptDuplicates: z.array(z.object({
      type: z.string(),
      title: z.string(),
      description: z.string(),
      severity: z.string(),
      locations: z.array(z.object({ location: z.string(), excerpt: z.string().optional().nullable() })),
      recommendation: z.string(),
    })).default([]),
    similarPairs: z.array(z.object({
      locationA: z.string(),
      locationB: z.string(),
      similarity: z.number(),
      excerptA: z.string().default(""),
      excerptB: z.string().default(""),
    })).default([]),
    repetitions: z.array(z.object({
      phrase: z.string(),
      count: z.number(),
      occurrences: z.array(z.object({
        chapterNumber: z.number(),
        sectionNumber: z.number().optional().nullable(),
      })),
      alternatives: z.array(z.string()).default([]),
    })).default([]),
    overusedWords: z.array(z.object({
      word: z.string(),
      count: z.number(),
      frequency: z.string().default(""),
      alternatives: z.array(z.string()).default([]),
    })).default([]),
  }),
  appliedKeys: z.array(z.string()),
  voiceDNA: VoiceDNASchema.optional().nullable(),
});

type ChapterInput = z.infer<typeof ChapterSchema>;
type ReportInput = z.infer<typeof RequestSchema>["report"];
type SectionFieldRef = "intro" | "conclusion" | { sectionNumber: number };

type LLMTask = {
  chapterIndex: number;
  field: SectionFieldRef;
  task: string;
  heading: string;
  body: string;
  voiceDNA?: VoiceDNAType | null;
};

type RewrittenLocation = {
  chapterIndex: number;
  field: SectionFieldRef;
};

type TransitionTask = {
  chapterIndex: number;
  field: SectionFieldRef;
  role: "preceding" | "following";
  headingContext: string;
  bodyToFix: string;
  adjacentEdge: string;
};

// --- Location parser ----------------------------------------------------------

function parseLocation(loc: string): { chapterNum: number | null; sectionNum: number | null } {
  // Matches: "Chapter N", "Ch N", "Ch. N" (audit emits "Ch N § M: Heading")
  const ch = /\bch(?:apter)?\.?\s+(\d+)/i.exec(loc);
  // Matches: "Section N", "§ N", "§N"
  const sc = /(?:\bsection\s+|§\s*)(\d+)/i.exec(loc);
  return {
    chapterNum: ch ? parseInt(ch[1]) : null,
    sectionNum: sc ? parseInt(sc[1]) : null,
  };
}

// --- Tier 1 helpers — deterministic string fixes ------------------------------

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace 2nd+ occurrences of `phrase` across a block of text with alternatives (cycling). */
function applyPhraseVariation(text: string, phrase: string, alternatives: string[]): string {
  if (!alternatives.length || !text) return text;
  const regex = new RegExp(escapeRegex(phrase), "gi");
  let hit = 0;
  return text.replace(regex, (match) => {
    hit++;
    if (hit === 1) return match; // first occurrence stays
    const alt = alternatives[(hit - 2) % alternatives.length];
    // mirror capitalisation of the original match
    return match[0] === match[0].toUpperCase()
      ? alt.charAt(0).toUpperCase() + alt.slice(1)
      : alt;
  });
}

/** Replace every other occurrence (2nd, 4th, …) of `word` across a text block with alternatives. */
function applyWordVariation(text: string, word: string, alternatives: string[]): string {
  if (!alternatives.length || !text) return text;
  const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
  let hit = 0;
  return text.replace(regex, (match) => {
    hit++;
    if (hit % 2 === 1) return match; // odd occurrences stay
    const alt = alternatives[Math.floor((hit - 2) / 2) % alternatives.length];
    return match[0] === match[0].toUpperCase()
      ? alt.charAt(0).toUpperCase() + alt.slice(1)
      : alt;
  });
}

/** Apply a text transformation to every prose field in a chapter's sections, intro, conclusion. */
function mapChapterText(
  chapter: ChapterInput,
  transform: (text: string) => string,
): ChapterInput {
  return {
    ...chapter,
    intro: transform(chapter.intro),
    conclusion: transform(chapter.conclusion),
    sections: chapter.sections.map((s) => {
      const body = transform(s.body);
      return { ...s, body, wordCount: body.split(/\s+/).filter(Boolean).length };
    }),
  };
}

// --- Tier 2 helper — targeted single-section LLM rewrite ---------------------

async function reviseSectionBody(
  heading: string,
  body: string,
  task: string,
  voiceDNA?: VoiceDNAType | null,
): Promise<string> {
  // Compact, human-readable voice block to keep surgical edits in the author's voice
  let voiceDnaBlock = "";
  if (voiceDNA) {
    const lines: string[] = ["\nAUTHOR VOICE DNA — maintain throughout:"];
    if (voiceDNA.toneProfile) lines.push(`- Tone: ${voiceDNA.toneProfile}`);
    if (voiceDNA.vocabularyLevel) lines.push(`- Register: ${voiceDNA.vocabularyLevel}`);
    if (voiceDNA.sentencePattern) lines.push(`- Sentence rhythm: ${voiceDNA.sentencePattern}`);
    if (voiceDNA.pacingFingerprint) lines.push(`- Pacing: ${voiceDNA.pacingFingerprint}`);
    if ((voiceDNA.avoidWords ?? []).length > 0)
      lines.push(`- Forbidden words (zero tolerance): ${voiceDNA.avoidWords.slice(0, 15).join(", ")}`);
    if ((voiceDNA.avoidStructures ?? []).length > 0)
      lines.push(`- Forbidden structures: ${(voiceDNA.avoidStructures ?? []).join("; ")}`);
    if ((voiceDNA.signaturePhrases ?? []).length > 0)
      lines.push(`- Signature phrases (use naturally): ${voiceDNA.signaturePhrases.join(", ")}`);
    voiceDnaBlock = lines.join("\n");
  }

  let text = "";
  try {
    const result = await generateText({
      model: deepSeekModel,
      temperature: 0.3,
      system:
        "You are a surgical book editor. Make only the minimum changes required by the task. Return ONLY the revised section body as plain prose — no JSON, no markdown, no commentary.",
      prompt: `SECTION HEADING: ${heading}${voiceDnaBlock}

SECTION BODY:
${body}

EDITORIAL TASK:
${task}

RULES:
- Change ONLY what is necessary to address the task above
- Preserve every scripture reference, quote, and theological teaching point exactly
- Do not add new content, illustrations, or arguments not already present
- Keep the same approximate length and sentence rhythm
- Never use an em dash (— or --)
- Return the revised body as plain prose text only`,
    });
    text = result.text.trim();
  } catch (err) {
    console.error("[apply-audit] LLM section rewrite failed:", err);
    return body; // fall back to original
  }
  return text || body;
}

// Concurrency-limited parallel runner
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const runWorker = async (): Promise<void> => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  };
  const slots = Math.min(limit, items.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < slots; i++) workers.push(runWorker());
  await Promise.all(workers);
  return results;
}

// \u2500\u2500\u2500 Upgrade 7: Post-rewrite transition repair \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// After concept-duplicate removal, auto-patches the opening paragraph of the
// immediately following section and closing paragraph of the preceding one so
// the seam reads naturally without manual intervention.

async function repairTransitions(
  chapters: ChapterInput[],
  rewritten: RewrittenLocation[],
  voiceDNA?: VoiceDNAType | null,
): Promise<ChapterInput[]> {

  const tasks: TransitionTask[] = [];

  for (const { chapterIndex, field } of rewritten) {
    const ch = chapters[chapterIndex];

    // Resolve rewritten body for edge extraction
    let rewrittenBody = "";
    if (field === "intro") {
      rewrittenBody = ch.intro;
    } else if (field === "conclusion") {
      rewrittenBody = ch.conclusion;
    } else {
      const secNum = (field as { sectionNumber: number }).sectionNumber;
      rewrittenBody = ch.sections.find((s) => s.sectionNumber === secNum)?.body ?? "";
    }

    const paras = rewrittenBody.split(/\n\n+/);
    const rewrittenOpen = (paras[0] ?? "").trim().slice(0, 220);
    const rewrittenClose = (paras.at(-1) ?? "").trim().slice(-220);

    if (field === "intro") {
      // Nothing precedes a chapter intro in the same chapter
    } else if (field === "conclusion") {
      // Preceding = last section
      const lastSec = [...ch.sections].reverse()[0];
      if (lastSec?.body) {
        tasks.push({
          chapterIndex,
          field: { sectionNumber: lastSec.sectionNumber },
          role: "preceding",
          headingContext: lastSec.heading,
          bodyToFix: lastSec.body,
          adjacentEdge: rewrittenOpen,
        });
      }
    } else {
      const secNum = (field as { sectionNumber: number }).sectionNumber;
      const secIdx = ch.sections.findIndex((s) => s.sectionNumber === secNum);

      // Preceding neighbor
      if (secIdx > 0) {
        const prev = ch.sections[secIdx - 1];
        tasks.push({
          chapterIndex,
          field: { sectionNumber: prev.sectionNumber },
          role: "preceding",
          headingContext: prev.heading,
          bodyToFix: prev.body,
          adjacentEdge: rewrittenOpen,
        });
      } else if (ch.intro) {
        tasks.push({
          chapterIndex,
          field: "intro",
          role: "preceding",
          headingContext: `Chapter ${ch.number} Introduction`,
          bodyToFix: ch.intro,
          adjacentEdge: rewrittenOpen,
        });
      }

      // Following neighbor
      if (secIdx >= 0 && secIdx < ch.sections.length - 1) {
        const next = ch.sections[secIdx + 1];
        tasks.push({
          chapterIndex,
          field: { sectionNumber: next.sectionNumber },
          role: "following",
          headingContext: next.heading,
          bodyToFix: next.body,
          adjacentEdge: rewrittenClose,
        });
      } else if (ch.conclusion) {
        tasks.push({
          chapterIndex,
          field: "conclusion",
          role: "following",
          headingContext: `Chapter ${ch.number} Conclusion`,
          bodyToFix: ch.conclusion,
          adjacentEdge: rewrittenClose,
        });
      }
    }
  }

  // Deduplicate by chapterIndex + field + role (same neighbor can appear multiple times)
  const seen = new Set<string>();
  const unique = tasks.filter((t) => {
    const key = `${t.chapterIndex}|${JSON.stringify(t.field)}|${t.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) return chapters;

  const results = await mapWithConcurrency(unique, 2, async (task) => {
    const taskPrompt =
      task.role === "preceding"
        ? `The section immediately after this one has been revised. It now opens with:\n"${task.adjacentEdge}"\n\nRewrite ONLY the final paragraph of this section so it transitions naturally into that opening. Change nothing else.`
        : `The section immediately before this one has been revised. It now ends with:\n"${task.adjacentEdge}"\n\nRewrite ONLY the opening paragraph of this section so it follows naturally from that closing. Change nothing else.`;
    return {
      task,
      revisedBody: await reviseSectionBody(task.headingContext, task.bodyToFix, taskPrompt, voiceDNA),
    };
  });

  let updated = [...chapters];
  for (const { task, revisedBody } of results) {
    const ch = updated[task.chapterIndex];
    if (task.field === "intro") {
      updated[task.chapterIndex] = { ...ch, intro: revisedBody };
    } else if (task.field === "conclusion") {
      updated[task.chapterIndex] = { ...ch, conclusion: revisedBody };
    } else {
      const secNum = (task.field as { sectionNumber: number }).sectionNumber;
      updated[task.chapterIndex] = {
        ...ch,
        sections: ch.sections.map((s) =>
          s.sectionNumber === secNum
            ? { ...s, body: revisedBody, wordCount: revisedBody.split(/\s+/).filter(Boolean).length }
            : s,
        ),
      };
    }
  }

  return updated;
}

// \u2500\u2500\u2500 Route Handler \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\nexport const POST = async (req: NextRequest): Promise<Response> => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { manifest, report, appliedKeys, voiceDNA } = parsed.data;

  if (appliedKeys.length === 0) {
    return NextResponse.json({ chapters: manifest.chapters }, { status: 200 });
  }

  // Deep clone chapters so we can mutate them safely
  let chapters: ChapterInput[] = manifest.chapters.map((c) => ({
    ...c,
    sections: c.sections.map((s) => ({ ...s })),
  }));

  // -- Tier 1: Algorithmic fixes (no LLM, no risk of extra rewrites) -----------

  for (const key of appliedKeys) {
    if (key.startsWith("r-")) {
      const idx = parseInt(key.slice(2));
      const rep = report.repetitions[idx];
      if (!rep || !rep.alternatives.length) continue;
      // Apply globally across ALL chapters (repetition is a manuscript-wide stat)
      chapters = chapters.map((ch) =>
        mapChapterText(ch, (text) => applyPhraseVariation(text, rep.phrase, rep.alternatives)),
      );
    }

    if (key.startsWith("w-")) {
      const idx = parseInt(key.slice(2));
      const ow = report.overusedWords[idx];
      if (!ow || !ow.alternatives.length) continue;
      chapters = chapters.map((ch) =>
        mapChapterText(ch, (text) => applyWordVariation(text, ow.word, ow.alternatives)),
      );
    }
  }

  // -- Tier 2: Targeted LLM fixes — only the affected section is sent -----------

  // Collect all LLM work items before running them
  const llmTasks: LLMTask[] = [];

  for (const key of appliedKeys) {
    // -- Concept duplicates ---------------------------------------------------
    if (key.startsWith("c-")) {
      const idx = parseInt(key.slice(2));
      const dup = report.conceptDuplicates[idx];
      if (!dup) continue;

      for (const loc of dup.locations) {
        const { chapterNum, sectionNum } = parseLocation(loc.location);
        if (chapterNum === null) continue;

        const chIdx = chapters.findIndex((c) => c.number === chapterNum);
        if (chIdx === -1) continue;
        const ch = chapters[chIdx];

        if (sectionNum !== null) {
          const sec = ch.sections.find((s) => s.sectionNumber === sectionNum);
          if (!sec) continue;
          llmTasks.push({
            chapterIndex: chIdx,
            field: { sectionNumber: sectionNum },
            task: `This section contains a concept duplicate: "${dup.title}". ${dup.recommendation}`,
            heading: sec.heading,
            body: sec.body,
            voiceDNA: voiceDNA ?? null,
          });
        } else if (loc.location.toLowerCase().includes("intro")) {
          llmTasks.push({
            chapterIndex: chIdx,
            field: "intro",
            task: `This intro contains a concept duplicate: "${dup.title}". ${dup.recommendation}`,
            heading: `Chapter ${ch.number} Introduction`,
            body: ch.intro,
            voiceDNA: voiceDNA ?? null,
          });
        } else if (loc.location.toLowerCase().includes("conclusion")) {
          llmTasks.push({
            chapterIndex: chIdx,
            field: "conclusion",
            task: `This conclusion contains a concept duplicate: "${dup.title}". ${dup.recommendation}`,
            heading: `Chapter ${ch.number} Conclusion`,
            body: ch.conclusion,
            voiceDNA: voiceDNA ?? null,
          });
        }
      }
    }

    // -- Similar pairs --------------------------------------------------------
    if (key.startsWith("p-")) {
      const idx = parseInt(key.slice(2));
      const pair = report.similarPairs[idx];
      if (!pair) continue;

      // Rewrite the LATER location (B) to differentiate it from A
      // If we can't parse B, fall back to A
      const locB = parseLocation(pair.locationB);
      const locA = parseLocation(pair.locationA);

      const targetLoc = locB.chapterNum !== null ? locB : locA;
      const otherLoc = targetLoc === locB ? pair.locationA : pair.locationB;

      if (targetLoc.chapterNum === null) continue;
      const chIdx = chapters.findIndex((c) => c.number === targetLoc.chapterNum);
      if (chIdx === -1) continue;
      const ch = chapters[chIdx];

      if (targetLoc.sectionNum !== null) {
        const sec = ch.sections.find((s) => s.sectionNumber === targetLoc.sectionNum);
        if (!sec) continue;
        llmTasks.push({
          chapterIndex: chIdx,
          field: { sectionNumber: targetLoc.sectionNum },
          task: `This section has ${Math.round(pair.similarity * 100)}% content overlap with ${otherLoc}. Rewrite it to present a more distinct angle while preserving its core teaching point.`,
          heading: sec.heading,
          body: sec.body,
          voiceDNA: voiceDNA ?? null,
        });
      }
    }
  }

  // Run LLM tasks with concurrency limit (max 4 at a time)
  if (llmTasks.length > 0) {
    const results = await mapWithConcurrency(llmTasks, 4, async (task) => ({
      task,
      revisedBody: await reviseSectionBody(task.heading, task.body, task.task, task.voiceDNA),
    }));

    // Apply results back into the chapters array
    for (const { task, revisedBody } of results) {
      const ch = chapters[task.chapterIndex];
      if (task.field === "intro") {
        chapters[task.chapterIndex] = { ...ch, intro: revisedBody };
      } else if (task.field === "conclusion") {
        chapters[task.chapterIndex] = { ...ch, conclusion: revisedBody };
      } else {
        const secNum = (task.field as { sectionNumber: number }).sectionNumber;
        chapters[task.chapterIndex] = {
          ...ch,
          sections: ch.sections.map((s) =>
            s.sectionNumber === secNum
              ? { ...s, body: revisedBody, wordCount: revisedBody.split(/\s+/).filter(Boolean).length }
              : s,
          ),
        };
      }
    }

    // Upgrade 7: patch transition seams in sections adjacent to any rewritten section
    const rewrittenLocations: RewrittenLocation[] = results.map(({ task }) => ({
      chapterIndex: task.chapterIndex,
      field: task.field,
    }));
    chapters = await repairTransitions(chapters, rewrittenLocations, voiceDNA);
  }

  return NextResponse.json({ chapters }, { status: 200 });
};
