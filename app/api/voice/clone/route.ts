/**
 * POST /api/voice/clone
 *
 * Submits a voice clone job to RunPod and returns immediately with the jobId.
 * The client polls /api/voice/clone/finalize to check status and get the voiceId.
 *
 * Body: { sampleUrl: string, ext?: string }
 * Response: { runpodJobId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { resolveR2ObjectUrl } from "@/lib/r2-storage";

export const runtime = "nodejs";
export const maxDuration = 15;

const RequestSchema = z.object({
  sampleUrl: z.string().min(1),
  ext:       z.string().optional().default("wav"),
});

export async function POST(req: NextRequest) {
  const { RUNPOD_API_KEY, RUNPOD_VOICE_ENDPOINT_ID, RUNPOD_ENDPOINT_ID } = env;
  const endpointId = RUNPOD_VOICE_ENDPOINT_ID ?? RUNPOD_ENDPOINT_ID;

  if (!RUNPOD_API_KEY || !endpointId) {
    return NextResponse.json({ error: "RUNPOD_API_KEY and RUNPOD_VOICE_ENDPOINT_ID (or RUNPOD_ENDPOINT_ID) must be set" }, { status: 503 });
  }

  let input: z.infer<typeof RequestSchema>;
  try {
    const body = await req.json() as unknown;
    input = RequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid request" }, { status: 400 });
  }

  try {
    const sampleUrl = await resolveR2ObjectUrl(input.sampleUrl);
    const safeExt = (input.ext ?? "wav").toLowerCase().replace(/[^a-z0-9]/g, "") || "wav";

    const submitRes = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RUNPOD_API_KEY}` },
      body: JSON.stringify({ input: { action: "clone", audio_url: sampleUrl, ext: safeExt } }),
    });
    if (!submitRes.ok) {
      const body = await submitRes.text();
      throw new Error(`RunPod submit failed (${submitRes.status}): ${body.slice(0, 400)}`);
    }
    const { id: runpodJobId } = await submitRes.json() as { id: string };
    return NextResponse.json({ runpodJobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Submit failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
