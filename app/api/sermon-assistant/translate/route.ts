import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";

export const runtime = "nodejs";

const RequestSchema = z.object({
  text: z.string().min(1).max(6000),
  lang: z.enum(["english", "spanish", "french", "portuguese", "german", "swahili", "twi", "kikuyu"]),
});

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

export async function POST(request: NextRequest) {
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json() as unknown);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request payload" },
      { status: 400 },
    );
  }

  if (!env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "DEEPSEEK_API_KEY is not configured" }, { status: 503 });
  }

  const targetLanguageLabel = body.lang[0].toUpperCase() + body.lang.slice(1);

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You are a highly accurate live translator. Translate the text directly to ${targetLanguageLabel}. Return ONLY the translation, no extra text, notes, or quotes.`,
          },
          {
            role: "user",
            content: body.text,
          },
        ],
      }),
    });

    const data = await response.json() as DeepSeekResponse;
    if (!response.ok) {
      return NextResponse.json(
        { error: data.error?.message ?? `DeepSeek request failed (${response.status})` },
        { status: response.status },
      );
    }

    const translation = data.choices?.[0]?.message?.content?.trim();
    if (!translation) {
      return NextResponse.json({ error: "Translation model returned empty output" }, { status: 502 });
    }

    return NextResponse.json({ translation });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Translation failed" },
      { status: 500 },
    );
  }
}
