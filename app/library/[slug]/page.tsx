import Link from "next/link";
import { notFound } from "next/navigation";
import { EbookManifestSchema } from "@/lib/schemas/ebook";
import { PublishedCatalogSchema } from "@/lib/schemas/published-book";

export const revalidate = 60;

const ACCENT_HERO: Record<string, string> = {
  amber:   "from-amber-950/80 via-slate-950/50 to-slate-950",
  cyan:    "from-cyan-950/80 via-slate-950/50 to-slate-950",
  emerald: "from-emerald-950/80 via-slate-950/50 to-slate-950",
  rose:    "from-rose-950/80 via-slate-950/50 to-slate-950",
  violet:  "from-violet-950/80 via-slate-950/50 to-slate-950",
  slate:   "from-slate-800/80 via-slate-950/50 to-slate-950",
};

const ACCENT_TEXT: Record<string, string> = {
  amber: "text-amber-400", cyan: "text-cyan-400", emerald: "text-emerald-400",
  rose: "text-rose-400",   violet: "text-violet-400", slate: "text-slate-400",
};

const ACCENT_BG: Record<string, string> = {
  amber: "bg-amber-500 hover:bg-amber-400",
  cyan: "bg-cyan-500 hover:bg-cyan-400",
  emerald: "bg-emerald-500 hover:bg-emerald-400",
  rose: "bg-rose-500 hover:bg-rose-400",
  violet: "bg-violet-500 hover:bg-violet-400",
  slate: "bg-slate-500 hover:bg-slate-400",
};

const ACCENT_BORDER: Record<string, string> = {
  amber: "border-amber-500/30 text-amber-300 bg-amber-500/10",
  cyan: "border-cyan-500/30 text-cyan-300 bg-cyan-500/10",
  emerald: "border-emerald-500/30 text-emerald-300 bg-emerald-500/10",
  rose: "border-rose-500/30 text-rose-300 bg-rose-500/10",
  violet: "border-violet-500/30 text-violet-300 bg-violet-500/10",
  slate: "border-slate-500/30 text-slate-300 bg-slate-500/10",
};

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchManifest(slug: string) {
  const pub = process.env.R2_PUBLIC_URL;
  if (!pub) return null;
  try {
    const res = await fetch(
      `${pub.replace(/\/$/, "")}/published/${slug}/manifest.json`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    const parsed = EbookManifestSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

async function fetchAccent(slug: string): Promise<string> {
  const pub = process.env.R2_PUBLIC_URL;
  if (!pub) return "amber";
  try {
    const res = await fetch(
      `${pub.replace(/\/$/, "")}/published/index.json`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return "amber";
    const parsed = PublishedCatalogSchema.safeParse(await res.json());
    return parsed.success
      ? (parsed.data.books.find((b) => b.slug === slug)?.coverAccent ?? "amber")
      : "amber";
  } catch { return "amber"; }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function BookLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [manifest, accent] = await Promise.all([
    fetchManifest(slug),
    fetchAccent(slug),
  ]);

  if (!manifest) notFound();

  const heroGrad   = ACCENT_HERO[accent]   ?? ACCENT_HERO.amber;
  const accentText = ACCENT_TEXT[accent]   ?? ACCENT_TEXT.amber;
  const accentBg   = ACCENT_BG[accent]     ?? ACCENT_BG.amber;
  const accentBdr  = ACCENT_BORDER[accent] ?? ACCENT_BORDER.amber;
  const totalMins  = Math.ceil(manifest.totalWordCount / 200);

  return (
    <main className="min-h-dvh bg-slate-950">
      {/* Hero gradient band */}
      <div className={`bg-gradient-to-b ${heroGrad} pb-16 pt-0`}>
        {/* Nav bar */}
        <div className="mx-auto max-w-4xl px-5">
          <div className="flex items-center justify-between py-5">
            <Link
              href="/library"
              className="flex min-h-10 items-center gap-1.5 text-sm font-medium text-slate-400 transition hover:text-slate-300"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Library
            </Link>
          </div>

          {/* Book header */}
          <div className="mx-auto max-w-2xl pt-6 text-center">
            <p className={`mb-4 text-xs font-semibold uppercase tracking-[0.25em] ${accentText}`}>
              {manifest.authorName}
            </p>
            <h1
              className="mb-3 text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl"
              style={{ fontFamily: "Georgia, serif" }}
            >
              {manifest.bookTitle}
            </h1>
            {manifest.subtitle && (
              <p
                className="mb-8 text-xl leading-relaxed text-slate-300"
                style={{ fontFamily: "Georgia, serif" }}
              >
                {manifest.subtitle}
              </p>
            )}

            {/* Stats pills */}
            <div className="mb-10 flex flex-wrap items-center justify-center gap-2.5">
              <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${accentBdr}`}>
                {manifest.chapters.length} chapters
              </span>
              <span className="rounded-full border border-slate-700/60 px-3 py-1.5 text-xs font-medium text-slate-400">
                {manifest.totalWordCount.toLocaleString()} words
              </span>
              <span className="rounded-full border border-slate-700/60 px-3 py-1.5 text-xs font-medium text-slate-400">
                ~{totalMins >= 60 ? `${Math.round(totalMins / 60)}h` : `${totalMins} min`} read
              </span>
            </div>

            <Link
              href={`/library/${slug}/read`}
              className={`inline-flex min-h-14 items-center rounded-2xl ${accentBg} px-12 text-base font-bold text-slate-950 shadow-xl transition active:scale-[0.97]`}
            >
              Start Reading
            </Link>
          </div>
        </div>
      </div>

      {/* Body content */}
      <div className="mx-auto max-w-4xl px-5 py-12">
        <div className="grid gap-10 lg:grid-cols-3">

          {/* Left: intro + chapter list */}
          <div className="lg:col-span-2 space-y-10">
            {manifest.frontMatter.introduction && (
              <section>
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Introduction</p>
                <p className="text-base leading-relaxed text-slate-300" style={{ fontFamily: "Georgia, serif" }}>
                  {manifest.frontMatter.introduction.replace(/#{1,3} /g, "").slice(0, 600)}
                  {manifest.frontMatter.introduction.length > 600 ? "…" : ""}
                </p>
              </section>
            )}

            <section>
              <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Contents</p>
              <ol className="space-y-1.5">
                {manifest.chapters.map((ch, i) => (
                  <li key={ch.number}>
                    <Link
                      href={`/library/${slug}/read?chapter=${i}`}
                      className="group flex min-h-12 items-center gap-4 rounded-xl border border-slate-800/60 bg-slate-900/30 px-4 py-3 transition hover:border-slate-700/80 hover:bg-slate-900"
                    >
                      <span className={`w-7 shrink-0 text-center text-xs font-bold ${accentText}`}>
                        {ch.number}
                      </span>
                      <span
                        className="flex-1 text-sm font-medium text-slate-300 transition-colors group-hover:text-slate-100"
                        style={{ fontFamily: "Georgia, serif" }}
                      >
                        {ch.title}
                      </span>
                      {ch.totalWordCount > 0 && (
                        <span className="shrink-0 text-xs text-slate-600">
                          {Math.ceil(ch.totalWordCount / 200)} min
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          {/* Right sidebar */}
          <div className="space-y-5">
            {/* Book details card */}
            <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-5">
              <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">Book Details</p>
              <dl className="space-y-2.5">
                {[
                  ["Author",   manifest.authorName],
                  ["Chapters", String(manifest.chapters.length)],
                  ["Words",    manifest.totalWordCount.toLocaleString()],
                  ["Read time", totalMins >= 60 ? `~${Math.round(totalMins / 60)}h` : `~${totalMins} min`],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between text-sm">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="font-medium text-slate-300">{val}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* About author */}
            {manifest.frontMatter.aboutAuthor && (
              <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-5">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">About the Author</p>
                <p className="text-sm leading-relaxed text-slate-300">
                  {manifest.frontMatter.aboutAuthor.slice(0, 280)}
                  {manifest.frontMatter.aboutAuthor.length > 280 ? "…" : ""}
                </p>
              </div>
            )}

            {/* Scripture index */}
            {manifest.frontMatter.scriptureIndex.length > 0 && (
              <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 p-5">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Scripture References</p>
                <div className="flex flex-wrap gap-1.5">
                  {manifest.frontMatter.scriptureIndex.slice(0, 14).map((ref, i) => (
                    <span
                      key={i}
                      className="rounded-full border border-slate-700/50 px-2 py-0.5 text-xs text-slate-400"
                    >
                      {ref}
                    </span>
                  ))}
                  {manifest.frontMatter.scriptureIndex.length > 14 && (
                    <span className="text-xs text-slate-600">
                      +{manifest.frontMatter.scriptureIndex.length - 14} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
