/**
 * ebook-generator.tsx
 * Converts an EbookManifest into PDF and EPUB binary buffers.
 * PDF: pdfkit (pure JS, zero native dependencies — works on any server)
 * EPUB: epub-gen-memory
 */

import type { EbookManifest, ChapterDraft, FrontBackMatter } from "@/lib/schemas/ebook";

// ─── PDF Generator (pdfkit) ───────────────────────────────────────────────────

export async function generatePdfBuffer(manifest: EbookManifest): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PDFDocument = (await import("pdfkit")).default as any;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72, size: "A4", autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Title page ────────────────────────────────────────────────────────────
    doc
      .moveDown(6)
      .fontSize(28).font("Helvetica-Bold").fillColor("#111111")
      .text(manifest.bookTitle, { align: "center" });

    if (manifest.subtitle) {
      doc
        .moveDown(0.8)
        .fontSize(14).font("Helvetica").fillColor("#555555")
        .text(manifest.subtitle, { align: "center" });
    }

    doc
      .moveDown(2)
      .fontSize(13).font("Helvetica").fillColor("#333333")
      .text(manifest.authorName, { align: "center" });

    writeFrontMatter(doc, manifest.frontMatter);

    for (const chapter of manifest.chapters) {
      writeChapter(doc, chapter);
    }

    writeBackMatter(doc, manifest.frontMatter);
    doc.end();
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeDivider(doc: any) {
  doc.moveDown(0.5);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor("#e0e0e0").lineWidth(0.5).stroke();
  doc.moveDown(0.5);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeFrontMatter(doc: any, fm: FrontBackMatter) {
  doc.addPage();
  doc.fontSize(20).font("Helvetica-Bold").fillColor("#111111").text("Preface");
  writeDivider(doc);
  doc.fontSize(11).font("Helvetica").fillColor("#1a1a1a").text(fm.preface, { lineGap: 4 });

  doc.addPage();
  doc.fontSize(20).font("Helvetica-Bold").fillColor("#111111").text("Introduction");
  writeDivider(doc);
  doc.fontSize(11).font("Helvetica").fillColor("#1a1a1a").text(fm.introduction, { lineGap: 4 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeChapter(doc: any, chapter: ChapterDraft) {
  doc.addPage();
  doc.fontSize(10).font("Helvetica").fillColor("#888888").text(`CHAPTER ${chapter.number}`);
  doc.moveDown(0.3).fontSize(22).font("Helvetica-Bold").fillColor("#111111").text(chapter.title);
  writeDivider(doc);

  if (chapter.intro) {
    doc.fontSize(11).font("Helvetica-Oblique").fillColor("#333333").text(chapter.intro, { lineGap: 4 });
    doc.moveDown();
  }

  for (const section of chapter.sections) {
    doc.fontSize(13).font("Helvetica-Bold").fillColor("#222222").text(section.heading);
    doc.moveDown(0.4).fontSize(11).font("Helvetica").fillColor("#1a1a1a").text(section.body, { lineGap: 4 });
    doc.moveDown();
  }

  if (chapter.conclusion) {
    writeDivider(doc);
    doc.fontSize(11).font("Helvetica").fillColor("#1a1a1a").text(chapter.conclusion, { lineGap: 4 });
    doc.moveDown();
  }

  if (chapter.keyTakeaways.length > 0) {
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#888888").text("KEY TAKEAWAYS");
    doc.moveDown(0.3);
    for (const t of chapter.keyTakeaways) {
      doc.fontSize(10).font("Helvetica").fillColor("#222222").text(`• ${t}`, { lineGap: 3 });
    }
    doc.moveDown();
  }

  if (chapter.reflectionQuestions.length > 0) {
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#888888").text("REFLECTION QUESTIONS");
    doc.moveDown(0.3);
    chapter.reflectionQuestions.forEach((q, i) => {
      doc.fontSize(10).font("Helvetica").fillColor("#222222").text(`${i + 1}. ${q}`, { lineGap: 3 });
    });
    doc.moveDown();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeBackMatter(doc: any, fm: FrontBackMatter) {
  doc.addPage();
  doc.fontSize(20).font("Helvetica-Bold").fillColor("#111111").text("Conclusion");
  writeDivider(doc);
  doc.fontSize(11).font("Helvetica").fillColor("#1a1a1a").text(fm.conclusion, { lineGap: 4 });

  if (fm.aboutAuthor) {
    doc.addPage();
    doc.fontSize(20).font("Helvetica-Bold").fillColor("#111111").text("About the Author");
    writeDivider(doc);
    doc.fontSize(11).font("Helvetica").fillColor("#1a1a1a").text(fm.aboutAuthor, { lineGap: 4 });
  }

  if (fm.resourcesList.length > 0) {
    doc.addPage();
    doc.fontSize(20).font("Helvetica-Bold").fillColor("#111111").text("Resources");
    writeDivider(doc);
    for (const r of fm.resourcesList) {
      doc.fontSize(11).font("Helvetica").fillColor("#1a1a1a").text(`• ${r}`, { lineGap: 3 });
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

      {chapter.keyTakeaways.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Key Takeaways</Text>
          {chapter.keyTakeaways.map((t, i) => (
            <Text key={i} style={styles.takeawayItem}>• {t}</Text>
          ))}
        </>
      ) : null}

      {chapter.reflectionQuestions.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Reflection Questions</Text>
          {chapter.reflectionQuestions.map((q, i) => (
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

      {fm.resourcesList.length > 0 ? (
        <>
          <Text style={{ ...styles.chapterTitle, marginTop: 24 }}>Resources</Text>
          <View style={styles.divider} />
          {fm.resourcesList.map((r, i) => (
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

function frontMatterChapters(fm: FrontBackMatter): Array<{ title: string; data: string }> {
  const chapters = [
    {
      title: "Preface",
      data: paragraphsToHtml(fm.preface),
    },
    {
      title: "Introduction",
      data: paragraphsToHtml(fm.introduction),
    },
  ];
  return chapters;
}

function chapterToHtml(chapter: ChapterDraft): string {
  const parts: string[] = [];

  if (chapter.intro) {
    parts.push(`<p><em>${escapeHtml(chapter.intro)}</em></p>`);
  }

  for (const section of chapter.sections) {
    parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    parts.push(paragraphsToHtml(section.body));
  }

  if (chapter.conclusion) {
    parts.push("<hr />");
    parts.push(paragraphsToHtml(chapter.conclusion));
  }

  if (chapter.keyTakeaways.length > 0) {
    parts.push("<h3>Key Takeaways</h3><ul>");
    for (const t of chapter.keyTakeaways) {
      parts.push(`<li>${escapeHtml(t)}</li>`);
    }
    parts.push("</ul>");
  }

  if (chapter.reflectionQuestions.length > 0) {
    parts.push("<h3>Reflection Questions</h3><ol>");
    for (const q of chapter.reflectionQuestions) {
      parts.push(`<li>${escapeHtml(q)}</li>`);
    }
    parts.push("</ol>");
  }

  return parts.join("\n");
}

function backMatterChapters(fm: FrontBackMatter): Array<{ title: string; data: string }> {
  const chapters: Array<{ title: string; data: string }> = [
    {
      title: "Conclusion",
      data: paragraphsToHtml(fm.conclusion),
    },
  ];

  if (fm.aboutAuthor) {
    chapters.push({
      title: "About the Author",
      data: paragraphsToHtml(fm.aboutAuthor),
    });
  }

  if (fm.resourcesList.length > 0) {
    chapters.push({
      title: "Resources",
      data: `<ul>${fm.resourcesList.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`,
    });
  }

  return chapters;
}

// ─── EPUB Generator ───────────────────────────────────────────────────────────

export async function generateEpubBuffer(manifest: EbookManifest): Promise<Buffer> {
  // Dynamic import to avoid issues with the CJS module at build time
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const EPub = (await import("epub-gen-memory") as any).default;

  const content = [
    ...frontMatterChapters(manifest.frontMatter),
    ...manifest.chapters.map((ch) => ({
      title: `Chapter ${ch.number}: ${ch.title}`,
      data: chapterToHtml(ch),
    })),
    ...backMatterChapters(manifest.frontMatter),
  ];

  const epubBuffer = await new EPub(
    {
      title: manifest.bookTitle,
      author: manifest.authorName,
      publisher: manifest.authorName,
      description: manifest.subtitle,
      date: new Date(manifest.generatedAt).getFullYear().toString(),
      lang: "en",
      tocTitle: "Table of Contents",
    },
    content
  ).genEpub();

  return Buffer.from(epubBuffer);
}
