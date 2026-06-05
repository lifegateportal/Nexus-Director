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

function getOutputObject(value: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [value];
  let fallback: Record<string, unknown> | null = null;

  while (queue.length > 0) {
    const current = queue.shift();

    if (typeof current === "string") {
      const trimmed = current.trim();
      if (trimmed.length > 1000 && /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed)) {
        return { wav_base64: trimmed };
      }
      try {
        queue.push(JSON.parse(trimmed));
      } catch {
        // Not JSON, continue searching.
      }
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (!current || typeof current !== "object") continue;

    const obj = current as Record<string, unknown>;
    if (!fallback) fallback = obj;

    const hasAudioPayload =
      typeof obj.wav_base64 === "string" ||
      typeof obj.audio_base64 === "string" ||
      typeof obj.error === "string";
    if (hasAudioPayload) return obj;

    if (obj.output !== undefined) queue.push(obj.output);
    if (obj.delayOutput !== undefined) queue.push(obj.delayOutput);
    if (obj.data !== undefined) queue.push(obj.data);
  }

  return fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const {
    RUNPOD_API_KEY,
    RUNPOD_VOICE_ENDPOINT_ID,
    RUNPOD_ENDPOINT_ID,
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
  } = env;
  const endpointId = RUNPOD_VOICE_ENDPOINT_ID ?? RUNPOD_ENDPOINT_ID;

  if (!RUNPOD_API_KEY || !endpointId) {
    return NextResponse.json({ status: "FAILED", error: "RUNPOD_API_KEY and RUNPOD_VOICE_ENDPOINT_ID (or RUNPOD_ENDPOINT_ID) must be set" }, { status: 503 });
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
      `https://api.runpod.ai/v2/${endpointId}/status/${input.runpodJobId}`,
      { headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` } }
    );

    if (!statusRes.ok) {
      const body = await statusRes.text();
      return NextResponse.json({ status: "FAILED", error: `RunPod status failed (${statusRes.status}): ${body.slice(0, 400)}` });
    }

    const json = await statusRes.json() as {
      status: string;
      output?: unknown;
      delayOutput?: unknown;
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
    const output = getOutputObject(json.output ?? json.delayOutput);
    if (!output) {
      return NextResponse.json({ status: "FAILED", error: "RunPod clone completed without structured output" });
    }
    if (typeof output.error === "string" && output.error) {
      return NextResponse.json({ status: "FAILED", error: output.error });
    }

    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
      return NextResponse.json({ status: "FAILED", error: "R2 storage not configured" }, { status: 503 });
    }

    const wavB64 = (output.wav_base64 ?? output.audio_base64) as unknown;
    if (typeof wavB64 !== "string" || wavB64.length === 0) {
      return NextResponse.json({ status: "FAILED", error: "RunPod clone completed without wav_base64/audio_base64 output" });
    }
    const durationSec = asNumber(output.duration_sec ?? output.duration) ?? 0;

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
