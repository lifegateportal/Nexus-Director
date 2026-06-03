# ── Nexus Director Voice Worker ───────────────────────────────────────────────
# Keep the serverless image as small as possible so queued jobs can actually
# acquire a healthy worker instead of stalling during repeated cold starts.
FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

WORKDIR /app

ENV COQUI_TOS_AGREED=1

# System dependencies — ffmpeg for audio conversion, libsndfile for soundfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Do not bake XTTS weights into the image. It makes the serverless image much
# larger and workers can get stuck initializing before they ever pull a job.
# The model is still lazy-loaded by handler.py on the first synth request.

# Worker code
COPY handler.py .

CMD ["python", "-u", "handler.py"]
