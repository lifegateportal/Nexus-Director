# Root Dockerfile — RunPod voice worker (XTTS v2)
FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git tzdata && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir TTS[all] runpod soundfile

COPY scripts/voice-server/handler.py .

CMD ["python", "-u", "handler.py"]
