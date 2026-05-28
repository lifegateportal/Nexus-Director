import { NextRequest, NextResponse } from "next/server";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import { EbookManifestSchema } from "@/lib/schemas/ebook";
import {
  PublishedBookEntrySchema,
  PublishedCatalogSchema,
  CoverAccentSchema,
} from "@/lib/schemas/published-book";
import type { PublishedCatalog } from "@/lib/schemas/published-book";
import { z } from "zod";

export const runtime    = "nodejs";
export const maxDuration = 30;

const PublishRequestSchema = z.object({
  manifest:    EbookManifestSchema,
  coverAccent: CoverAccentSchema.default("amber"),
});

function slugify(title: string, jobId: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const suffix = jobId.replace(/[^a-z0-9]/gi, "").slice(-6);
  return `${base}-${suffix}`;
}

function buildSynopsis(manifest: z.infer<typeof EbookManifestSchema>): string {
  const candidates = [
    manifest.frontMatter.introduction,
    manifest.frontMatter.preface,
  ];
  for (const text of candidates) {
    if (text && text.length > 60) {
      const clean = text.replace(/#{1,3} /g, "").replace(/\*\*/g, "").trim();
      return clean.slice(0, 340).trimEnd() + (clean.length > 340 ? "…" : "");
    }
  }
  return `${manifest.bookTitle} by ${manifest.authorName}. ${manifest.chapters.length} chapters, ${manifest.totalWordCount.toLocaleString()} words.`;
}

function makeS3Client(accountId: string, accessKey: string, secretKey: string) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = PublishRequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid input" },
      { status: 400 },
    );
  }

  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
    R2_PUBLIC_URL,
  } = env;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return NextResponse.json(
      { error: "R2 storage must be configured to publish books. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME." },
      { status: 503 },
    );
  }

  const { manifest, coverAccent } = input;
  const slug = slugify(manifest.bookTitle, manifest.jobId);
  const s3   = makeS3Client(R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY);

  try {
    // 1. Write the full manifest to R2
    await s3.send(
      new PutObjectCommand({
        Bucket:       R2_BUCKET_NAME,
        Key:          `published/${slug}/manifest.json`,
        Body:         JSON.stringify(manifest),
        ContentType:  "application/json",
        CacheControl: "public, max-age=60",
      }),
    );

    // 2. Build catalog entry
    const now   = new Date().toISOString();
    const entry = PublishedBookEntrySchema.parse({
      slug,
      title:        manifest.bookTitle,
      subtitle:     manifest.subtitle,
      authorName:   manifest.authorName,
      publishedAt:  now,
      updatedAt:    now,
      wordCount:    manifest.totalWordCount,
      chapterCount: manifest.chapters.length,
      synopsis:     buildSynopsis(manifest),
      coverAccent,
      template:     manifest.selectedTemplate,
    });

    // 3. Read existing catalog (best-effort — index may not yet exist)
    let catalog: PublishedCatalog = { updatedAt: now, books: [] };
    try {
      const existing = await s3.send(
        new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: "published/index.json" }),
      );
      const raw = await existing.Body?.transformToString();
      if (raw) {
        const parsed = PublishedCatalogSchema.safeParse(JSON.parse(raw));
        if (parsed.success) catalog = parsed.data;
      }
    } catch {
      // Index not yet created — start fresh
    }

    // 4. Upsert (remove old entry for this slug, prepend new one)
    catalog.books   = catalog.books.filter((b) => b.slug !== slug);
    catalog.books.unshift(entry);
    catalog.updatedAt = now;

    // 5. Write updated catalog
    await s3.send(
      new PutObjectCommand({
        Bucket:       R2_BUCKET_NAME,
        Key:          "published/index.json",
        Body:         JSON.stringify(catalog),
        ContentType:  "application/json",
        CacheControl: "public, max-age=30",
      }),
    );

    const publicUrl = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL.replace(/\/$/, "")}/published/${slug}/manifest.json`
      : null;

    return NextResponse.json({ slug, publicUrl }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
