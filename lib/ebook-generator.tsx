/**
 * ebook-generator.tsx
 * Converts an EbookManifest into PDF and EPUB binary buffers.
 * PDF: pdfkit (pure JS, zero native dependencies — works on any server)
 * EPUB: epub-gen-memory
 */

import type { EbookManifest, ChapterDraft, FrontBackMatter, Quote } from "@/lib/schemas/ebook";
import type { PrintSpec } from "@/lib/schemas/ebook";
import { getTemplate } from "@/lib/book-templates";
import { TRIM_SIZE_SPECS } from "@/lib/book-templates";
import type { BookTemplateConfig } from "@/lib/book-templates";
import { existsSync } from "node:fs";
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  BorderStyle,
} from "docx";

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

// ─── Running Page Header/Footer ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writePageRunningHeader(
  doc: any,
  bookTitle: string,
  chapterTitle: string,
  bodyPageNumber: number,
  fonts: PdfFontSet,
) {
  const isEven = bodyPageNumber % 2 === 0;
  const pageW = doc.page.width;
  const mL = doc.page.margins.left;
  const mR = doc.page.margins.right;
  const savedY = doc.y;

  // Running head — book title on verso (even), chapter title on recto (odd)
  const headText = isEven ? bookTitle : (chapterTitle || bookTitle);
  doc
    .fontSize(7)
    .font(fonts.sans)
    .fillColor("#aaaaaa")
    .text(headText.toUpperCase(), mL, 28, { width: pageW - mL - mR, align: "center" });

  // Thin hairline rule below the running head
  doc
    .moveTo(mL, 41)
    .lineTo(pageW - mR, 41)
    .strokeColor("#e0e0e0")
    .lineWidth(0.25)
    .stroke();

  // Page number — centered at bottom, outside the content margin
  doc
    .fontSize(8)
    .font(fonts.serif)
    .fillColor("#888888")
    .text(String(bodyPageNumber), mL, doc.page.height - 40, { width: pageW - mL - mR, align: "center" });

  // Reset cursor to where the content area begins
  doc.y = savedY;
}

// ─── PDF Generator (pdfkit) ───────────────────────────────────────────────────

export async function generatePdfBuffer(manifest: EbookManifest, templateId?: string, printSpec?: PrintSpec): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PDFDocument = (await import("pdfkit")).default as any;
  const tpl = getTemplate(templateId ?? manifest.selectedTemplate);

  // ── Resolve print specifications ──────────────────────────────────────────
  const resolvedPrintSpec = printSpec ?? manifest.printSpec ?? { trimSize: "6x9" as const, runningHeaders: true };
  const trimSpec = TRIM_SIZE_SPECS[resolvedPrintSpec.trimSize ?? "6x9"];
  const showRunningHeaders = resolvedPrintSpec.runningHeaders !== false && tpl.runningHeaders;

  // Merge trim-size overrides on top of template defaults
  const pageSize = trimSpec.pageSize;
  const pageMargins = trimSpec.margins;
  const adjustedBodyFontSize = tpl.bodyFontSize + trimSpec.bodyFontSizeAdjust;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      margins: pageMargins,
      size: pageSize,
      autoFirstPage: true,
    });
    const fonts = resolvePdfFonts(doc);
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Running header state ──────────────────────────────────────────────────
    const headerCtx = {
      enabled: false,
      chapterTitle: "",
      pageOffset: 0,   // absolute pageNum when body chapters begin
      pageNum: 0,      // counts every page added (including front matter)
    };
    doc.on("pageAdded", () => {
      headerCtx.pageNum++;
      if (!showRunningHeaders || !headerCtx.enabled) return;
      const bodyPage = headerCtx.pageNum - headerCtx.pageOffset;
      writePageRunningHeader(doc, manifest.bookTitle, headerCtx.chapterTitle, bodyPage, fonts);
    });

    // ── Title page ────────────────────────────────────────────────────────────
    doc
      .moveDown(tpl.titlePageTopGap)
      .fontSize(tpl.titlePageTitleSize).font(fonts.serifBold).fillColor(tpl.chapterTitleColor)
      .text(manifest.bookTitle, { align: tpl.titlePageAlign });

    if (manifest.subtitle) {
      doc
        .moveDown(0.8)
        .fontSize(tpl.titlePageSubtitleSize).font(fonts.serif).fillColor(tpl.labelColor)
        .text(manifest.subtitle, { align: tpl.titlePageAlign });
    }

    doc
      .moveDown(2)
      .fontSize(tpl.titlePageAuthorSize).font(fonts.serif).fillColor(tpl.accentColor)
      .text(manifest.authorName, { align: tpl.titlePageAlign });

    writeFrontMatter(doc, manifest.frontMatter, manifest.allQuotes ?? [], fonts, tpl, adjustedBodyFontSize);

    // Enable running headers from first chapter page onward
    headerCtx.enabled = showRunningHeaders;
    headerCtx.pageOffset = headerCtx.pageNum; // front matter pages already counted

    for (const chapter of manifest.chapters) {
      headerCtx.chapterTitle = chapter.title; // set BEFORE addPage so pageAdded sees it
      writeChapter(doc, chapter, manifest.allQuotes ?? [], fonts, tpl, adjustedBodyFontSize);
    }

    writeBackMatter(doc, manifest.frontMatter, manifest.allQuotes ?? [], fonts, tpl, adjustedBodyFontSize);
    doc.end();
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeDivider(doc: any, tpl: BookTemplateConfig) {
  if (!tpl.showDivider) { doc.moveDown(0.5); return; }
  doc.moveDown(0.5);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor(tpl.dividerColor).lineWidth(0.5).stroke();
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
// Parse a markdown blockquote paragraph (lines starting with '> ') into
// a Quote-compatible object. Returns null if not a markdown blockquote.
function parseMarkdownBlockquote(paragraph: string): { text: string; reference?: string; translation?: string } | null {
  if (!paragraph.startsWith("> ") && !paragraph.startsWith(">")) return null;
  const lines = paragraph.split("\n").map((l) => l.replace(/^>\s?/, "").trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // Find reference line: last line starting with —, -, –, or *—
  const refPattern = /^[\u2014\-\u2013]|^\*[\u2014\-\u2013]/;
  let refLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (refPattern.test(lines[i].trim())) { refLineIdx = i; break; }
  }

  const verseLines = refLineIdx > 0 ? lines.slice(0, refLineIdx) : lines;
  const refRaw = refLineIdx >= 0 ? lines[refLineIdx] : "";
  const refClean = refRaw.replace(/^\*?[\u2014\-\u2013]\s*/, "").replace(/\*$/, "").trim();
  const transMatch = refClean.match(/^(.+?)\s*\(([^)]+)\)\s*$/);

  return {
    text: verseLines.join("\n"),
    reference: transMatch ? transMatch[1].trim() : (refClean || undefined),
    translation: transMatch ? transMatch[2].trim() : undefined,
  };
}

function writeScriptureBlock(doc: any, quote: { text: string; reference?: string; translation?: string }, fonts: PdfFontSet, tpl: BookTemplateConfig) {
  doc.moveDown(0.6);
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const barX = doc.page.margins.left + Math.round(tpl.scriptureIndent * 0.3);
  const textX = doc.page.margins.left + tpl.scriptureIndent;
  const textWidth = contentWidth - tpl.scriptureIndent - 8;
  const yStart = doc.y;

  // Write verse text line-by-line to preserve natural verse / stanza breaks
  const verseLines = quote.text.split(/\n/).filter((l) => l.trim().length > 0);
  verseLines.forEach((line, i) => {
    doc
      .fontSize(tpl.scriptureFontSize)
      .font(fonts.serifItalic)
      .fillColor("#1a1a1a")
      .text(line.trim(), textX, undefined, { width: textWidth, lineGap: 4, continued: false });
    if (i < verseLines.length - 1) doc.moveDown(0.08);
  });

  const yEnd = doc.y;
  // Draw left accent bar retroactively over the rendered verse range
  doc.save().rect(barX, yStart, 2.5, yEnd - yStart).fill(tpl.accentColor).restore();

  // Reference line: em-dash · reference · optional translation
  const reference = quote.reference
    ? `\u2014 ${quote.reference}${quote.translation ? ` (${quote.translation})` : ""}`
    : "";
  if (reference) {
    doc
      .moveDown(0.2)
      .fontSize(tpl.scriptureFontSize - 1.5)
      .font(fonts.serifBold)
      .fillColor(tpl.accentColor)
      .text(reference, { align: "right", width: contentWidth - 8 });
  }

  doc.moveDown(0.6);
}

/**
 * Normalize paragraph breaks in LLM-generated body text.
 *
 * Handles two structural artifacts only — the AI owns paragraph decisions:
 *   1. LLM outputs \n (single newline) inside JSON strings instead of \n\n —
 *      sentence-ending punctuation + \n + capital letter is expanded to \n\n.
 *   2. 3+ consecutive blank lines collapsed to 2.
 *
 * No mechanical word-count splitting is applied. The AI decides every break.
 */
function normalizeParagraphBreaks(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([.!?'"\u201d])\n(?!\n)(?=[A-Z\u201c])/g, "$1\n\n")
    .trim();
}
/**
 * Strip markdown syntax so PDFKit renders plain text instead of raw markers.
 *
 * - Heading lines (## / ###) are dropped entirely — the heading was already
 *   rendered above the body by writeChapter / writeFrontMatter.
 * - Horizontal rule lines are dropped.
 * - Bold (** / __) and italic (* / _) markers are removed, preserving the
 *   inner text so emphasis words still appear — just not surrounded by *.
 */
function stripMarkdownForPdf(paragraph: string): string {
  const trimmed = paragraph.trim();
  if (/^#{1,6}\s+/.test(trimmed)) return ""; // heading line — drop
  if (/^[-*_]{3,}\s*$/.test(trimmed)) return ""; // horizontal rule — drop
  return paragraph
    .replace(/\*\*\*(.+?)\*\*\*/gs, "$1")          // bold-italic
    .replace(/\*\*(.+?)\*\*/gs, "$1")              // bold
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "$1") // italic
    .replace(/__(.+?)__/gs, "$1")                  // bold underscore
    .replace(/(?<!_)_([^_\n]+?)_(?!_)/g, "$1")    // italic underscore
    .trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeRichBody(doc: any, text: string, quotes: Quote[], fonts: PdfFontSet, tpl: BookTemplateConfig, options?: { italicFirstParagraph?: boolean; noIndentFirstParagraph?: boolean }, bodyFontSize?: number) {
  const fontSize = bodyFontSize ?? tpl.bodyFontSize;
  const paragraphs = normalizeParagraphBreaks(text).split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  // Track rendered index separately so dropped heading lines don't shift the
  // firstParagraph italic treatment onto the wrong paragraph.
  let renderedIndex = 0;
  paragraphs.forEach((paragraph) => {
    // Detect AI-generated markdown blockquotes (> prefix) first
    const markdownQuote = parseMarkdownBlockquote(paragraph);
    if (markdownQuote) {
      writeScriptureBlock(doc, markdownQuote, fonts, tpl);
      renderedIndex++;
      return;
    }
    const matchingQuote = findMatchingBlockQuote(paragraph, quotes);
    if (matchingQuote) {
      writeScriptureBlock(doc, matchingQuote, fonts, tpl);
      renderedIndex++;
      return;
    }

    // Strip markdown syntax — heading lines return "" and are silently skipped
    const cleanParagraph = stripMarkdownForPdf(paragraph);
    if (!cleanParagraph) return;

    const font = options?.italicFirstParagraph && renderedIndex === 0 ? fonts.serifItalic : fonts.serif;
    const color = options?.italicFirstParagraph && renderedIndex === 0 ? "#333333" : "#1a1a1a";
    const noIndentFirst = options?.noIndentFirstParagraph !== false;
    const indent = noIndentFirst && renderedIndex === 0 ? 0 : tpl.paragraphIndent;
    doc
      .fontSize(fontSize)
      .font(font)
      .fillColor(color)
      .text(cleanParagraph, {
        lineGap: tpl.bodyLineGap,
        indent,
        paragraphGap: tpl.paragraphGap,
        align: tpl.bodyAlign,
      });
    renderedIndex++;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeFrontMatter(doc: any, fm: FrontBackMatter, quotes: Quote[], fonts: PdfFontSet, tpl: BookTemplateConfig, bodyFontSize?: number) {
  doc.addPage();
  doc.fontSize(tpl.matterTitleSize).font(fonts.serifBold).fillColor(tpl.chapterTitleColor).text("Preface", { align: tpl.matterTitleAlign });
  writeDivider(doc, tpl);
  writeRichBody(doc, fm.preface, quotes, fonts, tpl, { noIndentFirstParagraph: true }, bodyFontSize);

  doc.addPage();
  doc.fontSize(tpl.matterTitleSize).font(fonts.serifBold).fillColor(tpl.chapterTitleColor).text("Introduction", { align: tpl.matterTitleAlign });
  writeDivider(doc, tpl);
  writeRichBody(doc, fm.introduction, quotes, fonts, tpl, { noIndentFirstParagraph: true }, bodyFontSize);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeChapter(doc: any, chapter: ChapterDraft, quotes: Quote[], fonts: PdfFontSet, tpl: BookTemplateConfig, bodyFontSize?: number) {
  doc.addPage();
  doc.moveDown(tpl.chapterPreGap);
  doc.fontSize(tpl.chapterLabelSize).font(fonts[tpl.chapterLabelFont]).fillColor(tpl.chapterLabelColor)
    .text(tpl.chapterLabel(chapter.number), { align: tpl.chapterLabelAlign });
  doc.moveDown(0.3)
    .fontSize(tpl.chapterTitleSize).font(fonts[tpl.chapterTitleFont]).fillColor(tpl.chapterTitleColor)
    .text(chapter.title, { align: tpl.chapterTitleAlign });
  writeDivider(doc, tpl);

  if (chapter.intro) {
    writeRichBody(doc, chapter.intro, quotes, fonts, tpl, { italicFirstParagraph: true, noIndentFirstParagraph: true }, bodyFontSize);
  }

  for (const section of chapter.sections) {
    doc.moveDown(0.35);
    doc.fontSize(tpl.sectionSize).font(fonts[tpl.sectionFont]).fillColor(tpl.sectionColor)
      .text(section.heading, { align: tpl.sectionAlign });
    if (tpl.sectionRule) writeDivider(doc, tpl);
    doc.moveDown(0.5);
    writeRichBody(doc, section.body, quotes, fonts, tpl, { noIndentFirstParagraph: true }, bodyFontSize);
  }

  if (chapter.conclusion) {
    writeDivider(doc, tpl);
    writeRichBody(doc, chapter.conclusion, quotes, fonts, tpl, { noIndentFirstParagraph: true }, bodyFontSize);
  }

  if ((chapter.keyTakeaways ?? []).length > 0) {
    writeDivider(doc, tpl);
    doc.fontSize(tpl.sectionSize - 1).font(fonts[tpl.sectionFont]).fillColor(tpl.labelColor).text("KEY TAKEAWAYS");
    doc.moveDown(0.4);
    for (const t of (chapter.keyTakeaways ?? [])) {
      doc.fontSize(bodyFontSize ?? tpl.bodyFontSize).font(fonts.serif).fillColor("#222222").text(`• ${t}`, { lineGap: tpl.bodyLineGap, paragraphGap: 4 });
    }
    doc.moveDown(0.5);
  }

  if ((chapter.reflectionQuestions ?? []).length > 0) {
    writeDivider(doc, tpl);
    doc.fontSize(tpl.sectionSize - 1).font(fonts[tpl.sectionFont]).fillColor(tpl.labelColor).text("REFLECTION QUESTIONS");
    doc.moveDown(0.4);
    (chapter.reflectionQuestions ?? []).forEach((q, i) => {
      doc.fontSize(bodyFontSize ?? tpl.bodyFontSize).font(fonts.serif).fillColor("#222222").text(`${i + 1}. ${q}`, { lineGap: tpl.bodyLineGap, paragraphGap: 4 });
    });
    doc.moveDown(0.5);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeBackMatter(doc: any, fm: FrontBackMatter, quotes: Quote[], fonts: PdfFontSet, tpl: BookTemplateConfig, bodyFontSize?: number) {
  doc.addPage();
  doc.fontSize(tpl.matterTitleSize).font(fonts.serifBold).fillColor(tpl.chapterTitleColor).text("Conclusion", { align: tpl.matterTitleAlign });
  writeDivider(doc, tpl);
  writeRichBody(doc, fm.conclusion, quotes, fonts, tpl, { noIndentFirstParagraph: true }, bodyFontSize);

  if (fm.aboutAuthor) {
    doc.addPage();
    doc.fontSize(tpl.matterTitleSize).font(fonts.serifBold).fillColor(tpl.chapterTitleColor).text("About the Author", { align: tpl.matterTitleAlign });
    writeDivider(doc, tpl);
    writeRichBody(doc, fm.aboutAuthor, quotes, fonts, tpl, { noIndentFirstParagraph: true }, bodyFontSize);
  }

  if ((fm.resourcesList ?? []).length > 0) {
    doc.addPage();
    doc.fontSize(tpl.matterTitleSize).font(fonts.serifBold).fillColor(tpl.chapterTitleColor).text("Resources", { align: tpl.matterTitleAlign });
    writeDivider(doc, tpl);
    for (const r of (fm.resourcesList ?? [])) {
      doc.fontSize(bodyFontSize ?? tpl.bodyFontSize).font(fonts.serif).fillColor("#1a1a1a").text(`• ${r}`, { lineGap: 3.5 });
    }
  }
}

// ─── EPUB Helpers ─────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Escapes HTML special characters in a string that already contains safe
 * <em> / <strong> / <br> tags injected by our own markdown converter.
 * Those tags are preserved; only the text nodes between them are escaped.
 */
function escapeHtmlPreservingEmStrong(str: string): string {
  // Split on the tags we intentionally injected, escape text segments, rejoin.
  return str
    .split(/(<\/?(?:em|strong|br)>)/g)
    .map((part, i) => (i % 2 === 0 ? escapeHtml(part) : part))
    .join("");
}

function paragraphsToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("\n");
}

// Wraps inline scripture citations — `"text" (Book Chapter:Verse, Trans.)` —
// with a <span> for premium italic styling without disrupting paragraph flow.
function markupInlineScripture(html: string): string {
  // Match: opening quote, text, closing quote, optional spaces, parenthetical reference
  // e.g. "For God so loved the world" (John 3:16, NIV)
  return html.replace(
    /(&ldquo;|&quot;|\u201c)([^\u201d&]{10,})(&rdquo;|&quot;|\u201d)\s*(\([A-Z][^)]{3,}\d+[^)]*\))/g,
    (_, oq, text, cq, ref) =>
      `<span class="scripture-inline">${oq}${text}${cq}</span><span class="scripture-inline-ref"> ${ref}</span>`,
  );
}

function quoteParagraphsToHtml(text: string, quotes: Quote[], options?: { italicFirstParagraph?: boolean }): string {
  const paragraphs = normalizeParagraphBreaks(text).split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  let renderedIndex = 0;
  return paragraphs.map((paragraph) => {
    // Detect AI-generated markdown blockquotes (> prefix) first — these are the most
    // reliable because they come directly from the model output.
    const markdownQuote = parseMarkdownBlockquote(paragraph);
    if (markdownQuote) {
      const verseLines = markdownQuote.text.split(/\n/).filter((l) => l.trim());
      const verseHtml = verseLines.map((l) => `<span class="verse-line">${escapeHtml(l.trim())}</span>`).join("\n");
      const refText = markdownQuote.reference
        ? `&mdash; ${escapeHtml(markdownQuote.reference)}${markdownQuote.translation ? ` <span class="scripture-translation">(${escapeHtml(markdownQuote.translation)})</span>` : ""}`
        : "";
      renderedIndex++;
      return `<blockquote class="scripture-block"><div class="scripture-verse">${verseHtml}</div>${refText ? `<div class="scripture-ref">${refText}</div>` : ""}</blockquote>`;
    }
    const matchingQuote = findMatchingBlockQuote(paragraph, quotes);
    if (matchingQuote) {
      const verseLines = matchingQuote.text.split(/\n/).filter((l) => l.trim());
      const verseHtml = verseLines.map((l) => `<span class="verse-line">${escapeHtml(l.trim())}</span>`).join("\n");
      const refText = matchingQuote.reference
        ? `&mdash; ${escapeHtml(matchingQuote.reference)}${matchingQuote.translation ? ` <span class="scripture-translation">(${escapeHtml(matchingQuote.translation)})</span>` : ""}`
        : "";
      renderedIndex++;
      return `<blockquote class="scripture-block"><div class="scripture-verse">${verseHtml}</div>${refText ? `<div class="scripture-ref">${refText}</div>` : ""}</blockquote>`;
    }

    // Drop markdown heading lines — they duplicate the section heading already
    // rendered by the EPUB chapter structure above the body.
    if (/^#{1,6}\s+/.test(paragraph)) return "";
    // Drop bare horizontal rules
    if (/^[-*_]{3,}\s*$/.test(paragraph)) return "";

    // Convert inline markdown to HTML tags so *word* renders as <em>word</em>
    // instead of appearing with literal asterisks in the EPUB reader.
    // Apply BEFORE escapeHtml because escapeHtml doesn’t touch * characters,
    // so the order is: markdown→HTML tags, then escapeHtml for the text content.
    const withHtmlMarkup = paragraph
      .replace(/\*\*\*(.+?)\*\*\*/gs, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "<em>$1</em>")
      .replace(/__(.+?)__/gs, "<strong>$1</strong>")
      .replace(/(?<!_)_([^_\n]+?)_(?!_)/g, "<em>$1</em>");

    const classes = ["book-paragraph"];
    if (renderedIndex === 0) classes.push("no-indent");
    if (options?.italicFirstParagraph && renderedIndex === 0) classes.push("chapter-intro");
    // markupInlineScripture + escapeHtml work on the tag-converted string.
    // Text nodes inside our injected tags were not yet escaped, so run a targeted
    // escape that preserves the <em>/<strong> wrapper tags we just added.
    const escapedPara = markupInlineScripture(escapeHtmlPreservingEmStrong(withHtmlMarkup));
    renderedIndex++;
    return `<p class="${classes.join(" ")}">${escapedPara}</p>`;
  }).filter(Boolean).join("\n");
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

function buildEpubCss(tpl: BookTemplateConfig): string {
  const bodyAlign = tpl.bodyAlign === "justify" ? "justify" : "left";
  const indent = tpl.paragraphIndent > 0 ? `${(tpl.paragraphIndent / 12).toFixed(2)}em` : "0";
  const paraGap = tpl.paragraphGap > 0 ? `${(tpl.paragraphGap / 12).toFixed(2)}em` : "0";
  const sectionAlign = tpl.sectionAlign === "center" ? "center" : tpl.sectionAlign === "right" ? "right" : "left";
  const chapterAlign = tpl.chapterTitleAlign === "center" ? "center" : tpl.chapterTitleAlign === "right" ? "right" : "left";
  const hrColor = tpl.showDivider ? tpl.dividerColor : "transparent";
  const accentHex = tpl.chapterLabelColor;
  return `
body {
  font-family: Georgia, "Times New Roman", serif;
  color: #111111;
  line-height: ${(tpl.bodyLineGap / tpl.bodyFontSize + 1).toFixed(2)};
  font-size: 1em;
  margin: 6% 8%;
  text-align: ${bodyAlign};
  hyphens: auto;
  -webkit-hyphens: auto;
  adobe-hyphenate: auto;
}
p.book-paragraph {
  margin: 0 0 ${paraGap} 0;
  text-indent: ${indent};
  widows: 2;
  orphans: 2;
}
p.book-paragraph.no-indent {
  text-indent: 0;
}
p.book-paragraph.chapter-intro {
  font-style: italic;
  color: #333333;
}
h1.chapter-title {
  text-align: ${chapterAlign};
  color: ${tpl.chapterTitleColor};
  font-size: 1.7em;
  margin-top: 0.5em;
  margin-bottom: 0.6em;
}
.chapter-label {
  display: block;
  text-align: ${chapterAlign};
  color: ${accentHex};
  font-size: 0.75em;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 0.25em;
}
h2 {
  margin-top: 2em;
  margin-bottom: 0.65em;
  font-size: 1.1em;
  text-align: ${sectionAlign};
  color: ${tpl.sectionColor};
  page-break-after: avoid;
  break-after: avoid;
}
h3 {
  margin-top: 1.25em;
  margin-bottom: 0.45em;
  font-size: 0.92em;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
hr {
  border: 0;
  border-top: 1px solid ${hrColor};
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
  margin: 2em 0.25em 2em ${(tpl.scriptureIndent / 12).toFixed(2)}em;
  padding: 0.85em 0.5em 0.85em 1.4em;
  border: 0;
  border-left: 4px solid ${accentHex};
  background: transparent;
  page-break-inside: avoid;
}
.scripture-verse {
  display: block;
  font-style: italic;
  font-size: ${(tpl.scriptureFontSize / tpl.bodyFontSize).toFixed(2)}em;
  line-height: 1.55;
  margin: 0;
  color: #1a1a1a;
  text-indent: 0;
}
.verse-line {
  display: block;
  margin-bottom: 0.15em;
}
.scripture-ref {
  display: block;
  margin-top: 0.65em;
  text-align: right;
  font-weight: 700;
  font-size: 0.8em;
  font-style: normal;
  color: ${accentHex};
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.scripture-translation {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  font-style: italic;
}
.scripture-inline {
  font-style: italic;
  color: #1a1a1a;
}
.scripture-inline-ref {
  font-weight: 600;
  font-size: 0.88em;
  color: ${accentHex};
  font-style: normal;
}
`;
}

// ─── EPUB Generator ───────────────────────────────────────────────────────────

export async function generateEpubBuffer(manifest: EbookManifest, templateId?: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const epub = (await import("epub-gen-memory") as any).default;
  const tpl = getTemplate(templateId ?? manifest.selectedTemplate);

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
      css: buildEpubCss(tpl),
    },
    chapters
  );

  return Buffer.from(epubBuffer);
}

// ─── DOCX generation ─────────────────────────────────────────────────────────

export async function generateDocxBuffer(manifest: EbookManifest, templateId?: string): Promise<Buffer> {
  const { bookTitle, subtitle, authorName, frontMatter, chapters } = manifest;
  const tpl = getTemplate(templateId ?? manifest.selectedTemplate);

  // Map template body alignment to DOCX AlignmentType
  const bodyAlign = tpl.bodyAlign === "justify" ? AlignmentType.JUSTIFIED : AlignmentType.LEFT;
  const titleAlign = tpl.titlePageAlign === "center" ? AlignmentType.CENTER
    : tpl.titlePageAlign === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT;
  // Body font size in half-points (docx unit): bodyFontSize pt × 2
  const bodyHalfPt = Math.round(tpl.bodyFontSize * 2);
  // Paragraph spacing after (twips): paragraphGap pt × 20
  const paraSpacingAfter = Math.round(tpl.paragraphGap * 20);
  // Paragraph indent (twips): paragraphIndent pt × 20
  const paraIndentTwips = Math.round(tpl.paragraphIndent * 20);

  // Half-point size for scripture (typically 1pt smaller)
  const scriptureHalfPt = Math.round((tpl.bodyFontSize - 0.5) * 2);
  const scriptureRefHalfPt = Math.round((tpl.bodyFontSize - 2) * 2);
  const accentRgb = tpl.accentColor.replace("#", "");
  const scriptureIndentTwips = Math.round(tpl.scriptureIndent * 20);

  function docxScriptureBlock(quote: { text: string; reference?: string; translation?: string }): Paragraph[] {
    const verseLines = quote.text.split(/\n/).filter((l) => l.trim().length > 0);
    const verseParagraphs = verseLines.map((line) =>
      new Paragraph({
        children: [new TextRun({ text: line.trim(), italics: true, size: scriptureHalfPt })],
        alignment: bodyAlign,
        spacing: { before: 40, after: 40 },
        indent: { left: scriptureIndentTwips },
        border: { left: { style: BorderStyle.THICK, size: 12, color: accentRgb, space: 8 } },
      })
    );
    const refParagraphs: Paragraph[] = [];
    if (quote.reference) {
      const refText = `\u2014 ${quote.reference}${quote.translation ? ` (${quote.translation})` : ""}`;
      refParagraphs.push(
        new Paragraph({
          children: [new TextRun({ text: refText, bold: true, size: scriptureRefHalfPt, color: accentRgb })],
          alignment: AlignmentType.RIGHT,
          spacing: { before: 60, after: 200 },
        })
      );
    }
    return [...verseParagraphs, ...refParagraphs];
  }

  /**
   * Parses inline markdown in a paragraph into an array of TextRun objects with
   * proper bold/italic formatting so Word renders them correctly.
   * Handles ***bold-italic***, **bold**, *italic*, __bold__, _italic_.
   */
  function parseRunsForDocx(text: string, baseSize: number): TextRun[] {
    const runs: TextRun[] = [];
    const pattern = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|(?<!\*)\*([^*\n]+?)\*(?!\*)|__(.+?)__|(?<!_)_([^_\n]+?)_(?!_))/gs;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        runs.push(new TextRun({ text: text.slice(lastIndex, match.index), size: baseSize }));
      }
      if (match[2])      runs.push(new TextRun({ text: match[2], bold: true, italics: true, size: baseSize }));
      else if (match[3]) runs.push(new TextRun({ text: match[3], bold: true,               size: baseSize }));
      else if (match[4]) runs.push(new TextRun({ text: match[4],              italics: true, size: baseSize }));
      else if (match[5]) runs.push(new TextRun({ text: match[5], bold: true,               size: baseSize }));
      else if (match[6]) runs.push(new TextRun({ text: match[6],              italics: true, size: baseSize }));
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      runs.push(new TextRun({ text: text.slice(lastIndex), size: baseSize }));
    }
    return runs.length > 0 ? runs : [new TextRun({ text, size: baseSize })];
  }

  function textToStyledParagraphs(text: string, noIndentFirst = false): Paragraph[] {
    return normalizeParagraphBreaks(text)
      .split(/\n{2,}/)
      .map((para) => para.trim())
      .filter(Boolean)
      .flatMap((para, i) => {
        // Drop heading lines — the section heading is already rendered above the body
        if (/^#{1,6}\s+/.test(para)) return [];
        // Drop horizontal rules
        if (/^[-*_]{3,}\s*$/.test(para)) return [];
        // Detect markdown blockquote for scripture
        const mdQuote = parseMarkdownBlockquote(para);
        if (mdQuote) return docxScriptureBlock(mdQuote);
        return [
          new Paragraph({
            children: parseRunsForDocx(para, bodyHalfPt),
            alignment: bodyAlign,
            spacing: { after: paraSpacingAfter },
            indent: noIndentFirst && i === 0 ? undefined : { firstLine: paraIndentTwips },
          }),
        ];
      });
  }

  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: bookTitle, bold: true, size: Math.round(tpl.titlePageTitleSize * 2) })],
      heading: HeadingLevel.TITLE,
      alignment: titleAlign,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: subtitle, size: Math.round(tpl.titlePageSubtitleSize * 2), italics: true })],
      alignment: titleAlign,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: authorName, size: Math.round(tpl.titlePageAuthorSize * 2) })],
      alignment: titleAlign,
      spacing: { after: 600 },
    }),
    new Paragraph({ children: [new PageBreak()] })
  );

  for (const { title, text } of [
    { title: "Preface", text: frontMatter.preface },
    { title: "Introduction", text: frontMatter.introduction },
    ...(frontMatter.dedication ? [{ title: "Dedication", text: frontMatter.dedication }] : []),
  ]) {
    if (!text?.trim()) continue;
    children.push(
      new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 240 } }),
      ...textToStyledParagraphs(text, true),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  for (const chapter of chapters) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: tpl.chapterLabel(chapter.number), size: Math.round(tpl.chapterLabelSize * 2), color: tpl.chapterLabelColor.replace("#", "") })],
        alignment: titleAlign,
        spacing: { before: 400, after: 80 },
      }),
      new Paragraph({
        children: [new TextRun({ text: chapter.title, bold: true, size: Math.round(tpl.chapterTitleSize * 2), color: tpl.chapterTitleColor.replace("#", "") })],
        heading: HeadingLevel.HEADING_1,
        alignment: titleAlign,
        spacing: { before: 0, after: 300 },
      })
    );
    // Chapter intro — italic opening paragraph, matches PDF/EPUB rendering
    if (chapter.intro?.trim()) {
      normalizeParagraphBreaks(chapter.intro)
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .forEach((introPara) => {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: introPara, italics: true, size: bodyHalfPt })],
              alignment: bodyAlign,
              spacing: { after: paraSpacingAfter },
            })
          );
        });
    }
    for (const section of chapter.sections) {
      if (section.heading) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: section.heading, bold: tpl.sectionFont.includes("Bold") || tpl.sectionFont === "serifBold" || tpl.sectionFont === "sansBold", size: Math.round(tpl.sectionSize * 2), color: tpl.sectionColor.replace("#", "") })],
            heading: HeadingLevel.HEADING_2,
            alignment: tpl.sectionAlign === "center" ? AlignmentType.CENTER : tpl.sectionAlign === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
            spacing: { before: 280, after: 160 },
          })
        );
      }
      children.push(...textToStyledParagraphs(section.body, true));
    }

    // Chapter conclusion
    if (chapter.conclusion?.trim()) {
      children.push(...textToStyledParagraphs(chapter.conclusion, true));
    }

    // Key Takeaways
    if ((chapter.keyTakeaways ?? []).length > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "KEY TAKEAWAYS", bold: true, size: Math.round(tpl.bodyFontSize * 1.6), color: tpl.labelColor.replace("#", "") })],
          spacing: { before: 280, after: 120 },
        })
      );
      for (const t of (chapter.keyTakeaways ?? [])) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `• ${t}`, size: bodyHalfPt })],
            alignment: bodyAlign,
            spacing: { after: Math.round(paraSpacingAfter * 0.6) },
          })
        );
      }
    }

    // Reflection Questions
    if ((chapter.reflectionQuestions ?? []).length > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "REFLECTION QUESTIONS", bold: true, size: Math.round(tpl.bodyFontSize * 1.6), color: tpl.labelColor.replace("#", "") })],
          spacing: { before: 280, after: 120 },
        })
      );
      (chapter.reflectionQuestions ?? []).forEach((q, i) => {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `${i + 1}. ${q}`, size: bodyHalfPt })],
            alignment: bodyAlign,
            spacing: { after: Math.round(paraSpacingAfter * 0.6) },
          })
        );
      });
    }

    // Page break after all chapter content (before next chapter or back matter)
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  if (frontMatter.conclusion?.trim()) {
    children.push(
      new Paragraph({ text: "Conclusion", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 240 } }),
      ...textToStyledParagraphs(frontMatter.conclusion, true),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  if (frontMatter.aboutAuthor?.trim()) {
    children.push(
      new Paragraph({ text: "About the Author", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 240 } }),
      ...textToStyledParagraphs(frontMatter.aboutAuthor, true),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  if ((frontMatter.resourcesList ?? []).length > 0) {
    children.push(
      new Paragraph({ text: "Resources", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 240 } })
    );
    for (const r of (frontMatter.resourcesList ?? [])) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${r}`, size: bodyHalfPt })],
          alignment: bodyAlign,
          spacing: { after: Math.round(paraSpacingAfter * 0.6) },
        })
      );
    }
  }

  const doc = new DocxDocument({
    sections: [{ children }],
    styles: { default: { document: { run: { size: bodyHalfPt } } } },
  });

  return Packer.toBuffer(doc);
}
