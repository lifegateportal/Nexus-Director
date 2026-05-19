import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { deepSeekModel } from "@/lib/ai-providers";
import { AcademyPackageSchema } from "@/lib/schemas/academy";
import { SiteConfigSchema } from "@/lib/schemas/site-config";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 120;

const RequestSchema = z.object({
  academy:     AcademyPackageSchema,
  instruction: z.string().min(1).max(4000),
  siteConfig:  SiteConfigSchema.optional(),
});

const ResponseSchema = z.object({
  academy:    AcademyPackageSchema.optional(),
  siteConfig: SiteConfigSchema.optional(),
  summary:    z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as unknown;
    const { academy, instruction, siteConfig } = RequestSchema.parse(body);

    const { object } = await generateObject({
      model: deepSeekModel,
      schema: ResponseSchema,
      mode: "json",
      temperature: 0.1,
      system: `You are the Nexus Director AI assistant — a precise academy content and website editor.

Determine which object to update based on the instruction and return ONLY what changed.

ACADEMY changes (course content, curriculum, lessons, notes, quizzes, takeaways, modules):
- Apply ONLY what the user asked. Preserve everything else verbatim.
- Do not invent new content — use existing transcriptSegment/notes as source.
- Return the full updated academy in the "academy" field.
- Notes must use industry-standard markdown formatting:
  - # Title for the main topic heading
  - ## Section for major sections
  - ### Subsection for subtopics
  - **bold** for key terms and important concepts
  - *italic* for scripture references, titles, or emphasis
  - Numbered lists (1. 2. 3.) for sequential steps or principles
  - Bullet lists (- item) for non-sequential points
  - > blockquote for direct quotes or scriptures
  - --- horizontal rule to separate major themes

SITE CONFIG changes (landing page UI, website appearance, social proof):
- testimonials: Add/edit student testimonials — each needs name, role, quote, rating (1-5)
- faqItems: Add/edit FAQ questions and answers for the landing page
- instructorBio: Set instructor name, professional title, bio paragraph, avatarInitials (2 letters)
- announcementBar: A short bold top-of-page banner (e.g. "Enrolment open — limited seats")
- ctaOverride: Override all call-to-action button text (e.g. "Join the Academy")
- socialLinks: Set website, twitter, youtube, instagram, linkedin URLs (full https:// URLs)
- footerText: Custom copyright/tagline in the footer
- Return the full updated siteConfig in the "siteConfig" field.

If the instruction touches BOTH academy content and site config, return both fields.
If it touches only one, return only that field (leave the other as undefined/omitted).
Always write a concise one-sentence summary of exactly what you changed.`,
      prompt: [
        "CURRENT ACADEMY:",
        JSON.stringify(academy),
        "",
        "CURRENT SITE CONFIG:",
        JSON.stringify(siteConfig ?? {}),
        "",
        "USER INSTRUCTION:",
        instruction,
      ].join("\n"),
    });

    return NextResponse.json(object);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assistant failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
