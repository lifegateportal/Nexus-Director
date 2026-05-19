"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AcademyPackageSchema } from "@/lib/schemas/academy";
import type { AcademyPackage } from "@/lib/schemas/academy";
import { SiteConfigSchema } from "@/lib/schemas/site-config";
import type { SiteConfig } from "@/lib/schemas/site-config";

const LESSON_TYPE_COLORS: Record<string, string> = {
  video:    "bg-violet-500/20 text-violet-300",
  reading:  "bg-sky-500/20 text-sky-300",
  quiz:     "bg-amber-500/20 text-amber-300",
  exercise: "bg-orange-500/20 text-orange-300",
};

export default function PreviewPage() {
  const [academy, setAcademy] = useState<AcademyPackage | null>(null);
  const [missing, setMissing] = useState(false);
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("nexus_academy_preview");
      if (!raw) { setMissing(true); return; }
      const parsed = AcademyPackageSchema.parse(JSON.parse(raw));
      setAcademy(parsed);
    } catch {
      setMissing(true);
    }
    try {
      const rawCfg = localStorage.getItem("nexus_site_config");
      if (rawCfg) setSiteConfig(SiteConfigSchema.parse(JSON.parse(rawCfg)));
    } catch { /* ignore */ }
  }, []);

  // I: Open Graph meta tags — injected dynamically for link preview support
  useEffect(() => {
    if (!academy) return;
    const setMeta = (property: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!el) { el = document.createElement("meta"); el.setAttribute("property", property); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };
    setMeta("og:type", "website");
    setMeta("og:title", academy.seoMeta.title);
    setMeta("og:description", academy.seoMeta.description);
    document.title = academy.seoMeta.title;
  }, [academy]);

  if (missing || !academy) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-950">
        <p className="text-slate-400 text-base">
          No academy data found — run the pipeline in Nexus Director first.
        </p>
      </div>
    );
  }

  const free  = academy.pricing.find((t) => t.priceUsd === 0);
  const paid  = academy.pricing.filter((t) => t.priceUsd > 0);

  // H: JSON-LD Course structured data for Google rich results
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: academy.academyName,
    description: academy.seoMeta.description,
    provider: { "@type": "Organization", name: "Nexus Director" },
    educationalLevel: academy.difficultyLevel,
    timeRequired: academy.totalEstimatedHours > 0 ? `PT${Math.round(academy.totalEstimatedHours * 60)}M` : undefined,
    hasCourseInstance: academy.curriculum.flatMap((mod) =>
      mod.lessons.map((l) => ({
        "@type": "CourseInstance",
        name: l.title,
        courseMode: l.type,
        duration: `PT${l.durationMinutes}M`,
      }))
    ),
  };

  const ctaText = (siteConfig?.ctaOverride || academy?.landingPage.cta) ?? "Get started";

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 antialiased">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Announcement bar */}
      {siteConfig?.announcementBar && (
        <div className="sticky top-0 z-[60] flex items-center justify-center bg-cyan-500 px-4 py-2.5 text-center text-sm font-semibold text-slate-950">
          {siteConfig.announcementBar}
        </div>
      )}

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="text-base font-bold tracking-tight">{academy.academyName}</span>
            <Link
              href="/preview/learn"
              className="hidden rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 transition hover:border-slate-500 hover:text-slate-200 sm:block"
            >
              Courses
            </Link>
          </div>
          <Link
            href="/preview/learn"
            className="flex min-h-12 items-center rounded-xl bg-cyan-500 px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            {ctaText}
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-4xl px-5 pb-20 pt-20 text-center">
        <span className="mb-5 inline-block rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-cyan-400">
          {academy.targetAudience}
        </span>
        {academy.difficultyLevel && (
          <span className="mb-5 ml-2 inline-block rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-slate-400">
            {academy.difficultyLevel}
          </span>
        )}
        <h1 className="mb-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          {academy.landingPage.headline}
        </h1>
        <p className="mb-4 text-lg text-slate-300">{academy.landingPage.subheadline}</p>
        <p className="mx-auto mb-10 max-w-2xl text-base text-slate-400">
          {academy.landingPage.problemStatement}
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/preview/learn"
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-cyan-500 px-8 text-base font-bold text-slate-950 transition hover:bg-cyan-400 sm:w-auto"
          >
            {ctaText}
          </Link>
          <Link
            href="/preview/learn"
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-700 px-8 text-base font-semibold text-slate-300 transition hover:border-slate-500 sm:w-auto"
          >
            Explore courses
          </Link>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="border-y border-slate-800/60 bg-slate-900/40 py-16">
        <div className="mx-auto max-w-6xl px-5">
          <p className="mb-10 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            What you get
          </p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {academy.landingPage.features.map((f, i) => (
              <div
                key={i}
                className="rounded-2xl border border-slate-700/50 bg-slate-900 p-5"
              >
                <p className="mb-2 font-semibold text-slate-100">{f.title}</p>
                <p className="text-sm text-slate-400">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Curriculum ── */}
      <section className="mx-auto max-w-4xl px-5 py-16">
        <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Curriculum
        </p>
        <h2 className="mb-10 text-center text-2xl font-bold">
          {academy.curriculum.length} module{academy.curriculum.length !== 1 ? "s" : ""} · {academy.curriculum.reduce((n, m) => n + m.lessons.length, 0)} lessons
        </h2>
        <div className="space-y-3">
          {academy.curriculum.map((mod, mi) => (
            <details
              key={mi}
              className="group rounded-2xl border border-slate-700/50 bg-slate-900"
              open={mi === 0}
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="font-semibold text-slate-100">{mod.moduleTitle}</p>
                  <p className="text-xs text-slate-400">{mod.lessons.length} lesson{mod.lessons.length !== 1 ? "s" : ""}</p>
                </div>
                <span className="text-slate-500 transition group-open:rotate-180">▾</span>
              </summary>
              <div className="border-t border-slate-800 px-5 pb-4 pt-3">
                <p className="mb-3 text-sm text-slate-400">{mod.moduleDescription}</p>
                <ol className="space-y-2">
                  {mod.lessons.map((lesson, li) => (
                    <li key={li} className="flex items-center gap-3 text-sm">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-slate-400">
                        {li + 1}
                      </span>
                      <span className="flex-1 text-slate-200">{lesson.title}</span>
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${LESSON_TYPE_COLORS[lesson.type] ?? LESSON_TYPE_COLORS.reading}`}>
                        {lesson.type}
                      </span>
                      <span className="text-xs text-slate-500">{lesson.durationMinutes}m</span>
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="border-t border-slate-800/60 bg-slate-900/40 py-16">
        <div className="mx-auto max-w-5xl px-5">
          <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Pricing
          </p>
          <h2 className="mb-10 text-center text-2xl font-bold">Simple, transparent pricing</h2>
          <div className={`grid gap-5 ${academy.pricing.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {academy.pricing.map((tier, i) => {
              const isPopular = tier.period !== "once" && tier.priceUsd > 0 && i === Math.floor(academy.pricing.length / 2);
              return (
                <div
                  key={i}
                  className={`relative rounded-2xl border p-6 ${
                    isPopular
                      ? "border-cyan-500/50 bg-cyan-500/5 ring-1 ring-cyan-500/30"
                      : "border-slate-700/50 bg-slate-900"
                  }`}
                >
                  {isPopular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan-500 px-3 py-0.5 text-[11px] font-bold text-slate-950">
                      Most popular
                    </span>
                  )}
                  <p className="mb-1 font-semibold text-slate-200">{tier.name}</p>
                  <p className="mb-4 text-3xl font-extrabold">
                    {tier.priceUsd === 0 ? "Free" : `$${tier.priceUsd}`}
                    {tier.priceUsd > 0 && (
                      <span className="ml-1 text-sm font-normal text-slate-400">/{tier.period}</span>
                    )}
                  </p>
                  <ul className="mb-6 space-y-2">
                    {tier.features.map((f, fi) => (
                      <li key={fi} className="flex items-start gap-2 text-sm text-slate-300">
                        <span className="mt-px text-cyan-400">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <a
                    href="#"
                    className={`flex min-h-12 items-center justify-center rounded-xl text-sm font-semibold transition ${
                      isPopular
                        ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                        : "border border-slate-700 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {tier.priceUsd === 0 ? "Start free" : "Get started"}
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Instructor Bio ── */}
      {siteConfig?.instructorBio?.name && (
        <section className="border-t border-slate-800/60 py-16">
          <div className="mx-auto max-w-3xl px-5">
            <p className="mb-8 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-500">Your Instructor</p>
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
              <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-2xl font-extrabold text-cyan-400 ring-2 ring-cyan-500/30">
                {siteConfig.instructorBio.avatarInitials || siteConfig.instructorBio.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-xl font-bold text-slate-100">{siteConfig.instructorBio.name}</p>
                {siteConfig.instructorBio.title && (
                  <p className="mb-3 text-sm font-medium text-cyan-400">{siteConfig.instructorBio.title}</p>
                )}
                {siteConfig.instructorBio.bio && (
                  <p className="text-base text-slate-400 leading-relaxed">{siteConfig.instructorBio.bio}</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Testimonials ── */}
      {siteConfig?.testimonials && siteConfig.testimonials.length > 0 && (
        <section className="border-t border-slate-800/60 bg-slate-900/40 py-16">
          <div className="mx-auto max-w-6xl px-5">
            <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-500">Student Results</p>
            <h2 className="mb-10 text-center text-2xl font-bold">What students are saying</h2>
            <div className={`grid gap-5 ${siteConfig.testimonials.length > 2 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2"}`}>
              {siteConfig.testimonials.map((t, i) => (
                <div key={i} className="rounded-2xl border border-slate-700/50 bg-slate-900 p-6">
                  <div className="mb-3 flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, s) => (
                      <span key={s} className={s < t.rating ? "text-amber-400" : "text-slate-700"}>★</span>
                    ))}
                  </div>
                  <p className="mb-4 text-sm text-slate-300 leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{t.name}</p>
                    {t.role && <p className="text-xs text-slate-500">{t.role}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FAQ ── */}
      {siteConfig?.faqItems && siteConfig.faqItems.length > 0 && (
        <section className="mx-auto max-w-3xl px-5 py-16">
          <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-500">FAQ</p>
          <h2 className="mb-10 text-center text-2xl font-bold">Common questions</h2>
          <div className="space-y-3">
            {siteConfig.faqItems.map((item, i) => (
              <details key={i} className="group rounded-2xl border border-slate-700/50 bg-slate-900">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                  <p className="font-medium text-slate-100">{item.question}</p>
                  <span className="flex-shrink-0 text-slate-500 transition group-open:rotate-180">▾</span>
                </summary>
                <div className="border-t border-slate-800 px-5 pb-4 pt-3">
                  <p className="text-sm text-slate-400 leading-relaxed">{item.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* ── Onboarding ── */}
      <section className="mx-auto max-w-3xl px-5 py-16">
        <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          How it works
        </p>
        <h2 className="mb-10 text-center text-2xl font-bold">Up and running in minutes</h2>
        <ol className="space-y-4">
          {academy.onboardingSteps.map((step, i) => (
            <li key={i} className="flex items-start gap-4">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-sm font-bold text-cyan-400">
                {i + 1}
              </span>
              <p className="pt-1 text-base text-slate-300">{step}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-800/60 py-10">
        <div className="mx-auto max-w-6xl px-5">
          {/* Social links */}
          {siteConfig && Object.values(siteConfig.socialLinks).some(Boolean) && (
            <div className="mb-6 flex flex-wrap items-center gap-3">
              {siteConfig.socialLinks.website && (
                <a href={siteConfig.socialLinks.website} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 transition hover:text-slate-300">Website ↗</a>
              )}
              {siteConfig.socialLinks.youtube && (
                <a href={siteConfig.socialLinks.youtube} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 transition hover:text-slate-300">YouTube ↗</a>
              )}
              {siteConfig.socialLinks.twitter && (
                <a href={siteConfig.socialLinks.twitter} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 transition hover:text-slate-300">Twitter ↗</a>
              )}
              {siteConfig.socialLinks.instagram && (
                <a href={siteConfig.socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 transition hover:text-slate-300">Instagram ↗</a>
              )}
              {siteConfig.socialLinks.linkedin && (
                <a href={siteConfig.socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 transition hover:text-slate-300">LinkedIn ↗</a>
              )}
            </div>
          )}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {academy.seoMeta.keywords.map((k, i) => (
              <span key={i} className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-500">
                {k}
              </span>
            ))}
          </div>
          <p className="text-xs text-slate-600">{academy.seoMeta.description}</p>
          <p className="mt-3 text-xs text-slate-700">
            {siteConfig?.footerText || `Built with Nexus Director · ${new Date().getFullYear()}`}
          </p>
        </div>
      </footer>

    </div>
  );
}
