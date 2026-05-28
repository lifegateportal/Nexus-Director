import Link from "next/link";
import { PublishedCatalogSchema } from "@/lib/schemas/published-book";
import LibraryGrid from "./LibraryGrid";

export const revalidate = 60;

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function LibraryPage() {
  const catalog    = await fetchCatalog();
  const configured = !!process.env.R2_PUBLIC_URL;

  return (
    <main className="min-h-dvh bg-slate-950">

      {/* ── Sticky nav ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-slate-800/60 bg-slate-950/90 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-600">Nexus</p>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">Library</h1>
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
        <div className="mx-auto max-w-6xl px-5">

          {/* ── Hero header ───────────────────────────────────────────────── */}
          <div className="border-b border-slate-800/50 py-12 lg:py-16">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-500">
              Nexus Library
            </p>
            <h2
              className="mb-4 text-3xl font-bold tracking-tight text-slate-100 lg:text-4xl"
              style={{ fontFamily: "Georgia, serif" }}
            >
              Published Books
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-slate-400">
              A curated collection of books crafted with Nexus Director. Tap any title to read it in your browser — no account required.
            </p>
          </div>

          {/* ── Grid with search ──────────────────────────────────────────── */}
          <div className="py-10 pb-24 lg:pb-12">
            <LibraryGrid books={catalog.books} />
          </div>

        </div>
      )}
    </main>
  );
}

