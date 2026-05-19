import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1, "Missing Gemini API key"),
  DEEPSEEK_API_KEY: z.string().min(1, "Missing DeepSeek API key"),
  ANTHROPIC_API_KEY: z.string().min(1, "Missing Anthropic API key"),
  DEEPGRAM_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  CLAUDE_MODEL: z.string().default("claude-haiku-4-5")
});

const parsed = EnvironmentSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = parsed.data;
