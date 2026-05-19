import { z } from "zod";

export const ProduceInputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  rawTranscript: z.string().default(""),
  deliveryInstructions: z.string().default(""),
  assets: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      type: z.string(),
      durationMs: z.number().optional(),
      tags: z.array(z.string()).default([]),
    })
  ),
  workflow: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      intent: z.string(),
    })
  ),
  executionPlan: z.array(
    z.object({
      step: z.number(),
      title: z.string(),
      action: z.string(),
      expectedOutcome: z.string(),
    })
  ),
  entities: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      category: z.string(),
    })
  ),
  visualDirection: z.string(),
});

export const AcademyPackageSchema = z.object({
  academyName: z.string(),
  tagline: z.string(),
  targetAudience: z.string(),
  // C: Course-level metadata
  difficultyLevel: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
  totalEstimatedHours: z.number().default(0),
  certificateTitle: z.string().default(""),
  landingPage: z.object({
    headline: z.string(),
    subheadline: z.string(),
    problemStatement: z.string(),
    features: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
      })
    ),
    cta: z.string(),
  }),
  pricing: z.array(
    z.object({
      name: z.string(),
      priceUsd: z.number(),
      period: z.enum(["once", "monthly", "yearly"]),
      features: z.array(z.string()),
    })
  ),
  curriculum: z.array(
    z.object({
      moduleTitle: z.string(),
      moduleDescription: z.string(),
      // B: Module-level metadata
      learningObjectives: z.array(z.string()).default([]),
      estimatedMinutes: z.number().default(0),
      keyTerms: z.array(
        z.object({
          term: z.string(),
          definition: z.string(),
        })
      ).default([]),
      lessons: z.array(
        z.object({
          title: z.string(),
          type: z.enum(["video", "reading", "quiz", "exercise"]),
          durationMinutes: z.number(),
          description: z.string(),
          notes: z.string().default(""),
          // A: Lesson-level enrichment
          keyTakeaways: z.array(z.string()).default([]),
          actionItems: z.array(z.string()).default([]),
          transcriptSegment: z.string().default(""),
          quiz: z.array(
            z.object({
              q: z.string(),
              options: z.array(z.string()),
              correct: z.number().int().min(0).max(3),
            })
          ).default([]),
        })
      ),
    })
  ),
  seoMeta: z.object({
    title: z.string(),
    description: z.string(),
    keywords: z.array(z.string()),
  }),
  onboardingSteps: z.array(z.string()),
});

export type ProduceInput = z.infer<typeof ProduceInputSchema>;
export type AcademyPackage = z.infer<typeof AcademyPackageSchema>;
