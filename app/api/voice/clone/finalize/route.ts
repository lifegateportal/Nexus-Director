/**
 * POST /api/voice/clone/finalize
 *
 * Called repeatedly by the browser to check on a RunPod clone job.
 * When the job completes, uploads the cleaned WAV to R2 and returns voiceId.
 *
 * Body:    { runpodJobId: string }
 * Returns:
 *   { status: "IN_QUEUE" | "IN_PROGRESS" }          — still running, poll again
 *   { status: "COMPLETED", voiceId, durationSec }   — done
 *   { status: "FAILED", error }                     — fatal error
 */

import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { env } from "@/lib/env";
import { toR2PublicUrlOrKey } from "@/lib/r2-storage";

export const runtime = "nodejs";
export const maxDuration = 15;

const RequestSchema = z.object({ runpodJobId: z.string().min(1) });

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

export async function POST(req: NextRequest) {
  const { RUNPOD_API_KEY, RUNPOD_VOICE_ENDPOINT_ID, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL } = env;

  if (!RUNPOD_API_KEY || !RUNPOD_VOICE_ENDPOINT_ID) {
    return NextResponse.json({ status: "FAILED", error: "RUNPOD_API_KEY and RUNPOD_VOICE_ENDPOINT_ID must be set" }, { status: 503 });
  }

  let input: z.infer<typeof RequestSchema>;
  try {
    const body = await req.json() as unknown;
    input = RequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ status: "FAILED", error: err instanceof Error ? err.message : "Invalid request" }, { status: 400 });
  }

  try {
    const statusRes = await fetch(
      `https://api.runpod.ai/v2/${RUNPOD_VOICE_ENDPOINT_ID}/status/${input.runpodJobId}`,
      { headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` } }
    );
    const json = await statusRes.json() as {
      status: string;
      output?: Record<string, unknown>;
      error?: string;
    };

    if (json.status === "IN_QUEUE" || json.status === "IN_PROGRESS") {
      return NextResponse.json({ status: json.status });
    }

    if (json.status === "FAILED") {
      return NextResponse.json({ status: "FAILED", error: json.error ?? "RunPod job failed" });
    }

    if (json.status !== "COMPLETED") {
      return NextResponse.json({ status: json.status });
    }

    // COMPLETED — upload WAV to R2
    const output = json.output ?? {};
    if (output.error) return NextResponse.json({ status: "FAILED", error: output.error });

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
      return NextResponse.json({ status: "FAILED", error: "R2 storage not configured" }, { status: 503 });
    }

    const wavB64 = output.wav_base64;
    if (typeof wavB64 !== "string" || wavB64.length === 0) {
      return NextResponse.json({ status: "FAILED", error: "RunPod clone completed without wav_base64 output" });
    }
    const durationSec = (output.duration_sec as number) ?? 0;

    const s3 = makeS3();
    const key = `voices/${Date.now()}-sample.wav`;
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: Buffer.from(wavB64, "base64"),
      ContentType: "audio/wav",
    }));

    const voiceId = toR2PublicUrlOrKey(key);

    return NextResponse.json({ status: "COMPLETED", voiceId, durationSec });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Finalize failed";
    return NextResponse.json({ status: "FAILED", error: message }, { status: 500 });
  }
}
