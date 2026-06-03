# ── Nexus Director Voice Worker ───────────────────────────────────────────────
# Base: RunPod PyTorch 2.1 image with CUDA 12.1 (RTX 3090 / A5000 compatible)
FROM runpod/pytorch:2.1.0-py3.10-cuda12.1.1-devel-ubuntu22.04

WORKDIR /app

# System dependencies — ffmpeg for audio conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download XTTS v2 model weights at build time so cold starts are fast.
# This adds ~2 GB to the image but eliminates runtime model downloads.
RUN python -c "from TTS.api import TTS; TTS('tts_models/multilingual/multi-dataset/xtts_v2')"

# Worker code
COPY handler.py .

CMD ["python", "-u", "handler.py"]
