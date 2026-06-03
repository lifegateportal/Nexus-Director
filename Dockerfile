# Root Dockerfile — RunPod voice worker (XTTS v2)
# Uses the slim runtime image (not devel) to stay within build disk limits.
# XTTS v2 model weights download automatically on first cold start (~2 min).

FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

WORKDIR /app

# System dependencies — ffmpeg for audio conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY scripts/voice-server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Worker code
COPY scripts/voice-server/handler.py .

CMD ["python", "-u", "handler.py"]
