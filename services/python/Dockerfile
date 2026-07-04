# Python analyzer sidecar for cue.mith.studio (Phase 1B): BeatNet beat/downbeat
# detection behind a small FastAPI service. Phase 3 adds a section-detection
# endpoint to the same image.
#
# Note: madmom (a BeatNet dependency) is unmaintained and does not build cleanly
# on Python 3.11; it is happiest on 3.9 with numpy<1.24, so we pin 3.9 here
# despite the plan's nominal 3.11.
FROM python:3.9-slim

# ffmpeg: decode/resample. build toolchain + libsndfile: madmom Cython exts +
# soundfile. portaudio19-dev: builds pyaudio, which BeatNet hard-imports at module
# top (for its realtime mic mode — unused here, but the import must resolve).
# git: some BeatNet deps install from source.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg build-essential gcc g++ libsndfile1 portaudio19-dev git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# numpy + cython must be present BEFORE madmom builds its extensions, and torch
# must come from the CPU wheel index (the default pulls a multi-GB CUDA build).
RUN pip install --no-cache-dir numpy==1.23.5 cython==0.29.36 \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.2.2

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    # numba/librosa pin numpy down to 1.20.x after madmom first builds, leaving
    # madmom's Cython extensions compiled against the wrong numpy ABI ("ndarray
    # size changed"). Recompile madmom from source against the *settled* numpy.
    && pip install --no-cache-dir --no-binary madmom --force-reinstall --no-deps madmom==0.16.1

COPY app.py ./

# Non-root (HANDOVER safety rail: the sidecar must not run as root).
RUN useradd -u 1000 -m analyzer
USER 1000:1000

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
