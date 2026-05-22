import { z } from "zod";

// ─── Quote / Scripture Reference ────────────────────────────────────────────

export const QuoteSchema = z.object({
  id: z.string(),
  text: z.string(),
  reference: z.string(),       // "John 3:16" | "Author Name, Book Title, Year" | ""
  translation: z.string(),     // "NIV" | "KJV" | "ESV" | "" for non-scripture
  type: z.enum(["scripture", "quote", "proverb"]),
  isBlockQuote: z.boolean(),   // true when 40+ words (Chicago Manual of Style)
});

// ─── Voice DNA ───────────────────────────────────────────────────────────────

export const VoiceDNASchema = z.object({
  signaturePhrases: z.array(z.string()).default([]),        // repeated phrases, verbal stamps
  preferredTerminology: z.array(z.string()).default([]),   // domain vocabulary the author uses
  toneProfile: z.string().default(""),                      // e.g. "authoritative, pastoral, warm"
  sentencePattern: z.enum(["short-punchy", "long-explanatory", "mixed"]).default("mixed"),
  rhetoricalPatterns: z.array(z.string()).default([]),      // "uses threes", "rhetorical questions"
  teachingStyle: z.string().default(""),                    // how they open/develop/close points
  avoidWords: z.array(z.string()).default([]),             // words the author never says (for ghost-writing guard)
});

// ─── Content Segment ─────────────────────────────────────────────────────────

export const ContentSegmentSchema = z.object({
  id: z.string(),
  sourceAudio: z.enum(["audio-1", "audio-2", "audio-3", "audio-4", "audio-5", "audio-6"]),
  topic: z.string(),
  rawText: z.string(),                          // the actual transcript excerpt
  keyPoints: z.array(z.string()).default([]),               // points explicitly made in this segment
  quotes: z.array(QuoteSchema).default([]),     // any scripture/quotes in this segment
  estimatedWordCount: z.number(),
});

// ─── Content Map ─────────────────────────────────────────────────────────────

export const ContentMapSchema = z.object({
  totalEstimatedWords: z.number(),
  overarchingThemes: z.array(z.string()).default([]),
  teachingArc: z.string().default(""),            // how the full teaching flows
  coreThesis: z.string().default(""),
  targetAudience: z.string().default(""),
  uniqueVocabulary: z.array(z.string()).default([]),
  toneMap: z.string().default(""),
  segments: z.array(ContentSegmentSchema),
  allQuotes: z.array(QuoteSchema).default([]), // full quote/scripture registry
});

// ─── Section Blueprint (from architect) ──────────────────────────────────────

export const SectionBlueprintSchema = z.object({
  sectionNumber: z.number(),
  heading: z.string(),
  sourceSegmentIds: z.array(z.string()),        // which ContentSegment IDs feed this section
  keyPoints: z.array(z.string()).default([]),               // from the actual content
  quotesInSection: z.array(QuoteSchema).default([]),
  targetWordCount: z.number(),                  // determined by available content
});

// ─── Chapter Blueprint ────────────────────────────────────────────────────────

export const ChapterBlueprintSchema = z.object({
  number: z.number(),
  title: z.string(),                            // derived from the author's own words
  sourceSegmentIds: z.array(z.string()),
  sections: z.array(SectionBlueprintSchema),
  keyTheme: z.string(),
  quotesInChapter: z.array(QuoteSchema).default([]),
});

// ─── Book Architecture ────────────────────────────────────────────────────────

export const BookArchitectureSchema = z.object({
  bookTitle: z.string(),
  subtitle: z.string(),
  authorName: z.string(),                       // if mentioned in audio; else "the author"
  estimatedTotalWords: z.number(),
  chapters: z.array(ChapterBlueprintSchema),
  frontMatterNotes: z.string(),                 // what the author said in opening
  backMatterNotes: z.string(),                  // what the author said in closing
});

// ─── Section Assignment (input to write-section) ─────────────────────────────

export const SectionAssignmentSchema = z.object({
  chapterNumber: z.number(),
  chapterTitle: z.string(),
  sectionNumber: z.number(),
  heading: z.string(),
  transcriptExcerpts: z.array(z.string()).default([]),      // raw transcript text to write from
  quotes: z.array(QuoteSchema).default([]),
  keyPoints: z.array(z.string()).default([]),
  voiceDNA: VoiceDNASchema,
  previousSectionEnding: z.string(),           // last 2 paragraphs of previous section
  targetWordCount: z.number(),
});

// ─── Section Draft (output of write-section) ─────────────────────────────────

export const SectionDraftSchema = z.object({
  chapterNumber: z.number(),
  sectionNumber: z.number(),
  heading: z.string().default(""),
  body: z.string().default(""),
  wordCount: z.number().default(0),
  status: z.enum(["pending", "writing", "complete", "failed"]).default("pending"),
});

// ─── Chapter Polish Input ─────────────────────────────────────────────────────

export const ChapterPolishInputSchema = z.object({
  number: z.number(),
  title: z.string(),
  sections: z.array(SectionDraftSchema),
  chapterSegmentTexts: z.array(z.string()),     // raw transcript for this chapter
  voiceDNA: VoiceDNASchema,
  quotesInChapter: z.array(QuoteSchema).default([]),
});

// ─── Chapter Draft (output of polish) ────────────────────────────────────────

export const ChapterDraftSchema = z.object({
  number: z.number(),
  title: z.string().default(""),
  intro: z.string().default(""),
  sections: z.array(SectionDraftSchema),
  conclusion: z.string().default(""),
  keyTakeaways: z.array(z.string()).default([]),
  reflectionQuestions: z.array(z.string()).default([]),
  totalWordCount: z.number().default(0),
  status: z.enum(["pending", "polishing", "complete", "failed"]).default("pending"),
});

// ─── Front / Back Matter ──────────────────────────────────────────────────────

export const FrontBackMatterSchema = z.object({
  preface: z.string(),
  introduction: z.string(),
  conclusion: z.string(),
  aboutAuthor: z.string().nullable(),           // null if not mentioned in audio
  resourcesList: z.array(z.string()).default([]), // resources mentioned in the audio
});

// ─── Full Ebook Manifest ──────────────────────────────────────────────────────

export const EbookManifestSchema = z.object({
  jobId: z.string(),
  bookTitle: z.string(),
  subtitle: z.string(),
  authorName: z.string(),
  frontMatter: FrontBackMatterSchema,
  chapters: z.array(ChapterDraftSchema),
  totalWordCount: z.number(),
  allQuotes: z.array(QuoteSchema).default([]),
  generatedAt: z.string().datetime(),
});

// ─── Job State (IndexedDB persistence) ───────────────────────────────────────

export const EbookJobStateSchema = z.object({
  jobId: z.string(),
  status: z.enum([
    "idle", "transcribing", "filtering", "analyzing", "mapping",
    "architecting", "assigning", "writing", "polishing",
    "frontmatter", "exporting", "complete", "failed",
  ]).default("idle"),
  audioFileNames: z.array(z.string()).default([]),
  transcripts: z.array(
    z.object({ label: z.string(), text: z.string() })
  ).default([]),
  masterTranscript: z.string().default(""),
  filteredTranscript: z.string().default(""), // teaching-only content after signal filter
  filterRemovedCount: z.number().default(0),  // number of non-teaching blocks removed
  voiceDNA: VoiceDNASchema.nullable().default(null),
  contentMap: ContentMapSchema.nullable().default(null),
  architecture: BookArchitectureSchema.nullable().default(null),
  sectionAssignments: z.array(SectionAssignmentSchema).default([]),
  sections: z.array(SectionDraftSchema).default([]),
  chapters: z.array(ChapterDraftSchema).default([]),
  frontMatter: FrontBackMatterSchema.nullable().default(null),
  exportUrls: z.object({ pdfUrl: z.string(), epubUrl: z.string() }).nullable().default(null),
  currentStage: z.string().default(""),
  progress: z.object({ total: z.number(), completed: z.number() }).default({ total: 0, completed: 0 }),
  errorLog: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ─── API request / response types ────────────────────────────────────────────

export const VoiceDNARequestSchema = z.object({
  masterTranscript: z.string().min(100),
});

export const ContentMapRequestSchema = z.object({
  masterTranscript: z.string().min(100),
  voiceDNA: VoiceDNASchema,
});

export const ArchitectRequestSchema = z.object({
  contentMap: ContentMapSchema,
  voiceDNA: VoiceDNASchema,
});

export const AssignSegmentsRequestSchema = z.object({
  architecture: BookArchitectureSchema,
  contentMap: ContentMapSchema,
  voiceDNA: VoiceDNASchema,
});

export const WriteSectionRequestSchema = z.object({
  assignment: SectionAssignmentSchema,
});

export const PolishChapterRequestSchema = z.object({
  input: ChapterPolishInputSchema,
});

export const FrontMatterRequestSchema = z.object({
  masterTranscript: z.string().min(100),
  architecture: BookArchitectureSchema,
  voiceDNA: VoiceDNASchema,
});

export const ExportRequestSchema = z.object({
  manifest: EbookManifestSchema,
  formats: z.object({ pdf: z.boolean(), epub: z.boolean() }).default({ pdf: true, epub: true }),
});

// ─── TypeScript exports ────────────────────────────────────────────────────────

export type Quote = z.infer<typeof QuoteSchema>;
export type VoiceDNA = z.infer<typeof VoiceDNASchema>;
export type ContentSegment = z.infer<typeof ContentSegmentSchema>;
export type ContentMap = z.infer<typeof ContentMapSchema>;
export type SectionBlueprint = z.infer<typeof SectionBlueprintSchema>;
export type ChapterBlueprint = z.infer<typeof ChapterBlueprintSchema>;
export type BookArchitecture = z.infer<typeof BookArchitectureSchema>;
export type SectionAssignment = z.infer<typeof SectionAssignmentSchema>;
export type SectionDraft = z.infer<typeof SectionDraftSchema>;
export type ChapterPolishInput = z.infer<typeof ChapterPolishInputSchema>;
export type ChapterDraft = z.infer<typeof ChapterDraftSchema>;
export type FrontBackMatter = z.infer<typeof FrontBackMatterSchema>;
export type EbookManifest = z.infer<typeof EbookManifestSchema>;
export type EbookJobState = z.infer<typeof EbookJobStateSchema>;
