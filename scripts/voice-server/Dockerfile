# ── Nexus Director Voice Worker ───────────────────────────────────────────────
# RunPod is currently scheduling this endpoint onto Blackwell-class GPUs, so
# the image needs a recent PyTorch/CUDA runtime that includes sm_120 support.
FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime

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

# Ensure TTS dependency resolution does not downgrade CUDA-capable torch.
# Keep final torch/torchaudio pinned to cu128 for Blackwell compatibility.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cu128 \
    torch==2.7.1 torchaudio==2.7.1

# Do not bake XTTS weights into the image. It makes the serverless image much
# larger and workers can get stuck initializing before they ever pull a job.
# The model is still lazy-loaded by handler.py on the first synth request.

# Worker code
COPY handler.py .

CMD ["python", "-u", "handler.py"]
