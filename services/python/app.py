"""
Python analyzer sidecar for cue.mith.studio (Phase 1B).

A small FastAPI service that runs BeatNet over an audio file and returns accurate
beats + downbeats + meter. The Node worker calls `POST /analyze/rhythm` with a
presigned S3 GET URL (so this container never holds AWS credentials).

Best-effort by contract: the worker treats any non-2xx / malformed response as
"no rhythm" and keeps its aubio-derived tempo, so failing soft here is fine.
"""
import os
import subprocess
import tempfile
from statistics import median

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="markers-analyzer")

# BeatNet loads a torch model; build it once and reuse across requests. Import
# lazily so the service still starts (and /healthz works) if the heavy ML stack
# is mid-install or broken — /analyze/rhythm then 503s and the worker degrades.
_estimator = None
_estimator_err = None


def get_estimator():
    global _estimator, _estimator_err
    if _estimator is not None or _estimator_err is not None:
        return _estimator
    try:
        from BeatNet.BeatNet import BeatNet  # noqa: WPS433 (lazy import on purpose)

        # mode='offline' + DBN = highest accuracy, non-realtime (batch worker).
        _estimator = BeatNet(1, mode="offline", inference_model="DBN", plot=[], thread=False)
    except Exception as exc:  # pragma: no cover - environment dependent
        _estimator_err = str(exc)
        _estimator = None
    return _estimator


class RhythmRequest(BaseModel):
    audioUrl: str


@app.get("/healthz")
def healthz():
    return {"ok": True, "model": _estimator is not None, "modelError": _estimator_err}


@app.post("/analyze/rhythm")
def analyze_rhythm(req: RhythmRequest):
    est = get_estimator()
    if est is None:
        return _err(503, f"beat model unavailable: {_estimator_err}")

    src = None
    wav = None
    try:
        src = _download(req.audioUrl)
        wav = _to_wav(src)
        # BeatNet.process returns an ndarray of [time_sec, beat_position] rows,
        # where beat_position is 1..meter and 1 marks a downbeat.
        out = est.process(wav)
        return _summarize(out)
    except Exception as exc:
        return _err(500, str(exc))
    finally:
        for p in (src, wav):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass


def _download(url: str) -> str:
    fd, path = tempfile.mkstemp(prefix="mk_", suffix=".media")
    os.close(fd)
    with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_bytes(1 << 16):
                f.write(chunk)
    return path


def _to_wav(src: str) -> str:
    """Decode to mono 22.05k wav — a safe lowest-common-denominator for madmom."""
    fd, path = tempfile.mkstemp(prefix="mk_", suffix=".wav")
    os.close(fd)
    subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "22050", path],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=300,
    )
    return path


def _summarize(out):
    beats = []
    downbeats = []
    max_pos = 0
    for row in out:
        t = float(row[0])
        pos = int(round(float(row[1]))) if len(row) > 1 else 0
        beats.append(t)
        if pos > max_pos:
            max_pos = pos
        if pos == 1:
            downbeats.append(t)

    bpm = _bpm_from_beats(beats)
    meter = f"{max_pos}/4" if max_pos in (2, 3, 4, 5, 6, 7) else None

    return {
        "bpm": bpm,
        "confidence": _regularity(beats),
        "meter": meter,
        "beats": beats,
        "downbeats": downbeats,
        "firstDownbeatSec": downbeats[0] if downbeats else None,
    }


def _bpm_from_beats(beats):
    if len(beats) < 2:
        return None
    ibis = [b - a for a, b in zip(beats, beats[1:]) if b > a]
    if not ibis:
        return None
    m = median(ibis)
    return round(60.0 / m, 2) if m > 0 else None


def _regularity(beats):
    """Beat-interval regularity in [0,1] = 1 - cv(ibi), mirrors the aubio path."""
    if len(beats) < 3:
        return None
    ibis = [b - a for a, b in zip(beats, beats[1:]) if b > a]
    if len(ibis) < 2:
        return None
    mean = sum(ibis) / len(ibis)
    if mean <= 0:
        return None
    var = sum((x - mean) ** 2 for x in ibis) / len(ibis)
    std = var ** 0.5
    return max(0.0, min(1.0, 1.0 - std / mean))


def _err(status, message):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=status, content={"error": message})
