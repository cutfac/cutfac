"""Small helpers for drawing a vertical motion graphic frame by frame and writing it with ffmpeg."""

import json
import math
import os
import subprocess
import sys
import tempfile
import wave
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1080, 1920, 30

FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")

# Open-licensed faces (SIL OFL, licenses in fonts/), and a condensed Helvetica that ships with macOS.
FACES = {
    "semibold": ("Pretendard-SemiBold.otf", 0),
    "bold": ("Pretendard-Bold.otf", 0),
    "black": ("Pretendard-Black.otf", 0),
    "batang": ("GowunBatang-Regular.ttf", 0),
    "batang-bold": ("GowunBatang-Bold.ttf", 0),
    "jua": ("Jua.ttf", 0),
    "condensed": ("/System/Library/Fonts/HelveticaNeue.ttc", 9),
}

_fonts = {}


def font(size, weight="bold"):
    key = (int(size), weight)
    if key not in _fonts:
        name, index = FACES[weight]
        _fonts[key] = ImageFont.truetype(os.path.join(FONTS, name), int(size), index=index)
    return _fonts[key]


def copy_of(reel):
    """The words a reel shows, from copy.json beside it."""
    with open(os.path.join(os.path.dirname(os.path.abspath(reel)), "copy.json"), encoding="utf-8") as f:
        return json.load(f)


def main(reel, name, frame, seconds, music):
    """Renders to the path given, or to `[9x16] <name>.mp4` in the video's folder above the code."""
    here = os.path.dirname(os.path.abspath(reel))
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", f"[9x16] {name}.mp4")
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "music.wav")
        music(wav)
        render(frame, seconds, out, wav)


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def progress(t, start, length):
    """How far t is through [start, start + length], from 0 to 1."""
    return clamp((t - start) / length)


def ease_out(p):
    return 1 - (1 - p) ** 3


def ease_in_out(p):
    return 3 * p * p - 2 * p * p * p


def ease_back(p, s=1.7):
    p -= 1
    return p * p * ((s + 1) * p + s) + 1


def spring(p, bounce=0.35):
    """Overshoots and settles, for things that pop in."""
    if p <= 0:
        return 0.0
    if p >= 1:
        return 1.0
    return 1 - math.exp(-6 * p) * math.cos(p * math.pi * (2 + bounce * 6))


def mix(a, b, p):
    return a + (b - a) * p


def mix_color(a, b, p):
    return tuple(int(mix(x, y, p)) for x, y in zip(a, b))


def text(img, xy, words, size, fill, weight="bold", alpha=1.0, scale=1.0, anchor="mm", spacing=1.0, width=W - 120):
    """Draws words centred on xy (by default), scaled and faded as a layer, shrunk to fit `width`."""
    if alpha <= 0 or scale <= 0:
        return
    f = font(size * scale, weight)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    left, _, right, _ = d.multiline_textbbox((0, 0), words, font=f, align="center")
    natural = (right - left) / scale
    if natural > width:
        size = size * width / natural
        f = font(size * scale, weight)
    color = fill if len(fill) == 4 else (*fill, 255)
    color = (*color[:3], int(color[3] * clamp(alpha)))
    d.multiline_text(xy, words, font=f, fill=color, anchor=anchor, align="center", spacing=int(size * 0.18 * spacing))
    img.alpha_composite(layer)


def row(parts, size, weight="bold", gap=0.0):
    """The x centre of each part when they are set side by side, centred on the frame."""
    f = font(size, weight)
    widths = [f.getlength(part) for part in parts]
    x = W / 2 - (sum(widths) + gap * (len(parts) - 1)) / 2
    centres = []
    for w in widths:
        centres.append(x + w / 2)
        x += w + gap
    return centres


def rounded(img, box, radius, fill, alpha=1.0):
    if alpha <= 0:
        return
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    color = fill if len(fill) == 4 else (*fill, 255)
    d.rounded_rectangle(box, radius, fill=(*color[:3], int(color[3] * clamp(alpha))))
    img.alpha_composite(layer)


def circle(img, center, r, fill, alpha=1.0, blur=0):
    if alpha <= 0 or r <= 0:
        return
    pad = int(blur * 3)
    size = int(r * 2 + pad * 2)
    color = fill if len(fill) == 4 else (*fill, 255)
    layer = Image.new("RGBA", (size, size), (*color[:3], 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((pad, pad, pad + 2 * r, pad + 2 * r), fill=(*color[:3], int(color[3] * clamp(alpha))))
    if blur:
        layer = layer.filter(ImageFilter.GaussianBlur(blur))
    img.alpha_composite(layer, (int(center[0] - r - pad), int(center[1] - r - pad)))


def gradient(top, bottom):
    rows = np.linspace(0, 1, H)[:, None]
    arr = np.array(top)[None, :] * (1 - rows) + np.array(bottom)[None, :] * rows
    arr = np.repeat(arr[:, None, :], W, axis=1).astype(np.uint8)
    return Image.fromarray(arr, "RGB").convert("RGBA")


def render(frame, seconds, out, audio=None):
    """Draws every frame with `frame(t)` and writes an H.264 MP4, with `audio` (a WAV path) if given."""
    total = int(seconds * FPS)
    args = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    if audio:
        args += ["-i", audio, "-c:a", "aac", "-b:a", "192k", "-shortest"]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", out]
    ffmpeg = subprocess.Popen(args, stdin=subprocess.PIPE)
    with Pool(os.cpu_count()) as pool:
        for done, data in enumerate(pool.imap(_draw, [(frame, i / FPS) for i in range(total)], chunksize=4)):
            ffmpeg.stdin.write(data)
            if done % FPS == 0:
                print(f"frame {done}/{total}", file=sys.stderr, flush=True)
    ffmpeg.stdin.close()
    if ffmpeg.wait() != 0:
        raise SystemExit("ffmpeg failed")


def _draw(job):
    frame, t = job
    return frame(t).convert("RGB").tobytes()


RATE = 44100


def tone(freq, length, shape="sine"):
    t = np.arange(int(RATE * length)) / RATE
    if shape == "sine":
        return np.sin(2 * np.pi * freq * t)
    if shape == "saw":
        return 2 * ((t * freq) % 1) - 1
    if shape == "square":
        return np.sign(np.sin(2 * np.pi * freq * t))
    raise ValueError(shape)


def envelope(n, attack=0.01, release=0.2):
    a = max(1, int(RATE * attack))
    r = max(1, int(RATE * release))
    env = np.ones(n)
    env[:a] = np.linspace(0, 1, a)
    env[-r:] *= np.linspace(1, 0, r)
    return env


def kick(length=0.35):
    t = np.arange(int(RATE * length)) / RATE
    freq = 120 * np.exp(-t * 18) + 45
    return np.sin(2 * np.pi * np.cumsum(freq) / RATE) * np.exp(-t * 9)


def snap(length=0.15):
    n = int(RATE * length)
    return np.random.default_rng(3).normal(0, 1, n) * np.exp(-np.arange(n) / RATE * 30)


def hat(length=0.05):
    n = int(RATE * length)
    noise = np.random.default_rng(5).normal(0, 1, n)
    return np.diff(noise, prepend=0) * np.exp(-np.arange(n) / RATE * 80) * 0.5


def place(track, sound, at, gain=1.0):
    start = int(at * RATE)
    end = min(len(track), start + len(sound))
    if start < len(track):
        track[start:end] += sound[: end - start] * gain


def write_wav(track, path):
    peak = np.max(np.abs(track)) or 1
    data = (track / peak * 0.85 * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data.tobytes())
