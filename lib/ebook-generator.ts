/**
 * ebook-generator.ts
 * Server-side PDF, EPUB, and DOCX generation from an EbookManifest.
 * PDF: @react-pdf/renderer   EPUB: epub-gen-memory   DOCX: docx
 */

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import Epub from "epub-gen-memory";
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  SectionType,
} from "docx";
import type { EbookManifest, ChapterDraft, Quote } from "@/lib/schemas/ebook";

// ─── PDF styles ──────────────────────────────────────────────────────────────
// Trade paperback standard (6" × 9" = 432pt × 648pt in Points, A4 approximation)
// Margins follow Chicago Manual of Style trade press convention:
//   Top/bottom: 1 inch (72pt), Inside (left): 1.25 in (90pt), Outside (right): 0.75 in (54pt)

const styles = StyleSheet.create({
  page: {
    fontFamily: "Times-Roman",
    fontSize: 11.5,
    lineHeight: 1.7,
    color: "#111111",
    paddingTop: 72,
    paddingBottom: 90,
    paddingLeft: 90,   // inside margin (wider for binding gutter)
    paddingRight: 60,  // outside margin
  },
  // Running header — alternates Author | Book Title per trade convention
  runningHeader: {
    position: "absolute",
    top: 28,
    left: 90,
    right: 60,
    fontSize: 8.5,
    fontFamily: "Times-Italic",
    color: "#888888",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  // Cover
  coverPage: {
    fontFamily: "Helvetica",
    backgroundColor: "#0f172a",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 72,
    paddingBottom: 72,
    paddingLeft: 72,
    paddingRight: 72,
  },
  coverTitle: {
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    color: "#e2e8f0",
    textAlign: "center",
    marginBottom: 22,
    lineHeight: 1.25,
  },
  coverSubtitle: {
    fontSize: 15,
    color: "#94a3b8",
    textAlign: "center",
    marginBottom: 44,
    lineHeight: 1.5,
  },
  coverAuthor: {
    fontSize: 14,
    color: "#cbd5e1",
    textAlign: "center",
    fontFamily: "Times-Italic",
  },
  coverRule: {
    width: 60,
    height: 2,
    backgroundColor: "#06b6d4",
    marginBottom: 22,
    marginTop: 22,
  },
  // TOC
  tocTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 28,
    color: "#111111",
    borderBottom: "1pt solid #cccccc",
    paddingBottom: 10,
  },
  tocEntry: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    fontSize: 11,
  },
  tocChapterTitle: { color: "#111111", flex: 1 },
  tocPageNum: { color: "#888888", width: 30, textAlign: "right" },
  tocDots: { color: "#cccccc", flex: 1, textAlign: "center" },

  // ── Chapter opening page ─────────────────────────────────────────────────
  // Blank before chapter number (drop down one-third from top)
  chapterOpenSpacer: {
    height: 120, // push chapter number down ~1/3 of the page
  },
  chapterLabel: {
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#888888",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginBottom: 14,
    textAlign: "center",
  },
  chapterTitle: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: "#111111",
    marginBottom: 10,
    lineHeight: 1.25,
    textAlign: "center",
  },
  chapterRule: {
    width: 36,
    height: 2,
    backgroundColor: "#888888",
    marginBottom: 32,
    marginTop: 16,
    alignSelf: "center",
  },

  // ── Section heading ───────────────────────────────────────────────────────
  sectionHeading: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#111111",
    marginTop: 28,
    marginBottom: 12,
  },

  // ── Section ornament divider ─────────────────────────────────────────────
  sectionDivider: {
    textAlign: "center",
    fontSize: 14,
    color: "#aaaaaa",
    marginTop: 18,
    marginBottom: 18,
    fontFamily: "Times-Roman",
  },

  // ── Body text ─────────────────────────────────────────────────────────────
  // First paragraph after chapter/section heading — no indent
  paragraphFirst: {
    fontSize: 11.5,
    fontFamily: "Times-Roman",
    lineHeight: 1.7,
    marginBottom: 0,
    textAlign: "justify",
    color: "#111111",
  },
  // All subsequent paragraphs: first-line indent, no extra space between
  paragraph: {
    fontSize: 11.5,
    fontFamily: "Times-Roman",
    lineHeight: 1.7,
    marginBottom: 0,
    textIndent: 20,
    textAlign: "justify",
    color: "#111111",
  },

  // ── Block quote (Chicago: 40+ words, indented, no quotation marks) ───────
  blockQuote: {
    fontSize: 11,
    fontFamily: "Times-Italic",
    lineHeight: 1.75,
    marginTop: 16,
    marginBottom: 4,
    marginLeft: 40,
    marginRight: 24,
    color: "#222222",
  },
  blockQuoteRef: {
    fontSize: 9.5,
    fontFamily: "Times-Italic",
    color: "#666666",
    marginLeft: 40,
    marginBottom: 16,
  },

  // ── Pull quote (notable teaching statement — set apart visually) ─────────
  pullQuote: {
    fontSize: 13,
    fontFamily: "Times-Italic",
    lineHeight: 1.6,
    marginTop: 20,
    marginBottom: 20,
    marginLeft: 16,
    marginRight: 16,
    color: "#1a1a1a",
    borderTop: "1pt solid #cccccc",
    borderBottom: "1pt solid #cccccc",
    paddingTop: 12,
    paddingBottom: 12,
    textAlign: "center",
  },

  // ── Key takeaways box ─────────────────────────────────────────────────────
  takeawaysBox: {
    marginTop: 36,
    marginBottom: 20,
    padding: 18,
    backgroundColor: "#f8f8f8",
    borderLeft: "3pt solid #333333",
  },
  takeawaysTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#333333",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  takeawayItem: {
    fontSize: 11,
    fontFamily: "Times-Roman",
    lineHeight: 1.55,
    color: "#111111",
    marginBottom: 6,
  },

  // ── Reflection questions ──────────────────────────────────────────────────
  reflectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#333333",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginTop: 28,
    marginBottom: 10,
  },
  reflectionItem: {
    fontSize: 11,
    fontFamily: "Times-Italic",
    lineHeight: 1.65,
    color: "#333333",
    marginBottom: 8,
  },

  // ── Front/back matter ─────────────────────────────────────────────────────
  matterTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#111111",
    marginBottom: 24,
    borderBottom: "1pt solid #cccccc",
    paddingBottom: 10,
  },

  // ── Page number footer ────────────────────────────────────────────────────
  pageNumber: {
    position: "absolute",
    fontSize: 9,
    bottom: 40,
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#999999",
    fontFamily: "Times-Roman",
  },
});

// ─── PDF helpers ──────────────────────────────────────────────────────────────

function renderBodyText(text: string, quotes: Quote[], firstParaStyle = false) {
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs.map((para, i) => {
    const trimmed = para.trim();
    if (!trimmed) return null;

    // Block quote detection: matches a scripture/quote stored in the manifest
    const matchingQuote = quotes.find(
      (q) => q.isBlockQuote && trimmed.includes(q.text.slice(0, 30))
    );
    if (matchingQuote) {
      return React.createElement(
        React.Fragment,
        { key: i },
        React.createElement(Text, { style: styles.blockQuote }, matchingQuote.text),
        React.createElement(
          Text,
          { style: styles.blockQuoteRef },
          matchingQuote.reference
            ? `— ${matchingQuote.reference}${matchingQuote.translation ? ` (${matchingQuote.translation})` : ""}`
            : ""
        )
      );
    }

    // First paragraph after a heading — no indent (trade convention)
    const paraStyle = (i === 0 && firstParaStyle) ? styles.paragraphFirst : styles.paragraph;
    return React.createElement(Text, { key: i, style: paraStyle }, trimmed);
  });
}

function ChapterPage({ chapter, quotes }: { chapter: ChapterDraft; quotes: Quote[] }) {
  return React.createElement(
    Page,
    { size: "A4", style: styles.page },
    // Running header: "Author Name" on left recto pages
    React.createElement(Text, { style: styles.runningHeader }, chapter.title),
    // Chapter opening: centered, dropped one-third down
    React.createElement(View, { style: styles.chapterOpenSpacer }),
    React.createElement(Text, { style: styles.chapterLabel }, `Chapter ${chapter.number}`),
    React.createElement(Text, { style: styles.chapterTitle }, chapter.title),
    React.createElement(View, { style: styles.chapterRule }),
    // Chapter intro — first paragraph no indent
    ...renderBodyText(chapter.intro, quotes, true).filter(Boolean),
    // Sections
    ...chapter.sections.flatMap((section, si) => [
      // Section ornament divider (between sections, not before first)
      si > 0
        ? React.createElement(Text, { key: `div-${section.sectionNumber}`, style: styles.sectionDivider }, "✦  ✦  ✦")
        : null,
      React.createElement(
        Text,
        { key: `h-${section.sectionNumber}`, style: styles.sectionHeading },
        section.heading
      ),
      ...renderBodyText(section.body, quotes, true).filter(Boolean),
    ]).filter(Boolean),
    // Section ornament before conclusion
    React.createElement(Text, { style: styles.sectionDivider }, "✦  ✦  ✦"),
    // Conclusion
    ...renderBodyText(chapter.conclusion, quotes, true).filter(Boolean),
    // Key Takeaways — boxed, publisher convention
    React.createElement(
      View,
      { style: styles.takeawaysBox },
      React.createElement(Text, { style: styles.takeawaysTitle }, "Key Takeaways"),
      ...chapter.keyTakeaways.map((item, i) =>
        React.createElement(Text, { key: i, style: styles.takeawayItem }, `\u2022\u2002${item}`)
      )
    ),
    // Reflection Questions
    chapter.reflectionQuestions.length > 0
      ? React.createElement(
          View,
          null,
          React.createElement(Text, { style: styles.reflectionTitle }, "For Reflection"),
          ...chapter.reflectionQuestions.map((q, i) =>
            React.createElement(Text, { key: i, style: styles.reflectionItem }, `${i + 1}.\u2002${q}`)
          )
        )
      : null,
    // Page number
    React.createElement(
      Text,
      { style: styles.pageNumber, render: ({ pageNumber }: { pageNumber: number }) => `${pageNumber}` },
      null
    )
  );
}

function buildPdfDocument(manifest: EbookManifest) {
  const { bookTitle, subtitle, authorName, frontMatter, chapters, allQuotes } = manifest;

  return React.createElement(
    Document,
    { title: bookTitle, author: authorName, subject: subtitle },

    // ── Cover Page ──
    React.createElement(
      Page,
      { size: "A4", style: styles.coverPage },
      React.createElement(Text, { style: styles.coverTitle }, bookTitle),
      React.createElement(View, { style: styles.coverRule }),
      React.createElement(Text, { style: styles.coverSubtitle }, subtitle),
      React.createElement(Text, { style: styles.coverAuthor }, authorName)
    ),

    // ── Table of Contents ──
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.tocTitle }, "Contents"),
      ...chapters.map((ch) =>
        React.createElement(
          View,
          { key: ch.number, style: styles.tocEntry },
          React.createElement(
            Text,
            { style: styles.tocChapterTitle },
            `${ch.number}. ${ch.title}`
          )
        )
      )
    ),

    // ── Preface ──
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.matterTitle }, "Preface"),
      ...renderBodyText(frontMatter.preface, allQuotes).filter(Boolean),
      React.createElement(
        Text,
        { style: styles.pageNumber, render: ({ pageNumber }: { pageNumber: number }) => `${pageNumber}` },
        null
      )
    ),

    // ── Introduction ──
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.matterTitle }, "Introduction"),
      ...renderBodyText(frontMatter.introduction, allQuotes).filter(Boolean),
      React.createElement(
        Text,
        { style: styles.pageNumber, render: ({ pageNumber }: { pageNumber: number }) => `${pageNumber}` },
        null
      )
    ),

    // ── Chapters ──
    ...chapters.map((ch) =>
      React.createElement(ChapterPage, { key: ch.number, chapter: ch, quotes: allQuotes })
    ),

    // ── Conclusion ──
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.matterTitle }, "Conclusion"),
      ...renderBodyText(frontMatter.conclusion, allQuotes).filter(Boolean),
      React.createElement(
        Text,
        { style: styles.pageNumber, render: ({ pageNumber }: { pageNumber: number }) => `${pageNumber}` },
        null
      )
    ),

    // ── About the Author ──
    ...(frontMatter.aboutAuthor
      ? [
          React.createElement(
            Page,
            { size: "A4", style: styles.page },
            React.createElement(Text, { style: styles.matterTitle }, "About the Author"),
            ...renderBodyText(frontMatter.aboutAuthor, allQuotes).filter(Boolean)
          ),
        ]
      : [])
  );
}

// ─── EPUB HTML helpers ────────────────────────────────────────────────────────

function quoteToHtml(q: Quote): string {
  const ref = q.reference
    ? `<cite class="quote-ref">${q.reference}${q.translation ? ` (${q.translation})` : ""}</cite>`
    : "";
  if (q.isBlockQuote) {
    return `<blockquote class="block-quote"><p>${q.text}</p>${ref}</blockquote>`;
  }
  return `"${q.text}" ${ref}`;
}

function chapterToHtml(chapter: ChapterDraft): string {
  const sections = chapter.sections
    .map(
      (s, si) =>
        `${si > 0 ? '<div class="divider">\u2726&nbsp;&nbsp;\u2726&nbsp;&nbsp;\u2726</div>\n' : ""}<h3>${s.heading}</h3>\n${s.body
          .split(/\n{2,}/)
          .filter(Boolean)
          .map((p, pi) => `<p${pi === 0 ? ' class="no-indent"' : ""}>${p.trim()}</p>`)
          .join("\n")}`
    )
    .join("\n");

  const takeaways =
    chapter.keyTakeaways.length > 0
      ? `<div class="takeaways-box"><h4>Key Takeaways</h4><ul>${chapter.keyTakeaways
          .map((t) => `<li>${t}</li>`)
          .join("")}</ul></div>`
      : "";

  const reflections =
    chapter.reflectionQuestions.length > 0
      ? `<div class="reflections"><h4>For Reflection</h4><ol>${chapter.reflectionQuestions
          .map((q) => `<li>${q}</li>`)
          .join("")}</ol></div>`
      : "";

  return `
<p class="chapter-label">Chapter ${chapter.number}</p>
<h2>${chapter.title}</h2>
<p class="no-indent">${chapter.intro}</p>
${sections}
<div class="divider">\u2726&nbsp;&nbsp;\u2726&nbsp;&nbsp;\u2726</div>
<p class="no-indent">${chapter.conclusion}</p>
${takeaways}
${reflections}
  `.trim();
}

const EPUB_CSS = `
/* ── Base ── */
body { font-family: Georgia, 'Times New Roman', serif; font-size: 1em; line-height: 1.75; color: #111; margin: 3em 2.5em; }

/* ── Headings ── */
h1 { font-size: 1.85em; font-family: 'Arial', Helvetica, sans-serif; color: #111; margin-top: 3em; margin-bottom: 0.25em; font-weight: bold; }
h2 { font-size: 1.4em; font-family: 'Arial', Helvetica, sans-serif; color: #111; margin-top: 3.5em; margin-bottom: 0.3em; font-weight: bold; text-align: center; }
h2 + p:first-of-type { text-indent: 0; }  /* no indent after chapter title */
h3 { font-size: 1.1em; font-family: 'Arial', Helvetica, sans-serif; color: #111; margin-top: 2em; margin-bottom: 0.3em; font-weight: bold; }
h3 + p:first-of-type { text-indent: 0; }
h4 { font-size: 0.85em; font-family: 'Arial', Helvetica, sans-serif; color: #444; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 2em; margin-bottom: 0.5em; }

/* ── Chapter epigraph (chapter subtitle area) ── */
.chapter-label { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.2em; color: #888; text-align: center; margin-top: 2em; margin-bottom: 0.15em; }

/* ── Body paragraphs — first-line indent, no space between (trade standard) ── */
p { margin: 0; text-indent: 1.5em; text-align: justify; }
p:first-of-type, p.no-indent { text-indent: 0; }

/* ── Section ornament divider ── */
.divider { text-align: center; color: #aaa; font-size: 1.2em; margin: 2em 0; letter-spacing: 0.4em; }

/* ── Block quotes (Chicago 40+ words) ── */
blockquote { margin: 1.4em 0 1.4em 2.5em; padding: 0; font-style: italic; color: #333; }
blockquote p { text-indent: 0; }
cite.quote-ref { display: block; font-size: 0.82em; color: #666; margin-top: 0.3em; font-style: normal; }

/* ── Key takeaways box ── */
.takeaways-box { background: #f9f9f9; border-left: 3px solid #333; padding: 1em 1.4em; margin: 2em 0; }
.takeaways-box h4 { margin-top: 0; }
.takeaways-box ul { margin: 0.5em 0 0 0; padding-left: 1.2em; }
.takeaways-box li { margin-bottom: 0.45em; text-indent: 0; font-size: 0.97em; }

/* ── Reflection questions ── */
.reflections { margin-top: 1.5em; }
.reflections ol { padding-left: 1.4em; }
.reflections li { margin-bottom: 0.7em; font-style: italic; color: #333; text-indent: 0; }
`;

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generatePdfBuffer(manifest: EbookManifest): Promise<Buffer> {
  const doc = buildPdfDocument(manifest);
  const instance = pdf(doc);
  const buffer = await instance.toBuffer();
  return buffer;
}

export async function generateEpubBuffer(manifest: EbookManifest): Promise<Buffer> {
  const { bookTitle, subtitle, authorName, frontMatter, chapters } = manifest;

  const content = [
    {
      title: "Preface",
      data: `<h1>Preface</h1>${frontMatter.preface
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((p) => `<p>${p.trim()}</p>`)
        .join("\n")}`,
    },
    {
      title: "Introduction",
      data: `<h1>Introduction</h1>${frontMatter.introduction
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((p) => `<p>${p.trim()}</p>`)
        .join("\n")}`,
    },
    ...chapters.map((ch) => ({
      title: `Chapter ${ch.number}: ${ch.title}`,
      data: chapterToHtml(ch),
    })),
    {
      title: "Conclusion",
      data: `<h1>Conclusion</h1>${frontMatter.conclusion
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((p) => `<p>${p.trim()}</p>`)
        .join("\n")}`,
    },
    ...(frontMatter.aboutAuthor
      ? [
          {
            title: "About the Author",
            data: `<h1>About the Author</h1>${frontMatter.aboutAuthor
              .split(/\n{2,}/)
              .filter(Boolean)
              .map((p) => `<p>${p.trim()}</p>`)
              .join("\n")}`,
          },
        ]
      : []),
  ];

  const epubInstance = new Epub(
    {
      title: bookTitle,
      author: authorName,
      description: subtitle,
      css: EPUB_CSS,
      lang: "en",
      content,
    },
    content
  );

  const arrayBuffer = await epubInstance.genEpub();
  return Buffer.from(arrayBuffer);
}

// ─── DOCX generation ──────────────────────────────────────────────────────────

function textToParagraphs(text: string): Paragraph[] {
  return text
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, size: 24 })], // 12pt
          spacing: { after: 160 },
        })
    );
}

export async function generateDocxBuffer(manifest: EbookManifest): Promise<Buffer> {
  const { bookTitle, subtitle, authorName, frontMatter, chapters } = manifest;

  const children: Paragraph[] = [];

  // ── Cover ────────────────────────────────────────────────────────────────
  children.push(
    new Paragraph({
      children: [new TextRun({ text: bookTitle, bold: true, size: 56 })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: subtitle, size: 28, italics: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: authorName, size: 26 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    }),
    new Paragraph({ children: [new PageBreak()] })
  );

  // ── Front matter ─────────────────────────────────────────────────────────
  const frontSections: Array<{ title: string; text: string }> = [
    { title: "Preface", text: frontMatter.preface },
    { title: "Introduction", text: frontMatter.introduction },
  ];
  if (frontMatter.dedication) {
    frontSections.unshift({ title: "Dedication", text: frontMatter.dedication });
  }

  for (const section of frontSections) {
    if (!section.text?.trim()) continue;
    children.push(
      new Paragraph({
        text: section.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 240 },
      }),
      ...textToParagraphs(section.text),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  // ── Chapters ──────────────────────────────────────────────────────────────
  for (const chapter of chapters) {
    children.push(
      new Paragraph({
        text: `Chapter ${chapter.number}: ${chapter.title}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 300 },
      })
    );

    for (const section of chapter.sections) {
      if (section.heading) {
        children.push(
          new Paragraph({
            text: section.heading,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 280, after: 160 },
          })
        );
      }
      children.push(...textToParagraphs(section.body));
    }

    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  // ── Back matter ───────────────────────────────────────────────────────────
  if (frontMatter.conclusion?.trim()) {
    children.push(
      new Paragraph({
        text: "Conclusion",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 240 },
      }),
      ...textToParagraphs(frontMatter.conclusion),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  if (frontMatter.aboutAuthor?.trim()) {
    children.push(
      new Paragraph({
        text: "About the Author",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 240 },
      }),
      ...textToParagraphs(frontMatter.aboutAuthor)
    );
  }

  const doc = new DocxDocument({
    sections: [
      {
        properties: { type: SectionType.CONTINUOUS },
        children,
      },
    ],
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
        },
      },
    },
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}
