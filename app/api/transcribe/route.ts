import { createClient } from "@deepgram/sdk";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 120; // large files can take time

export async function POST(request: NextRequest) {
  if (!env.DEEPGRAM_API_KEY) {
    return NextResponse.json(
      { error: "DEEPGRAM_API_KEY not configured" },
      { status: 503 }
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "audio/mpeg";

    const deepgram = createClient(env.DEEPGRAM_API_KEY);

    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      buffer,
      {
        model: "nova-3",
        smart_format: true,
        punctuate: true,
        paragraphs: true,
        utterances: false,
        language: "en",
        mimetype: mimeType,
      }
    );

    if (error) throw new Error(error.message ?? "Deepgram error");

    const transcript =
      result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    if (!transcript.trim()) {
      return NextResponse.json(
        { error: "Deepgram returned an empty transcript" },
        { status: 422 }
      );
    }

    return NextResponse.json({ transcript }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Transcription failed", detail: message },
      { status: 500 }
    );
  }
}
