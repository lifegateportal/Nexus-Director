/**
 * POST /api/voice/clone
 *
 * Accepts a voice sample (audio file uploaded to R2, URL passed in body),
 * sends it to the RunPod XTTS worker for format normalization,
 * stores the cleaned WAV back in R2, and returns a stable voice_id (R2 URL).
 *
 * Body: { sampleUrl: string, ext?: string }
 * Response: { voiceId: string, durationSec: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 120;

const RequestSchema = z.object({
  sampleUrl: z.string().url(),
  ext:       z.string().optional().default("wav"),
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

async function pollRunpod(endpointId: string, jobId: string, apiKey: string, maxAttempts = 60): Promise<Record<string, unknown>> {
  const statusUrl = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise<void>((r) => setTimeout(r, 3000));
    const res = await fetch(statusUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    const json = await res.json() as { status: string; output?: Record<string, unknown>; error?: string };
    if (json.status === "COMPLETED") return json.output ?? {};
    if (json.status === "FAILED")    throw new Error(json.error ?? "RunPod job failed");
  }
  throw new Error("RunPod job timed out after 3 minutes");
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
    // Submit clone job to RunPod
    const submitRes = await fetch(`https://api.runpod.ai/v2/${RUNPOD_VOICE_ENDPOINT_ID}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RUNPOD_API_KEY}` },
      body: JSON.stringify({ input: { action: "clone", audio_url: input.sampleUrl, ext: input.ext } }),
    });
    const { id: jobId } = await submitRes.json() as { id: string };

    // Poll until complete
    const output = await pollRunpod(RUNPOD_VOICE_ENDPOINT_ID, jobId, RUNPOD_API_KEY);

    if (output.error) throw new Error(output.error as string);

    const wavB64 = output.wav_base64 as string;
    const durationSec = output.duration_sec as number;

    // Upload cleaned WAV to R2 under voices/
    const s3 = makeS3();
    const key = `voices/${Date.now()}-sample.wav`;
    const wavBuffer = Buffer.from(wavB64, "base64");
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: wavBuffer,
      ContentType: "audio/wav",
    }));

    const voiceId = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`
      : key;

    return NextResponse.json({ voiceId, durationSec });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clone failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
