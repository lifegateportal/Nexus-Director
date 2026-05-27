import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { deepSeekReasonerModel } from "@/lib/ai-providers";
import { z } from "zod";
import { EbookManifestSchema } from "@/lib/schemas/ebook";
import type { EbookManifest } from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 120;

// ── Stop words ────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by","from","up","as",
  "is","are","was","were","be","been","being","have","has","had","do","does","did","will","would",
  "could","should","may","might","shall","that","this","these","those","it","its","he","she","they",
  "we","you","i","me","him","her","them","us","my","our","your","his","their",
  "not","no","so","if","then","when","there","where","what","which","who","how","why",
  "all","any","both","each","few","more","most","other","some","such","than","too","very",
  "can","just","into","over","after","before","about","through","during","without","also",
  "one","two","three","four","five","even","only","still","already","now","new","well","get",
  "like","said","say","know","want","need","make","made","see","let","here","think","going",
]);

// ── Shared types ──────────────────────────────────────────────────────────────

export type SegmentMeta = {
  id: string;
  chapterNumber: number;
  sectionNumber: number | null;
  location: string;
  text: string;
};

export type ConceptDuplicate = {
  type: "example" | "argument" | "concept" | "story" | "illustration" | "passage";
  title: string;           // brief label, e.g. "Prodigal Son illustration"
  description: string;     // what specifically is duplicated
  severity: "minor" | "major";
  locations: Array<{ location: string; excerpt: string }>;
  recommendation: string;
};

export type SimilarPair = {
  locationA: string;
  locationB: string;
  similarity: number;
  excerptA: string;
  excerptB: string;
};

export type RepetitionOccurrence = {
  chapterNumber: number;
  sectionNumber: number | null;
  location: string;
  context: string;
};

export type RepetitionEntry = {
  phrase: string;
  count: number;
  occurrences: RepetitionOccurrence[];
  reason: string | null;
  alternatives: string[];
};

export type OverusedWord = {
  word: string;
  count: number;
  frequency: string;
  alternatives: string[];
};

export type AuditReport = {
  conceptDuplicates: ConceptDuplicate[];
  similarPairs: SimilarPair[];
  repetitions: RepetitionEntry[];
  overusedWords: OverusedWord[];
  totalConceptDuplicates: number;
  totalSimilarPairs: number;
  totalRepetitionPhrases: number;
  totalOverusedWords: number;
};

// ── Segment extraction ────────────────────────────────────────────────────────

function extractSegments(manifest: EbookManifest): SegmentMeta[] {
  const segs: SegmentMeta[] = [];
  let id = 0;

  const frontFields = [
    { label: "Preface", text: manifest.frontMatter.preface ?? "" },
    { label: "Introduction", text: manifest.frontMatter.introduction ?? "" },
    { label: "Conclusion", text: manifest.frontMatter.conclusion ?? "" },
  ];
  for (const f of frontFields) {
    if (f.text.trim().length > 80) {
      segs.push({ id: `fm-${id++}`, chapterNumber: 0, sectionNumber: null, location: `Front Matter – ${f.label}`, text: f.text });
    }
  }

  for (const chapter of manifest.chapters) {
    if (chapter.intro?.trim().length ?? 0 > 80) {
      segs.push({ id: `c${chapter.number}-intro`, chapterNumber: chapter.number, sectionNumber: null, location: `Ch ${chapter.number} intro`, text: chapter.intro! });
    }
    for (const section of chapter.sections) {
      if ((section.body?.trim().length ?? 0) > 80) {
        segs.push({
          id: `c${chapter.number}-s${section.sectionNumber}`,
          chapterNumber: chapter.number,
          sectionNumber: section.sectionNumber,
          location: `Ch ${chapter.number} § ${section.sectionNumber}: ${section.heading}`,
          text: section.body!,
        });
      }
    }
    if (chapter.conclusion?.trim().length ?? 0 > 80) {
      segs.push({ id: `c${chapter.number}-conc`, chapterNumber: chapter.number, sectionNumber: null, location: `Ch ${chapter.number} conclusion`, text: chapter.conclusion! });
    }
  }

  return segs;
}

// ── TF-IDF sparse vectors ─────────────────────────────────────────────────────

type SparseVec = Map<string, number>;

function tokenizeContent(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

function buildTfidfVectors(segments: SegmentMeta[]): SparseVec[] {
  const N = segments.length;
  const tokenized = segments.map((s) => tokenizeContent(s.text));

  const df = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const term of new Set(tokens)) df.set(term, (df.get(term) ?? 0) + 1);
  }

  return tokenized.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec: SparseVec = new Map();
    for (const [term, count] of tf) {
      const idf = Math.log((N + 1) / ((df.get(term) ?? 0) + 1)) + 1;
      vec.set(term, (count / Math.max(1, tokens.length)) * idf);
    }
    return vec;
  });
}

function cosineSparse(a: SparseVec, b: SparseVec): number {
  let dot = 0, normA = 0, normB = 0;
  for (const [term, val] of a) {
    dot += val * (b.get(term) ?? 0);
    normA += val * val;
  }
  for (const [, val] of b) normB += val * val;
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

// ── Pairwise similarity scan ──────────────────────────────────────────────────
// Flags cross-chapter pairs above threshold as structurally similar segments.

function findSimilarPairs(segments: SegmentMeta[], vectors: SparseVec[]): SimilarPair[] {
  const pairs: SimilarPair[] = [];

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];

      // Only flag cross-chapter pairs (intra-chapter similarity is expected)
      const isCrossChapter = a.chapterNumber !== b.chapterNumber;
      const threshold = isCrossChapter ? 0.32 : 0.55;

      const score = cosineSparse(vectors[i], vectors[j]);
      if (score < threshold) continue;

      const excerptA = a.text.trim().slice(0, 160) + (a.text.length > 160 ? "…" : "");
      const excerptB = b.text.trim().slice(0, 160) + (b.text.length > 160 ? "…" : "");
      pairs.push({ locationA: a.location, locationB: b.location, similarity: Math.round(score * 100) / 100, excerptA, excerptB });
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity).slice(0, 16);
}

// ── N-gram lexical repetition ─────────────────────────────────────────────────

function extractNgrams(text: string, n: number): string[] {
  const words = text.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter((w) => w.length > 1);
  const ngrams: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    const gram = words.slice(i, i + n);
    if (gram.filter((w) => !STOP_WORDS.has(w)).length < Math.ceil(n / 2)) continue;
    ngrams.push(gram.join(" "));
  }
  return ngrams;
}

function findLexicalRepetitions(segments: SegmentMeta[]): Omit<RepetitionEntry, "reason" | "alternatives">[] {
  const phraseMap = new Map<string, { count: number; occurrences: RepetitionOccurrence[] }>();

  for (const seg of segments) {
    const seen = new Set<string>();
    for (const phrase of [...extractNgrams(seg.text, 3), ...extractNgrams(seg.text, 4), ...extractNgrams(seg.text, 5)]) {
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      const sentences = seg.text.split(/(?<=[.!?])\s+/);
      const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const match = sentences.find((s) => re.test(s)) ?? "";
      const context = match.length > 130 ? match.slice(0, 127) + "…" : match;
      if (!phraseMap.has(phrase)) phraseMap.set(phrase, { count: 0, occurrences: [] });
      const entry = phraseMap.get(phrase)!;
      entry.count++;
      entry.occurrences.push({ chapterNumber: seg.chapterNumber, sectionNumber: seg.sectionNumber, location: seg.location, context });
    }
  }

  return Array.from(phraseMap.entries())
    .filter(([, v]) => v.count >= 2)
    .map(([phrase, v]) => ({ phrase, count: v.count, occurrences: v.occurrences }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

// ── Overused words ────────────────────────────────────────────────────────────

function findOverusedWords(manifest: EbookManifest): Omit<OverusedWord, "alternatives">[] {
  const total = manifest.totalWordCount || 1;
  const fullText = [
    manifest.frontMatter.preface ?? "",
    manifest.frontMatter.introduction ?? "",
    manifest.frontMatter.conclusion ?? "",
    ...manifest.chapters.flatMap((c) => [c.intro ?? "", ...c.sections.map((s) => s.body ?? ""), c.conclusion ?? ""]),
  ].join(" ");

  const counts = new Map<string, number>();
  for (const w of fullText.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)) {
    if (w.length > 4 && !STOP_WORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }

  const threshold = Math.max(8, Math.floor(total * 0.005));
  return Array.from(counts.entries())
    .filter(([, c]) => c >= threshold)
    .map(([word, count]) => ({ word, count, frequency: `${((count / total) * 100).toFixed(2)}%` }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
}

// ── LLM: semantic concept duplicate analysis ──────────────────────────────────
// This is the core new capability: the LLM reads ALL section summaries and
// identifies conceptually duplicated content regardless of surface wording.

async function runSemanticAudit(
  segments: SegmentMeta[],
  similarPairs: SimilarPair[],
  lexicalRepetitions: Omit<RepetitionEntry, "reason" | "alternatives">[],
  overusedWords: Omit<OverusedWord, "alternatives">[]
): Promise<{
  conceptDuplicates: ConceptDuplicate[];
  phraseAmendments: Array<{ phrase: string; reason: string; alternatives: string[] }>;
  wordAmendments: Array<{ word: string; alternatives: string[] }>;
}> {
  // Build a compact section index for the LLM — location label + first 280 chars
  const sectionIndex = segments
    .map((s, i) => `[${i + 1}] ${s.location}\n${s.text.trim().slice(0, 300)}${s.text.length > 300 ? "…" : ""}`)
    .join("\n\n");

  // Summarise algorithmically flagged pairs so the LLM knows where to look
  const flaggedPairsText = similarPairs.length > 0
    ? similarPairs
        .slice(0, 6)
        .map((p) => `• ${p.locationA} ↔ ${p.locationB} (similarity ${Math.round(p.similarity * 100)}%)`)
        .join("\n")
    : "None detected algorithmically.";

  const lexicalText = lexicalRepetitions.slice(0, 10).map((r) => `"${r.phrase}" ×${r.count}`).join(", ");
  const wordText = overusedWords.slice(0, 8).map((w) => `"${w.word}" (${w.frequency})`).join(", ");

  const prompt = `You are a senior developmental editor auditing a book manuscript.
Your job is to identify CONCEPTUAL duplication — the same idea, example, story, illustration, argument, or passage appearing more than once across different sections, even when worded differently.

═══ SECTION INDEX (location + opening text) ═══
${sectionIndex}

═══ ALGORITHMICALLY FLAGGED SIMILAR PAIRS ═══
${flaggedPairsText}

═══ REPEATED PHRASES (surface-level) ═══
${lexicalText || "None"}

═══ OVERUSED WORDS ═══
${wordText || "None"}

Your tasks:
1. CONCEPT DUPLICATES: Identify every case where the same concept, example, story, illustration, argument, or extended passage appears in multiple sections. Be specific — name the example/concept. Flag both MINOR duplicates (a point briefly touched twice) and MAJOR ones (a full example or teaching repeated).
2. PHRASE AMENDMENTS: For each repeated surface phrase above, give a short editorial reason + 2–3 rewrite alternatives.
3. WORD AMENDMENTS: For each overused word, give 2–3 precise alternatives.

Respond ONLY with valid JSON (no markdown fences, no commentary outside the JSON):
{
  "conceptDuplicates": [
    {
      "type": "example|argument|concept|story|illustration|passage",
      "title": "Brief label (e.g. 'The shepherd and lost sheep')",
      "description": "What specifically is duplicated and why it hurts the reader experience",
      "severity": "minor|major",
      "locations": [
        { "location": "Ch X § Y: Heading", "excerpt": "40-80 word excerpt showing the duplication" }
      ],
      "recommendation": "Concrete editorial action — e.g. keep in Ch 3, cut from Ch 6; or merge into one definitive treatment in Ch 4"
    }
  ],
  "phraseAmendments": [
    { "phrase": "...", "reason": "...", "alternatives": ["...", "..."] }
  ],
  "wordAmendments": [
    { "word": "...", "alternatives": ["...", "..."] }
  ]
}`;

  try {
    const { text } = await generateText({ model: deepSeekReasonerModel, prompt, maxTokens: 24000 });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { conceptDuplicates: [], phraseAmendments: [], wordAmendments: [] };
    return JSON.parse(jsonMatch[0]) as {
      conceptDuplicates: ConceptDuplicate[];
      phraseAmendments: Array<{ phrase: string; reason: string; alternatives: string[] }>;
      wordAmendments: Array<{ word: string; alternatives: string[] }>;
    };
  } catch {
    return { conceptDuplicates: [], phraseAmendments: [], wordAmendments: [] };
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

const AuditRequestSchema = z.object({ manifest: EbookManifestSchema });

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = AuditRequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input" }, { status: 400 });
  }

  try {
    const { manifest } = input;
    const segments = extractSegments(manifest);

    if (segments.length < 2) {
      return NextResponse.json({ error: "Not enough content to audit — complete the pipeline first." }, { status: 422 });
    }

    // Layer 1: algorithmic pairwise TF-IDF scan
    const vectors = buildTfidfVectors(segments);
    const similarPairs = findSimilarPairs(segments, vectors);

    // Layer 2: lexical n-gram repetitions
    const lexicalRepetitions = findLexicalRepetitions(segments);

    // Layer 3: overused words
    const overusedWordsRaw = findOverusedWords(manifest);

    // Layer 4: LLM semantic audit (concept duplicates + amendments)
    const llm = await runSemanticAudit(segments, similarPairs, lexicalRepetitions, overusedWordsRaw);

    // Merge LLM amendments into lexical repetitions
    const repetitions: RepetitionEntry[] = lexicalRepetitions.map((r) => {
      const a = llm.phraseAmendments?.find((x) => x.phrase === r.phrase);
      return { ...r, reason: a?.reason ?? null, alternatives: a?.alternatives ?? [] };
    });

    const overusedWords: OverusedWord[] = overusedWordsRaw.map((w) => {
      const a = llm.wordAmendments?.find((x) => x.word === w.word);
      return { ...w, alternatives: a?.alternatives ?? [] };
    });

    const report: AuditReport = {
      conceptDuplicates: llm.conceptDuplicates ?? [],
      similarPairs,
      repetitions,
      overusedWords,
      totalConceptDuplicates: (llm.conceptDuplicates ?? []).length,
      totalSimilarPairs: similarPairs.length,
      totalRepetitionPhrases: repetitions.length,
      totalOverusedWords: overusedWords.length,
    };

    return NextResponse.json(report, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Audit failed" },
      { status: 500 }
    );
  }
}
