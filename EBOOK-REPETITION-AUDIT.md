# Ebook LLM Repetition & Boundary Audit Report
**Date**: 2026-06-04  
**Status**: Critical Issues Identified — Awaiting Approval for Fixes

---

## Executive Summary

Your ebook generation system has **THREE CRITICAL ARCHITECTURAL FLAWS** causing repetitions and boundary violations:

1. **Deduplication uses metadata instead of actual written prose**
2. **Two competing planners create conflicting content assignments**
3. **Transcript boundaries override structural boundaries**

---

## Issue 1: Ghost Deduplication System (Metadata vs. Reality)

### The Problem
`alreadyCoveredPoints` contains **abstract key points** from the architecture phase, NOT the actual written prose.

### Evidence
**File**: [`assign-segments/route.ts:88-96`](assign-segments/route.ts#L88-L96)
```typescript
// Creates assignments with abstract key points from architecture
keyPoints: Array.isArray(section.keyPoints) ? section.keyPoints : []
```

**File**: [`write-section/route.ts:628-630`](write-section/route.ts#L628-L630)
```typescript
const dedupCorpus = (assignment.priorSectionsSample ?? []).length > 0
  ? assignment.priorSectionsSample ?? []  // ✅ Uses actual prose (when available)
  : assignment.alreadyCoveredPoints ?? []; // ❌ Falls back to abstract metadata
```

### Why This Causes Repetition
1. **Architecture phase** generates: `"keyPoints": ["Prayer transforms your heart"]`
2. **Section 1 writes**: 800 words about prayer's transformative power, with 3 stories and 5 scripture quotes
3. **Section 3 dedup filter receives**: `["Prayer transforms your heart"]` ← **only this**
4. **N-gram overlap check**: Abstract 4-word phrase vs. 800-word section = **near-zero overlap**
5. **Filter passes everything through** → Section 3 rewrites the same stories and quotes

### The Root Cause
**File**: [`write-section/route.ts:253-266`](write-section/route.ts#L253-L266)
```typescript
function excerptOverlapWithCoveredContent(excerpt: string, coveredText: string): number {
  const excerptGrams = extractNgrams(excerpt, 4);
  const coveredGrams = extractNgrams(coveredText, 4); // ← coveredText is metadata, not prose
  if (excerptGrams.size === 0) return 0;
  let shared = 0;
  for (const g of excerptGrams) { if (coveredGrams.has(g)) shared++; }
  return shared / excerptGrams.size;
}
```

When `coveredText = "Prayer transforms your heart"` (17 words) and `excerpt = [500-word transcript block]`:
- `coveredGrams` = ~3 n-grams
- `excerptGrams` = ~120 n-grams
- **Overlap = 0.02** (2%) → threshold is 40% → **everything passes through**

---

## Issue 2: Two Competing Planners Create Content Conflicts

### The Dual Planning Architecture

Your system has **TWO separate planning calls** that can assign the same content to different sections:

#### Planner 1: Book Architect (`/api/ebook/architect`)
**File**: [`architect/route.ts:218-280`](architect/route.ts#L218-L280)
- **Input**: All segments from content-map
- **Output**: Assigns `sourceSegmentIds` to each section
- **Assignment method**: LLM call using transcript similarity

#### Planner 2: Chapter Paragraph Planner (`/api/ebook/chapter-plan`)
**File**: [`chapter-plan/route.ts:70-230`](chapter-plan/route.ts#L70-L230)
- **Input**: Transcript excerpts (filtered by sourceSegmentIds from Planner 1)
- **Output**: Per-section paragraph plans with `supportedExcerptNumbers`
- **Assignment method**: LLM call with "concept ownership" rules

#### Planner 3 (Fallback): Per-Section Planner (in `write-section`)
**File**: [`write-section/route.ts:824-890`](write-section/route.ts#L824-L890)
- **Input**: Same transcript excerpts
- **Output**: Creates its OWN paragraph plan when chapter-plan fails
- **Assignment method**: LLM call (no visibility to other sections)

### The Conflict Zone

**Scenario**: Audio file contains teaching about "Faith and Works" that logically spans 2 chapters:

1. **Architect assigns**:
   - Chapter 1, Section 3: segments `seg-5`, `seg-6`, `seg-7` (Faith definition)
   - Chapter 2, Section 1: segments `seg-8`, `seg-9` (Works application)

2. **Chapter-plan assigns** (for Chapter 1):
   ```
   Section 3: Plan uses excerpts 1-5 ← covers seg-5, seg-6, seg-7 ✅
   ```

3. **Chapter-plan assigns** (for Chapter 2):
   ```
   Section 1: Plan uses excerpts 1-4 ← but seg-8 ALSO references faith definition
   ```

4. **LLM cannot see the boundary**:
   - Transcript excerpt for `seg-8` starts mid-argument: *"...so when James says faith without works is dead..."*
   - Chapter-plan sees this as **continuation** of faith teaching
   - Assigns the "faith definition" concept to **BOTH** Chapter 1 Section 3 AND Chapter 2 Section 1

### Evidence of Conflicts

**File**: [`chapter-plan/route.ts:98-107`](chapter-plan/route.ts#L98-L107)
```typescript
// Chapter-plan's "Concept Ownership Rule"
const system = `Before planning paragraphs, mentally assign each concept in the transcript
to the section whose heading best owns it. Then plan each section using ONLY the concepts 
you assigned to it.

This is the anti-duplication contract: the writer for Section 3 will receive only Section 3's 
plan and will not see what Sections 1 and 2 planned.`
```

**The problem**: This "anti-duplication contract" **only works within a single chapter**. When a transcript argument spans two chapters, there is **no mechanism** to prevent both chapter-plan calls from claiming the same transitional content.

---

## Issue 3: Transcript Boundaries Override Structural Boundaries

### The Hard-Coded Boundary Rules Are Ineffective

**File**: [`write-section/route.ts:734-746`](write-section/route.ts#L734-L746)
```typescript
const chapterClosingBlock = assignment.isLastSectionInChapter && assignment.nextChapterTitle
  ? `
This is the FINAL section of Chapter ${assignment.chapterNumber}. 
The next chapter is titled "${assignment.nextChapterTitle}".

HARD RULES for this section's close:
• DO NOT introduce the opening argument, definition, or thesis of "${assignment.nextChapterTitle}".
• DO NOT quote or paraphrase any scripture or story that will be used to open "${assignment.nextChapterTitle}".
...
• If the transcript excerpt begins introducing the theme of "${assignment.nextChapterTitle}", 
  stop before that line. Shorter is correct.`
  : "";
```

### Why This Fails

1. **LLM Instruction Conflict**:
   - Primary directive: *"Transform the transcript excerpts into polished written prose"* + *"Exhaust every distinct key point"*
   - Boundary directive: *"Stop before the next chapter's theme"*
   - **LLMs prioritize completeness over boundaries** — the instruction to "exhaust every key point" overrides the "stop early" instruction

2. **No Programmatic Enforcement**:
   - The boundary block is **only a prompt instruction**
   - There's no code-level validation that rejects output violating the boundary
   - Quality checks look for audience language and n-gram overlap, but **not boundary violations**

3. **Excerpt Labels Are Misleading**:
   **File**: [`write-section/route.ts:665-666`](write-section/route.ts#L665-L666)
   ```typescript
   const excerptBlock = effectiveExcerptEntries
     .map((e) => `[EXCERPT ${e.sourceNumber} of ${totalExcerpts}]\n${e.text}`)
   ```
   
   - Excerpts are numbered `[EXCERPT 1 of 5]`, `[EXCERPT 2 of 5]`, etc.
   - This creates the **illusion** that all 5 excerpts belong to the current section
   - When excerpt 5 actually starts Chapter 2's content, the LLM sees "5 of 5" and writes it anyway

### Evidence: The Consumption Filter Doesn't Work

**File**: [`write-section/route.ts:643-653`](write-section/route.ts#L643-L653)
```typescript
// When chapter-plan is available, enforce its excerpt anchors surgically.
if ((assignment.assignedPlan ?? []).length > 0) {
  const anchored = new Set<number>();
  for (const step of assignment.assignedPlan ?? []) {
    for (const n of step.supportedExcerptNumbers ?? []) {
      if (Number.isInteger(n) && n > 0) anchored.add(n);
    }
  }
  if (anchored.size > 0) {
    const anchoredEntries = effectiveExcerptEntries.filter((e) => anchored.has(e.sourceNumber));
    ...
  }
}
```

**This surgical filter only works when**:
- `assignedPlan` exists (chapter-plan succeeded)
- `supportedExcerptNumbers` are correctly bounded to the section's scope

**It fails when**:
- Chapter-plan assigns overlapping `supportedExcerptNumbers` across chapter boundaries (see Issue 2)
- The per-section planner fallback runs (no anchors, sends ALL excerpts)

---

## Issue 4: Section Boundary Spillage (Same Root Cause)

### The Problem
Content assigned to **Section 2** frequently appears in **Section 3** because:

1. **Architect assigns transcript ranges** to sections, but those ranges contain **overlapping arguments**
2. **Chapter-plan attempts non-overlapping assignment**, but sees the transcript as a **linear sequence** and cannot detect when a speaker circles back to an earlier point
3. **Write-section receives "Section 3's excerpts"** but those excerpts contain setup context that was supposed to be covered in Section 2

### Evidence: Monotonic Excerpt Rule

**File**: [`chapter-plan/route.ts:127-128`](chapter-plan/route.ts#L127-L128)
```typescript
SEQUENCE RULE:
Plans must be monotonically non-decreasing by excerpt number — paragraph N cannot draw from 
a lower excerpt than paragraph N-1.
```

**The flaw**: This assumes the speaker's teaching is **strictly linear**. Real sermons:
- Circle back to reinforce points
- Use **parallel structure** (introduce 3 principles, then explain each in turn)
- Layer concepts (introduce A, introduce B, then explain how A+B interact)

When the speaker structure is **non-linear**, the monotonic rule **forces sections to duplicate context**.

---

## Root Cause Summary

| Issue | Current Behavior | Root Cause |
|-------|------------------|------------|
| **Repetitions within chapters** | Sections rewrite the same stories/scriptures | Dedup corpus is metadata, not prose → n-gram filter passes everything |
| **Repetitions across chapters** | Chapter 2 restates Chapter 1 concepts | `alreadyCoveredPoints` sent to chapter-plan is compressed to 1 line per chapter → LLM can't detect specific overlaps |
| **Chapter boundary spillage** | Last section of Ch1 introduces Ch2's thesis | Prompt instruction only, no programmatic enforcement, LLM prioritizes completeness |
| **Section boundary spillage** | Section 3 re-explains Section 2's setup | Monotonic excerpt rule forces linear reading of non-linear teaching; chapter-plan can assign overlapping excerpts |

---

## Proposed Solutions (Requires Your Approval)

### Fix 1: Use Actual Prose for Deduplication ✅ READY TO IMPLEMENT

**Change**: Replace `alreadyCoveredPoints` metadata with `priorSectionsProseSample`

**Implementation**:
1. After each section is written, append the **full body text** to a `writtenCorpus`
2. For intra-chapter dedup: send the **last 3 sections' full prose** (not key points)
3. For cross-chapter dedup: send **last 2 paragraphs of each prior chapter** (actual sentences)
4. N-gram overlap will now detect: same story openings, same scripture quotes, same phrasing patterns

**Files to modify**:
- [`EbookPipeline.tsx:2348-2380`](EbookPipeline.tsx#L2348-L2380) — Update `buildCoveredKeyPoints()` to sample prose
- [`write-section/route.ts:628-630`](write-section/route.ts#L628-L630) — Always use prose sample, remove metadata fallback

**Risk**: Low — `priorSectionsSample` already exists, just not populated correctly

---

### Fix 2: Single Source of Truth for Content Assignment ✅ READY TO IMPLEMENT

**Change**: Make the Architect's `sourceSegmentIds` the **only** content assignment authority

**Implementation**:
1. **Architect** assigns segments to sections (already does this)
2. **Chapter-plan** receives ONLY the segments assigned to each section — **cannot reassign**
3. **Write-section** receives ONLY the segments from the plan — **cannot access other segments**
4. Remove the per-section planner fallback — if chapter-plan fails, **fail the pipeline** (user re-runs)

**Files to modify**:
- [`assign-segments/route.ts:49-84`](assign-segments/route.ts#L49-L84) — Filter excerpts by sourceSegmentIds before sending to chapter-plan
- [`chapter-plan/route.ts:88-97`](chapter-plan/route.ts#L88-L97) — Remove "full transcript" and use pre-filtered excerpts only
- [`write-section/route.ts:824-890`](write-section/route.ts#L824-L890) — Remove fallback planner

**Risk**: Medium — If architect misassigns segments, no recovery path (but that's better than duplication)

---

### Fix 3: Programmatic Chapter Boundary Enforcement 🔧 REQUIRES DESIGN DECISION

**Option A: Hard Truncation** (Conservative)
1. Architect marks which segment IDs belong to which chapter
2. When writing the final section of Chapter N, **only send excerpts from segments assigned to Chapter N**
3. If the speaker's argument continues into Chapter N+1 segments, those excerpts are **not sent** to the writer
4. Chapter N ends mid-argument → Chapter N+1 picks up the thread

**Option B: Split-Point Detection** (Aggressive)
1. After the writer returns prose for the last section of Chapter N, scan the prose for **forward-looking phrases**:
   - "In the next chapter..."
   - "We will see..."
   - References to the next chapter's title keywords
2. If detected, **truncate the prose** before that sentence
3. Return the truncated version + log the split for user review

**Your input needed**: Which approach fits your content style?
- **Option A**: More conservative, may create abrupt chapter endings but zero spillage
- **Option B**: Smoother flow, but requires reliable split-point detection

---

### Fix 4: Relax the Monotonic Excerpt Rule 🔧 REQUIRES DESIGN DECISION

**Current**: Chapter-plan enforces `supportedExcerptNumbers` must increase monotonically

**Problem**: Speakers often structure teaching non-linearly:
- Introduce principle 1, 2, 3
- Then explain 1 in depth (circling back)
- Then explain 2 in depth (circling back)

**Proposed Change**: Allow chapter-plan to assign excerpts **non-monotonically**, but:
1. Each excerpt can only be assigned to **ONE section** per chapter
2. Introduce a "reference allowance" — if Section 3 needs to briefly recall a point from Section 1, allow a **10-20 word inline reference** but not a full re-explanation

**Implementation**:
- [`chapter-plan/route.ts:127-128`](chapter-plan/route.ts#L127-L128) — Remove monotonic enforcement
- [`chapter-plan/route.ts:177-189`](chapter-plan/route.ts#L177-L189) — Add excerpt-usage deduplication across the chapter's section plans
- [`write-section/route.ts:860`](write-section/route.ts#L860) — Update planner prompt to allow non-monotonic plans

**Your input needed**: Does your speaker typically:
- Follow a strict linear build (keep monotonic rule)
- Use parallel structure or thematic repetition (remove monotonic rule)

---

## Recommended Implementation Order

1. **Fix 1** (prose-based dedup) — **IMMEDIATE**, highest ROI, lowest risk
2. **Fix 2** (single assignment authority) — **HIGH PRIORITY**, prevents cross-chapter conflicts
3. **Fix 3** (chapter boundary enforcement) — **YOUR DESIGN INPUT NEEDED**
4. **Fix 4** (relax monotonic rule) — **YOUR DESIGN INPUT NEEDED**

---

## Summary of Files That Need Changes

| File | Issue | Change Required |
|------|-------|-----------------|
| [`EbookPipeline.tsx`](EbookPipeline.tsx#L2348-L2380) | Metadata dedup | Populate `priorSectionsSample` with actual prose |
| [`write-section/route.ts`](write-section/route.ts#L628-L630) | Metadata fallback | Always use prose sample, remove metadata path |
| [`assign-segments/route.ts`](assign-segments/route.ts#L49-L84) | Dual assignment | Pre-filter excerpts by sourceSegmentIds |
| [`chapter-plan/route.ts`](chapter-plan/route.ts#L88-L230) | Conflict resolution | Receive pre-filtered excerpts only, add cross-section dedup |
| [`write-section/route.ts`](write-section/route.ts#L824-L890) | Fallback planner | Remove fallback, require chapter-plan success |
| [`write-section/route.ts`](write-section/route.ts#L734-L746) | Boundary spillage | Add programmatic truncation (pending your input on Option A vs B) |
| [`chapter-plan/route.ts`](chapter-plan/route.ts#L127-L128) | Monotonic rule | Remove or keep (pending your input on teaching structure) |

---

## Questions for You (Design Decisions)

1. **Chapter boundary strategy**: Option A (hard truncation) or Option B (split-point detection)?
2. **Monotonic rule**: Does your speaker's teaching flow linearly, or use thematic repetition?
3. **Fallback tolerance**: Should the pipeline fail hard if chapter-plan fails, or keep the per-section fallback?
4. **Cross-chapter dedup aggressiveness**: Should Chapter 2 be allowed to briefly restate a Chapter 1 principle (with inline reference), or is any repetition unacceptable?

**Reply with your preferences, and I will implement the approved fixes.**
