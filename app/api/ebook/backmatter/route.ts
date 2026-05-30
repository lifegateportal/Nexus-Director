import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekModel } from "@/lib/ai-providers";
import { EbookManifestSchema, BackMatterSchema } from "@/lib/schemas/ebook";
import type { BackMatter } from "@/lib/schemas/ebook";
import { SOURCE_LOCK_RULES } from "@/lib/editorial-style-bible";

export const runtime = "nodejs";
export const maxDuration = 180;

// ─── Request ──────────────────────────────────────────────────────────────────

const BackMatterRequestSchema = z.object({
  manifest: EbookManifestSchema,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildScriptureIndex(manifest: z.infer<typeof EbookManifestSchema>): BackMatter["scriptureIndex"] {
  // Collect all quotes from manifest.allQuotes and chapter sections
  const refMap = new Map<string, { translation: string; chapters: Set<number> }>();

  const addRef = (reference: string, translation: string, chapterNumber: number) => {
    if (!reference?.trim()) return;
    const key = `${reference.trim()} (${translation?.trim() || "translation unspecified"})`;
    if (!refMap.has(key)) refMap.set(key, { translation: translation?.trim() || "translation unspecified", chapters: new Set() });
    refMap.get(key)!.chapters.add(chapterNumber);
  };

  for (const q of manifest.allQuotes ?? []) {
    if (q.type === "scripture") {
      // Determine chapter from position — use chapter 0 as fallback
      addRef(q.reference, q.translation, 0);
    }
  }

  for (const chapter of manifest.chapters) {
    for (const section of chapter.sections) {
      // Scan section body for scripture references (basic pattern)
      const body = section.body ?? "";
      const refPattern = /\b([1-3]?\s?[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(\d+):(\d+(?:[–\-]\d+)?)/g;
      let m;
      while ((m = refPattern.exec(body)) !== null) {
        addRef(m[0].trim(), "translation unspecified", chapter.number);
      }
    }
  }

  return Array.from(refMap.entries())
    .map(([reference, { translation, chapters }]) => ({
      reference,
      translation,
      chapters: Array.from(chapters).sort((a, b) => a - b),
    }))
    .sort((a, b) => {
      // Sort by book name, then chapter, then verse (simplified)
      return a.reference.localeCompare(b.reference);
    });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = BackMatterRequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input" }, { status: 400 });
  }

  const { manifest } = input;
  const voiceDNA = manifest.voiceDNA;

  // Build scripture index from the manifest (deterministic, no LLM needed)
  const scriptureIndex = buildScriptureIndex(manifest);

  // Build chapter summaries for the LLM tasks
  const chapterSummaries = manifest.chapters.map((ch) => {
    const keyTakeaways = (ch.keyTakeaways ?? []).slice(0, 4).join("; ");
    const sectionHeadings = ch.sections.map((s) => s.heading).join(", ");
    return `Ch ${ch.number}: "${ch.title}"\n  Takeaways: ${keyTakeaways}\n  Sections: ${sectionHeadings}`;
  }).join("\n\n");

  // Terms to define: prefer Voice DNA preferred terminology, then extract unique vocabulary
  const preferredTerms = (voiceDNA?.preferredTerminology ?? []).slice(0, 15);
  const uniqueVocab = (manifest.chapters
    .flatMap((ch) => ch.sections)
    .flatMap((s) => (s.body ?? "").match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b/g) ?? [])
    .filter((t) => t.length > 5)
    .reduce((acc: Map<string, number>, t) => { acc.set(t, (acc.get(t) ?? 0) + 1); return acc; }, new Map())
  );
  const frequentTerms = Array.from(uniqueVocab.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .filter((t) => !preferredTerms.includes(t))
    .slice(0, 10);
  const termsToDefine = [...new Set([...preferredTerms, ...frequentTerms])].slice(0, 20);

  const resourcesMentioned = (manifest.frontMatter.resourcesList ?? []).slice(0, 15);

  try {
    const { object } = await generateObject({
      model: deepSeekModel,
      schema: BackMatterSchema.omit({ scriptureIndex: true }),
      mode: "json",
      temperature: 0.3,
      system: `You are creating back matter for a published teaching book. Your job is three tasks:

TASK 1 — GLOSSARY:
Define the provided key terms EXACTLY as the author uses them in the book. Rules:
- Definitions must be 2–3 sentences.
- Drawn ENTIRELY from the book content. No external theological context.
- Use the same vocabulary and register the author uses.
- firstAppearance should name the chapter and section where the term first appears.
- If a term cannot be defined from the book content, omit it.

TASK 2 — READING GROUP GUIDE:
Write 3–7 discussion questions per chapter. Rules:
- Questions must be SPECIFIC to the actual content of that chapter — not generic.
- Each question must name a concrete claim, story, scripture, or example from the chapter.
- Mix question types: some personal application ("When have you…"), some analytical ("How does the author's argument about X connect to Y?"), some action-oriented ("What would it look like to…").
- FORBIDDEN: "What did you learn from this chapter?", "How can you apply this?", "What is the main message?" — these are generic and valueless.

TASK 3 — RECOMMENDED RESOURCES:
List any resources the author specifically mentioned in the book (books, passages, teachings). Do not add resources the author didn't reference. If none were mentioned, return an empty array.

${SOURCE_LOCK_RULES}`,
      prompt: `Book: "${manifest.bookTitle}"${manifest.subtitle ? ` — ${manifest.subtitle}` : ""}
Author: ${manifest.authorName}

CHAPTER SUMMARIES:
${chapterSummaries}

TERMS TO DEFINE FOR GLOSSARY:
${termsToDefine.map((t) => `• ${t}`).join("\n")}

RESOURCES MENTIONED IN THE BOOK:
${resourcesMentioned.length > 0 ? resourcesMentioned.map((r) => `• ${r}`).join("\n") : "(none explicitly mentioned)"}

Generate the glossary, reading group guide, and recommended resources.`,
    });

    const result: BackMatter = {
      scriptureIndex,
      glossary: object.glossary ?? [],
      readingGroupGuide: object.readingGroupGuide ?? [],
      recommendedResources: object.recommendedResources ?? [],
    };

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Back matter generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
