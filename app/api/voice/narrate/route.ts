/**
 * POST /api/voice/narrate
 *
 * Synthesizes a chapter (or any text block) using the user's cloned voice.
 * Sends text + voiceId (R2 WAV URL) to the RunPod XTTS worker,
 * uploads the resulting WAV to R2 under audio/books/{slug}/{chapterId}.wav,
 * and returns the public playback URL.
 *
 * Body: { text: string, voiceId: string, chapterId: string, slug: string, language?: string, speed?: number }
 * Response: { audioUrl: string, durationSec: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300; // chapters can be long — allow 5 min

const RequestSchema = z.object({
  text:       z.string().min(1).max(50_000),
  voiceId:    z.string().url("voiceId must be the R2 URL of your cloned WAV"),
  chapterId:  z.string().min(1).max(100),
  slug:       z.string().min(1).max(100),
  language:   z.string().default("en"),
  speed:      z.number().min(0.5).max(2.0).default(1.0),
});

function makeS3(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

async function pollRunpod(endpointId: string, jobId: string, apiKey: string, maxAttempts = 100): Promise<Record<string, unknown>> {
  const statusUrl = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise<void>((r) => setTimeout(r, 3000));
    const res = await fetch(statusUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    const json = await res.json() as { status: string; output?: Record<string, unknown>; error?: string };
    if (json.status === "COMPLETED") return json.output ?? {};
    if (json.status === "FAILED")    throw new Error(json.error ?? "RunPod synthesis job failed");
  }
  throw new Error("RunPod synthesis job timed out after 5 minutes");
}

export async function POST(req: NextRequest) {
  const { RUNPOD_API_KEY, RUNPOD_VOICE_ENDPOINT_ID, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL } = env;

  if (!RUNPOD_API_KEY || !RUNPOD_VOICE_ENDPOINT_ID) {
    return NextResponse.json({ error: "RUNPOD_API_KEY and RUNPOD_VOICE_ENDPOINT_ID must be set" }, { status: 503 });
  }
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return NextResponse.json({ error: "R2 storage not configured" }, { status: 503 });
  }

  let input: z.infer<typeof RequestSchema>;
  try {
    const body = await req.json() as unknown;
    input = RequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid request" }, { status: 400 });
  }

  try {
    // Strip markdown so the TTS model reads clean prose, not formatting symbols
    const cleanText = input.text
      .replace(/^#{1,6}\s+/gm, "")      // headings
      .replace(/\*\*(.*?)\*\*/g, "$1")  // bold
      .replace(/\*(.*?)\*/g, "$1")      // italic
      .replace(/^>\s+/gm, "")           // blockquotes
      .replace(/^[-*+]\s+/gm, "")       // bullets
      .replace(/\n{3,}/g, "\n\n")       // excess blank lines
      .trim();

    // Submit synthesis job to RunPod
    const submitRes = await fetch(`https://api.runpod.ai/v2/${RUNPOD_VOICE_ENDPOINT_ID}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RUNPOD_API_KEY}` },
      body: JSON.stringify({
        input: {
          action: "synthesize",
          text: cleanText,
          speaker_wav_url: input.voiceId,
          language: input.language,
          speed: input.speed,
        },
      }),
    });
    const { id: jobId } = await submitRes.json() as { id: string };

    // Poll until complete (chapters can take 30–120 s on GPU)
    const output = await pollRunpod(RUNPOD_VOICE_ENDPOINT_ID, jobId, RUNPOD_API_KEY);

    if (output.error) throw new Error(output.error as string);

    const wavB64 = output.wav_base64 as string;
    const durationSec = output.duration_sec as number;

    // Upload to R2
    const s3 = makeS3();
    const safeSlug = input.slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const safeChapter = input.chapterId.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const key = `audio/books/${safeSlug}/${safeChapter}.wav`;
    const wavBuffer = Buffer.from(wavB64, "base64");
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: wavBuffer,
      ContentType: "audio/wav",
    }));

    const audioUrl = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`
      : key;

    return NextResponse.json({ audioUrl, durationSec });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Narration failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
