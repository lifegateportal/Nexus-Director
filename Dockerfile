# Root Dockerfile — delegates to the voice server worker build.
# RunPod GitHub integration looks for a Dockerfile at the repo root by default.
# This simply copies the voice server files and builds from there.

FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-devel

WORKDIR /app

# System dependencies — ffmpeg for audio conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY scripts/voice-server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download XTTS v2 model weights at build time so cold starts are fast.
RUN python -c "from TTS.api import TTS; TTS('tts_models/multilingual/multi-dataset/xtts_v2')"

# Worker code
COPY scripts/voice-server/handler.py .

CMD ["python", "-u", "handler.py"]
