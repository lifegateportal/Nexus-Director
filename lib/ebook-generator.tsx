/**
 * ebook-generator.tsx
 * Converts an EbookManifest into PDF and EPUB binary buffers.
 * PDF: pdfkit (pure JS, zero native dependencies — works on any server)
 * EPUB: epub-gen-memory
 */

import type { EbookManifest, ChapterDraft, FrontBackMatter, Quote } from "@/lib/schemas/ebook";
import { existsSync } from "node:fs";
import { type BookTemplateConfig, getTemplate } from "@/lib/book-templates";

type PdfFontSet = {
  serif: string;
  serifItalic: string;
  serifBold: string;
  sans: string;
  sansBold: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolvePdfFonts(doc: any): PdfFontSet {
  const georgiaPaths = {
    regular: [
      "/usr/share/fonts/truetype/msttcorefonts/Georgia.ttf",
      "/usr/share/fonts/truetype/msttcorefonts/georgia.ttf",
      "/usr/share/fonts/truetype/microsoft/Georgia.ttf",
    ],
    italic: [
      "/usr/share/fonts/truetype/msttcorefonts/Georgia_Italic.ttf",
      "/usr/share/fonts/truetype/msttcorefonts/georgiai.ttf",
      "/usr/share/fonts/truetype/microsoft/Georgia Italic.ttf",
    ],
    bold: [
      "/usr/share/fonts/truetype/msttcorefonts/Georgia_Bold.ttf",
      "/usr/share/fonts/truetype/msttcorefonts/georgiab.ttf",
      "/usr/share/fonts/truetype/microsoft/Georgia Bold.ttf",
    ],
  };

  const pickPath = (paths: string[]) => paths.find((path) => existsSync(path));
  const regular = pickPath(georgiaPaths.regular);
  const italic = pickPath(georgiaPaths.italic);
  const bold = pickPath(georgiaPaths.bold);

  if (regular && italic && bold) {
    doc.registerFont("BookGeorgia", regular);
    doc.registerFont("BookGeorgiaItalic", italic);
    doc.registerFont("BookGeorgiaBold", bold);
    return {
      serif: "BookGeorgia",
      serifItalic: "BookGeorgiaItalic",
      serifBold: "BookGeorgiaBold",
      sans: "Helvetica",
      sansBold: "Helvetica-Bold",
    };
  }

  return {
    serif: "Times-Roman",
    serifItalic: "Times-Italic",
    serifBold: "Times-Bold",
    sans: "Helvetica",
    sansBold: "Helvetica-Bold",
  };
}

// ─── Font key resolver ────────────────────────────────────────────────────────
function f(fonts: PdfFontSet, key: "serif" | "serifBold" | "sans" | "sansBold" | "serifItalic"): string {
  return fonts[key];
}

// ─── PDF Generator (pdfkit) ───────────────────────────────────────────────────

export async function generatePdfBuffer(manifest: EbookManifest, templateId?: string | null): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PDFDocument = (await import("pdfkit")).default as any;
  const tmpl = getTemplate(templateId);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: tmpl.pageSize,
      margins: tmpl.margins,
      autoFirstPage: true,
    });
    const fonts = resolvePdfFonts(doc);
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Title page ────────────────────────────────────────────────────────────
    doc
      .moveDown(tmpl.titlePageTopGap)
      .fontSize(tmpl.titlePageTitleSize).font(f(fonts, "serifBold")).fillColor("#111111")
      .text(manifest.bookTitle, { align: tmpl.titlePageAlign });

    if (manifest.subtitle) {
      doc
        .moveDown(0.8)
        .fontSize(tmpl.titlePageSubtitleSize).font(f(fonts, "serifItalic")).fillColor("#555555")
        .text(manifest.subtitle, { align: tmpl.titlePageAlign });
    }

    doc
      .moveDown(2)
      .fontSize(tmpl.titlePageAuthorSize).font(f(fonts, "serif")).fillColor("#444444")
      .text(manifest.authorName, { align: tmpl.titlePageAlign });

    writeFrontMatter(doc, manifest.frontMatter, manifest.allQuotes ?? [], fonts, tmpl);

    for (const chapter of manifest.chapters) {
      writeChapter(doc, chapter, manifest.allQuotes ?? [], fonts, tmpl);
    }

    writeBackMatter(doc, manifest.frontMatter, manifest.allQuotes ?? [], fonts, tmpl);
    doc.end();
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeDivider(doc: any, tmpl: BookTemplateConfig) {
  if (!tmpl.showDivider) { doc.moveDown(0.6); return; }
  doc.moveDown(0.5);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor(tmpl.dividerColor).lineWidth(0.5).stroke();
  doc.moveDown(0.5);
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[“”"'.,;:!?()[\]{}-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findMatchingBlockQuote(paragraph: string, quotes: Quote[]): Quote | null {
  const normalizedParagraph = normalizeText(paragraph);
  return quotes.find((quote) => {
    if (!quote.isBlockQuote || !quote.text) return false;
    const normalizedQuote = normalizeText(quote.text);
    const lead = normalizedQuote.split(" ").slice(0, 8).join(" ");
    return lead.length > 20 && normalizedParagraph.includes(lead);
  }) ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeScriptureBlock(doc: any, quote: Quote, fonts: PdfFontSet, tmpl: BookTemplateConfig) {
  const bodyWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.moveDown(0.4);
  doc
    .fontSize(tmpl.scriptureFontSize)
    .font(fonts.serifItalic)
    .fillColor("#202020")
    .text(quote.text, {
      lineGap: 5,
      indent: tmpl.scriptureIndent,
      width: bodyWidth - tmpl.scriptureIndent - 8,
      align: "left",
    });

  const reference = quote.reference
    ? `${quote.reference}${quote.translation ? ` (${quote.translation})` : ""}`
    : "";

  if (reference) {
    doc
      .moveDown(0.15)
      .fontSize(tmpl.scriptureFontSize - 0.5)
      .font(fonts.serifBold)
      .fillColor("#1a1a1a")
      .text(`\u2014 ${reference}`, {
        align: "right",
        width: bodyWidth - 16,
      });
  }

  doc.moveDown(0.8);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeRichBody(doc: any, text: string, quotes: Quote[], fonts: PdfFontSet, tmpl: BookTemplateConfig, options?: { italicFirstParagraph?: boolean; noIndentFirstParagraph?: boolean }) {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  paragraphs.forEach((paragraph, index) => {
    const matchingQuote = findMatchingBlockQuote(paragraph, quotes);
    if (matchingQuote) {
      writeScriptureBlock(doc, matchingQuote, fonts, tmpl);
      return;
    }

    const font = options?.italicFirstParagraph && index === 0 ? fonts.serifItalic : fonts.serif;
    const color = options?.italicFirstParagraph && index === 0 ? "#444444" : "#1a1a1a";
    // For indent-style templates: no indent on first paragraph after a heading/page break;
    // for gap-style templates: indent is always 0.
    const isFirstAfterBreak = (options?.noIndentFirstParagraph !== false) && index === 0;
    const indent = tmpl.paragraphIndent > 0
      ? (isFirstAfterBreak ? 0 : tmpl.paragraphIndent)
      : 0;
    const paragraphGap = tmpl.paragraphGap;
    doc
      .fontSize(tmpl.bodyFontSize)
      .font(font)
      .fillColor(color)
      .text(paragraph, {
        lineGap: tmpl.bodyLineGap,
        indent,
        paragraphGap,
        align: tmpl.bodyAlign,
      });
    // Extra inter-paragraph spacing for indent-style templates (gap-style uses paragraphGap natively)
    if (tmpl.paragraphIndent > 0 && tmpl.paragraphGap === 0) {
      doc.moveDown(0.05);
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeMatterTitle(doc: any, title: string, fonts: PdfFontSet, tmpl: BookTemplateConfig) {
  doc
    .moveDown(tmpl.chapterPreGap)
    .fontSize(tmpl.matterTitleSize)
    .font(f(fonts, "serifBold"))
    .fillColor(tmpl.chapterTitleColor)
    .text(title, { align: tmpl.matterTitleAlign });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeFrontMatter(doc: any, fm: FrontBackMatter, quotes: Quote[], fonts: PdfFontSet, tmpl: BookTemplateConfig) {
  doc.addPage();
  writeMatterTitle(doc, "Preface", fonts, tmpl);
  writeDivider(doc, tmpl);
  writeRichBody(doc, fm.preface, quotes, fonts, tmpl, { noIndentFirstParagraph: true });

  doc.addPage();
  writeMatterTitle(doc, "Introduction", fonts, tmpl);
  writeDivider(doc, tmpl);
  writeRichBody(doc, fm.introduction, quotes, fonts, tmpl, { noIndentFirstParagraph: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeChapter(doc: any, chapter: ChapterDraft, quotes: Quote[], fonts: PdfFontSet, tmpl: BookTemplateConfig) {
  doc.addPage();
  doc.moveDown(tmpl.chapterPreGap);

  // Chapter label (e.g. "CHAPTER 1" / "01" / "I")
  const labelText = tmpl.chapterLabel(chapter.number);
  doc
    .fontSize(tmpl.chapterLabelSize)
    .font(f(fonts, tmpl.chapterLabelFont))
    .fillColor(tmpl.chapterLabelColor)
    .text(labelText, { align: tmpl.chapterLabelAlign });

  doc.moveDown(0.35)
    .fontSize(tmpl.chapterTitleSize)
    .font(f(fonts, tmpl.chapterTitleFont))
    .fillColor(tmpl.chapterTitleColor)
    .text(chapter.title, { align: tmpl.chapterTitleAlign });

  writeDivider(doc, tmpl);

  if (chapter.intro) {
    writeRichBody(doc, chapter.intro, quotes, fonts, tmpl, { italicFirstParagraph: true, noIndentFirstParagraph: true });
  }

  for (const section of chapter.sections) {
    doc.moveDown(0.5);
    doc
      .fontSize(tmpl.sectionSize)
      .font(f(fonts, tmpl.sectionFont))
      .fillColor(tmpl.sectionColor)
      .text(section.heading, { align: tmpl.sectionAlign });
    if (tmpl.sectionRule) {
      const y = doc.y + 2;
      doc
        .moveTo(doc.page.margins.left, y)
        .lineTo(doc.page.width - doc.page.margins.right, y)
        .strokeColor(tmpl.accentColor).lineWidth(0.4).stroke();
    }
    doc.moveDown(0.2);
    writeRichBody(doc, section.body, quotes, fonts, tmpl, { noIndentFirstParagraph: true });
  }

  if (chapter.conclusion) {
    writeDivider(doc, tmpl);
    writeRichBody(doc, chapter.conclusion, quotes, fonts, tmpl, { noIndentFirstParagraph: true });
  }

  if ((chapter.keyTakeaways ?? []).length > 0) {
    doc.moveDown(0.3);
    doc.fontSize(9).font(f(fonts, "sansBold")).fillColor(tmpl.labelColor).text("KEY TAKEAWAYS");
    doc.moveDown(0.3);
    for (const t of (chapter.keyTakeaways ?? [])) {
      doc.fontSize(tmpl.bodyFontSize - 1).font(f(fonts, "serif")).fillColor("#222222").text(`• ${t}`, { lineGap: 3.5 });
    }
    doc.moveDown();
  }

  if ((chapter.reflectionQuestions ?? []).length > 0) {
    doc.moveDown(0.3);
    doc.fontSize(9).font(f(fonts, "sansBold")).fillColor(tmpl.labelColor).text("REFLECTION QUESTIONS");
    doc.moveDown(0.3);
    (chapter.reflectionQuestions ?? []).forEach((q, i) => {
      doc.fontSize(tmpl.bodyFontSize - 1).font(f(fonts, "serif")).fillColor("#222222").text(`${i + 1}. ${q}`, { lineGap: 3.5 });
    });
    doc.moveDown();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeBackMatter(doc: any, fm: FrontBackMatter, quotes: Quote[], fonts: PdfFontSet, tmpl: BookTemplateConfig) {
  doc.addPage();
  writeMatterTitle(doc, "Conclusion", fonts, tmpl);
  writeDivider(doc, tmpl);
  writeRichBody(doc, fm.conclusion, quotes, fonts, tmpl, { noIndentFirstParagraph: true });

  if (fm.aboutAuthor) {
    doc.addPage();
    writeMatterTitle(doc, "About the Author", fonts, tmpl);
    writeDivider(doc, tmpl);
    writeRichBody(doc, fm.aboutAuthor, quotes, fonts, tmpl, { noIndentFirstParagraph: true });
  }

  if ((fm.resourcesList ?? []).length > 0) {
    doc.addPage();
    writeMatterTitle(doc, "Resources", fonts, tmpl);
    writeDivider(doc, tmpl);
    for (const r of (fm.resourcesList ?? [])) {
      doc.fontSize(tmpl.bodyFontSize).font(f(fonts, "serif")).fillColor("#1a1a1a").text(`• ${r}`, { lineGap: 3.5 });
    }
  }
}

// ─── EPUB Helpers ─────────────────────────────────────────────────────────────

// ─── (Legacy PDF generator removed — replaced by pdfkit above) ─────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _legacyGeneratePdfBuffer_unused(manifest: EbookManifest): Promise<Buffer> {
  // String split prevents webpack from statically tracing the dead import
  const _pkg = "@react-pdf" + "/renderer";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { Document, Page, Text, View, StyleSheet, renderToBuffer } = (
    await import(_pkg as any)
  ) as any;

  const styles = StyleSheet.create({
  page: {
    paddingTop: 72,
    paddingBottom: 72,
    paddingLeft: 72,
    paddingRight: 72,
    fontFamily: "Helvetica",
    fontSize: 11,
    lineHeight: 1.6,
    color: "#1a1a1a",
  },
  titlePage: {
    paddingTop: 120,
    paddingBottom: 120,
    paddingLeft: 72,
    paddingRight: 72,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  },
  bookTitle: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginBottom: 12,
    color: "#111",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    color: "#555",
    marginBottom: 32,
  },
  authorName: {
    fontSize: 13,
    fontFamily: "Helvetica",
    textAlign: "center",
    color: "#333",
  },
  chapterTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    color: "#111",
  },
  chapterNumber: {
    fontSize: 10,
    color: "#888",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  sectionHeading: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginTop: 16,
    marginBottom: 6,
    color: "#222",
  },
  body: {
    fontSize: 11,
    lineHeight: 1.7,
    marginBottom: 10,
    color: "#1a1a1a",
  },
  italic: {
    fontSize: 11,
    fontFamily: "Helvetica-Oblique",
    lineHeight: 1.7,
    marginBottom: 10,
    color: "#333",
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    marginVertical: 20,
  },
  takeawayItem: {
    fontSize: 10,
    marginBottom: 4,
    paddingLeft: 12,
    color: "#444",
  },
  sectionLabel: {
    fontSize: 9,
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 16,
  },
  });

  // ─── Components (defined after dynamic import so they close over Document/Page/etc.) ──

  function TitlePage({ manifest }: { manifest: EbookManifest }) {
  return (
    <Page style={styles.titlePage}>
      <Text style={styles.bookTitle}>{manifest.bookTitle}</Text>
      {manifest.subtitle ? (
        <Text style={styles.subtitle}>{manifest.subtitle}</Text>
      ) : null}
      <Text style={styles.authorName}>{manifest.authorName}</Text>
    </Page>
  );
}

function FrontMatterPage({ fm }: { fm: FrontBackMatter }) {
  return (
    <Page style={styles.page}>
      <Text style={styles.chapterTitle}>Preface</Text>
      <View style={styles.divider} />
      <Text style={styles.body}>{fm.preface}</Text>

      <Text style={{ ...styles.chapterTitle, marginTop: 24 }}>Introduction</Text>
      <View style={styles.divider} />
      <Text style={styles.body}>{fm.introduction}</Text>
    </Page>
  );
}

function ChapterPage({ chapter }: { chapter: ChapterDraft }) {
  return (
    <Page style={styles.page}>
      <Text style={styles.chapterNumber}>Chapter {chapter.number}</Text>
      <Text style={styles.chapterTitle}>{chapter.title}</Text>
      <View style={styles.divider} />

      {chapter.intro ? (
        <Text style={styles.italic}>{chapter.intro}</Text>
      ) : null}

      {chapter.sections.map((section) => (
        <View key={section.sectionNumber}>
          <Text style={styles.sectionHeading}>{section.heading}</Text>
          <Text style={styles.body}>{section.body}</Text>
        </View>
      ))}

      {chapter.conclusion ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.body}>{chapter.conclusion}</Text>
        </>
      ) : null}

      {(chapter.keyTakeaways ?? []).length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Key Takeaways</Text>
          {(chapter.keyTakeaways ?? []).map((t, i) => (
            <Text key={i} style={styles.takeawayItem}>• {t}</Text>
          ))}
        </>
      ) : null}

      {(chapter.reflectionQuestions ?? []).length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Reflection Questions</Text>
          {(chapter.reflectionQuestions ?? []).map((q, i) => (
            <Text key={i} style={styles.takeawayItem}>{i + 1}. {q}</Text>
          ))}
        </>
      ) : null}
    </Page>
  );
}

function BackMatterPage({ fm }: { fm: FrontBackMatter }) {
  return (
    <Page style={styles.page}>
      <Text style={styles.chapterTitle}>Conclusion</Text>
      <View style={styles.divider} />
      <Text style={styles.body}>{fm.conclusion}</Text>

      {fm.aboutAuthor ? (
        <>
          <Text style={{ ...styles.chapterTitle, marginTop: 24 }}>About the Author</Text>
          <View style={styles.divider} />
          <Text style={styles.body}>{fm.aboutAuthor}</Text>
        </>
      ) : null}

      {(fm.resourcesList ?? []).length > 0 ? (
        <>
          <Text style={{ ...styles.chapterTitle, marginTop: 24 }}>Resources</Text>
          <View style={styles.divider} />
          {(fm.resourcesList ?? []).map((r, i) => (
            <Text key={i} style={styles.takeawayItem}>• {r}</Text>
          ))}
        </>
      ) : null}
    </Page>
  );
}

function EbookPdfDocument({ manifest }: { manifest: EbookManifest }) {
  return (
    <Document
      title={manifest.bookTitle}
      author={manifest.authorName}
      subject={manifest.subtitle}
    >
      <TitlePage manifest={manifest} />
      <FrontMatterPage fm={manifest.frontMatter} />
      {manifest.chapters.map((chapter) => (
        <ChapterPage key={chapter.number} chapter={chapter} />
      ))}
      <BackMatterPage fm={manifest.frontMatter} />
    </Document>
  );
}

  // Legacy render (unused)
  return Buffer.alloc(0);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphsToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("\n");
}

function quoteParagraphsToHtml(text: string, quotes: Quote[], options?: { italicFirstParagraph?: boolean }): string {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return paragraphs.map((paragraph, index) => {
    const matchingQuote = findMatchingBlockQuote(paragraph, quotes);
    if (matchingQuote) {
      const reference = matchingQuote.reference
        ? `&mdash; ${escapeHtml(matchingQuote.reference)}${matchingQuote.translation ? ` (${escapeHtml(matchingQuote.translation)})` : ""}`
        : "";
      return `<blockquote class="scripture-block"><p>${escapeHtml(matchingQuote.text)}</p>${reference ? `<div class="scripture-ref">${reference}</div>` : ""}</blockquote>`;
    }
    const classes = ["book-paragraph"];
    if (index === 0) classes.push("no-indent");
    if (options?.italicFirstParagraph && index === 0) classes.push("chapter-intro");
    return `<p class="${classes.join(" ")}">${escapeHtml(paragraph)}</p>`;
  }).join("\n");
}

function frontMatterChapters(fm: FrontBackMatter, quotes: Quote[]): Array<{ title: string; content: string }> {
  const chapters = [
    {
      title: "Preface",
      content: quoteParagraphsToHtml(fm.preface, quotes),
    },
    {
      title: "Introduction",
      content: quoteParagraphsToHtml(fm.introduction, quotes),
    },
  ];
  return chapters;
}

function chapterToHtml(chapter: ChapterDraft, quotes: Quote[]): string {
  const parts: string[] = [];

  if (chapter.intro) {
    parts.push(quoteParagraphsToHtml(chapter.intro, quotes, { italicFirstParagraph: true }));
  }

  for (const section of chapter.sections) {
    parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    parts.push(quoteParagraphsToHtml(section.body ?? "", quotes));
  }

  if (chapter.conclusion) {
    parts.push("<hr />");
    parts.push(quoteParagraphsToHtml(chapter.conclusion, quotes));
  }

  if ((chapter.keyTakeaways ?? []).length > 0) {
    parts.push("<h3>Key Takeaways</h3><ul>");
    for (const t of (chapter.keyTakeaways ?? [])) {
      parts.push(`<li>${escapeHtml(t)}</li>`);
    }
    parts.push("</ul>");
  }

  if ((chapter.reflectionQuestions ?? []).length > 0) {
    parts.push("<h3>Reflection Questions</h3><ol>");
    for (const q of (chapter.reflectionQuestions ?? [])) {
      parts.push(`<li>${escapeHtml(q)}</li>`);
    }
    parts.push("</ol>");
  }

  return parts.join("\n");
}

function backMatterChapters(fm: FrontBackMatter, quotes: Quote[]): Array<{ title: string; content: string }> {
  const chapters: Array<{ title: string; content: string }> = [
    {
      title: "Conclusion",
      content: quoteParagraphsToHtml(fm.conclusion, quotes),
    },
  ];

  if (fm.aboutAuthor) {
    chapters.push({
      title: "About the Author",
      content: quoteParagraphsToHtml(fm.aboutAuthor, quotes),
    });
  }

  if ((fm.resourcesList ?? []).length > 0) {
    chapters.push({
      title: "Resources",
      content: `<ul>${(fm.resourcesList ?? []).map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`,
    });
  }

  return chapters;
}

const EPUB_CSS = `
body {
  font-family: Georgia, "Times New Roman", serif;
  color: #111111;
  line-height: 1.62;
  font-size: 1em;
  margin: 6% 8%;
  text-align: justify;
}
p.book-paragraph {
  margin: 0;
  text-indent: 1.35em;
}
p.book-paragraph.no-indent {
  text-indent: 0;
}
p.book-paragraph.chapter-intro {
  font-style: italic;
  color: #333333;
}
h2 {
  margin-top: 1.55em;
  margin-bottom: 0.55em;
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 1.1em;
  text-align: left;
}
h3 {
  margin-top: 1.25em;
  margin-bottom: 0.45em;
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 0.92em;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
hr {
  border: 0;
  border-top: 1px solid #d7d7d7;
  margin: 1.4em 0 1.1em;
}
ul, ol {
  margin: 0.35em 0 0.9em 1.2em;
  padding: 0;
}
li {
  margin: 0.2em 0;
}
blockquote.scripture-block {
  margin: 1.35em 1.75em;
  padding: 0;
  border: 0;
}
blockquote.scripture-block p {
  font-style: italic;
  font-size: 1.07em;
  line-height: 1.85;
  margin: 0;
  text-indent: 0;
}
.scripture-ref {
  margin-top: 0.45em;
  text-align: right;
  font-style: normal;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 0.01em;
}
`;

// ─── EPUB Generator ───────────────────────────────────────────────────────────

export async function generateEpubBuffer(manifest: EbookManifest): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const epub = (await import("epub-gen-memory") as any).default;

  const chapters = [
    ...frontMatterChapters(manifest.frontMatter, manifest.allQuotes ?? []),
    ...manifest.chapters.map((ch) => ({
      title: `Chapter ${ch.number}: ${ch.title}`,
      content: chapterToHtml(ch, manifest.allQuotes ?? []),
    })),
    ...backMatterChapters(manifest.frontMatter, manifest.allQuotes ?? []),
  ];

  const epubBuffer = await epub(
    {
      title: manifest.bookTitle,
      author: manifest.authorName,
      publisher: manifest.authorName,
      description: manifest.subtitle,
      date: new Date(manifest.generatedAt).getFullYear().toString(),
      lang: "en",
      tocTitle: "Table of Contents",
      css: EPUB_CSS,
    },
    chapters
  );

  return Buffer.from(epubBuffer);
}
