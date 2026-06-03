# Root Dockerfile — RunPod voice worker (XTTS v2)
FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC
# Tell Coqui TTS where to cache models — baked into the image layer
ENV COQUI_TTS_HOME=/app/tts_models
ENV TTS_HOME=/app/tts_models

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg git tzdata && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir TTS[all] runpod soundfile

# Pre-download XTTS v2 model weights into the image so workers start instantly
RUN python -c "
from TTS.api import TTS
TTS('tts_models/multilingual/multi-dataset/xtts_v2', gpu=False)
print('XTTS v2 model cached.')
"

COPY scripts/voice-server/handler.py .

CMD ["python", "-u", "handler.py"]
