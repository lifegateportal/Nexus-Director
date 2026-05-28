import Link from "next/link";
import { PublishedCatalogSchema } from "@/lib/schemas/published-book";
import type { PublishedBookEntry } from "@/lib/schemas/published-book";

export const revalidate = 60;

// ── Theme maps ────────────────────────────────────────────────────────────────

const COVER_GRADIENT: Record<string, string> = {
  amber:   "from-amber-950 via-amber-900 to-amber-800",
  cyan:    "from-cyan-950 via-cyan-900 to-cyan-800",
  emerald: "from-emerald-950 via-emerald-900 to-emerald-800",
  rose:    "from-rose-950 via-rose-900 to-rose-800",
  violet:  "from-violet-950 via-violet-900 to-violet-800",
  slate:   "from-slate-900 via-slate-800 to-slate-700",
};

const COVER_TITLE: Record<string, string> = {
  amber:   "text-amber-100",
  cyan:    "text-cyan-100",
  emerald: "text-emerald-100",
  rose:    "text-rose-100",
  violet:  "text-violet-100",
  slate:   "text-slate-100",
};

const ACCENT_BADGE: Record<string, string> = {
  amber:   "bg-amber-500/20 text-amber-300 border-amber-500/30",
  cyan:    "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  emerald: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  rose:    "bg-rose-500/20 text-rose-300 border-rose-500/30",
  violet:  "bg-violet-500/20 text-violet-300 border-violet-500/30",
  slate:   "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

// ── Data fetch ────────────────────────────────────────────────────────────────

async function fetchCatalog() {
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!publicUrl) return null;
  try {
    const res = await fetch(
      `${publicUrl.replace(/\/$/, "")}/published/index.json`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    const parsed = PublishedCatalogSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

// ── Book card ─────────────────────────────────────────────────────────────────

function BookCard({ book }: { book: PublishedBookEntry }) {
  const accent = book.coverAccent ?? "amber";
  const grad   = COVER_GRADIENT[accent] ?? COVER_GRADIENT.amber;
  const title  = COVER_TITLE[accent]    ?? COVER_TITLE.amber;
  const badge  = ACCENT_BADGE[accent]   ?? ACCENT_BADGE.amber;
  const mins   = Math.ceil(book.wordCount / 200);

  return (
    <Link href={`/library/${book.slug}`} className="group block">
      {/* Book cover illustration */}
      <div
        className={`relative mb-4 h-64 w-full overflow-hidden rounded-2xl bg-gradient-to-br ${grad} shadow-xl ring-1 ring-white/5 transition duration-300 group-hover:scale-[1.02] group-hover:shadow-2xl group-hover:ring-white/10`}
      >
        {/* Spine */}
        <div className="absolute inset-y-0 left-0 w-3 bg-black/25" />
        {/* Page edges */}
        <div className="absolute inset-y-2 right-2 w-2 rounded-sm bg-white/6 shadow" />
        <div className="absolute inset-y-3 right-4.5 w-1 rounded-sm bg-white/3" />
        {/* Bottom gradient */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
        {/* Cover text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-7 text-center">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
            {book.authorName}
          </p>
          <h2
            className={`text-xl font-bold leading-snug tracking-tight ${title}`}
            style={{ fontFamily: "Georgia, serif" }}
          >
            {book.title}
          </h2>
          {book.subtitle && (
            <p
              className="mt-2 text-sm leading-snug text-white/45"
              style={{ fontFamily: "Georgia, serif" }}
            >
              {book.subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Below-cover metadata */}
      <div className="px-0.5">
        <h3 className="mb-1 font-semibold leading-snug text-slate-100 transition-colors group-hover:text-white">
          {book.title}
        </h3>
        <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-slate-400">
          {book.synopsis}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${badge}`}>
            {book.chapterCount} ch
          </span>
          <span className="inline-flex items-center rounded-full border border-slate-700/50 px-2.5 py-1 text-xs font-medium text-slate-500">
            {mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins} min`}
          </span>
          <span className="inline-flex items-center rounded-full border border-slate-700/50 px-2.5 py-1 text-xs font-medium text-slate-500">
            {book.wordCount.toLocaleString()} words
          </span>
        </div>
      </div>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function LibraryPage() {
  const catalog    = await fetchCatalog();
  const configured = !!process.env.R2_PUBLIC_URL;

  return (
    <main className="min-h-dvh bg-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-800/60 bg-slate-950/90 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-600">Nexus</p>
            <h1 className="text-xl font-bold tracking-tight text-slate-100">Library</h1>
          </div>
          <Link
            href="/"
            className="flex min-h-10 items-center rounded-xl border border-slate-700/60 px-4 text-sm font-medium text-slate-400 transition hover:border-slate-600 hover:text-slate-300"
          >
            ← Director
          </Link>
        </div>
      </header>

      {!configured ? (
        <div className="flex min-h-[65vh] flex-col items-center justify-center px-5 text-center">
          <div className="mb-5 text-5xl">📚</div>
          <p className="mb-2 text-lg font-semibold text-slate-200">Library not configured</p>
          <p className="max-w-sm text-sm leading-relaxed text-slate-500">
            Set{" "}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-amber-300">
              R2_PUBLIC_URL
            </code>{" "}
            in your environment to enable the public reading library.
          </p>
        </div>
      ) : !catalog || catalog.books.length === 0 ? (
        <div className="flex min-h-[65vh] flex-col items-center justify-center px-5 text-center">
          <div className="mb-5 text-5xl">📖</div>
          <p className="mb-2 text-lg font-semibold text-slate-200">No books published yet</p>
          <p className="max-w-sm text-sm leading-relaxed text-slate-500">
            Complete a book in Nexus Director and click &quot;Publish to Library&quot; to see it here.
          </p>
          <Link
            href="/ebook"
            className="mt-6 flex min-h-11 items-center rounded-xl bg-amber-500 px-6 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
          >
            Open Ebook Pipeline →
          </Link>
        </div>
      ) : (
        <div className="mx-auto max-w-5xl px-5 py-10">
          <p className="mb-8 text-xs font-medium text-slate-600">
            {catalog.books.length} {catalog.books.length === 1 ? "book" : "books"} published
          </p>
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.books.map((book) => (
              <BookCard key={book.slug} book={book} />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
