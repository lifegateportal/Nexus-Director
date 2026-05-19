import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "@/lib/env";

const google = createGoogleGenerativeAI({
  apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY
});

const deepSeek = createOpenAI({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1"
});

const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY
});

export const geminiModel = google(env.GEMINI_MODEL);
export const deepSeekModel = deepSeek(env.DEEPSEEK_MODEL);
export const claudeModel = anthropic(env.CLAUDE_MODEL);
