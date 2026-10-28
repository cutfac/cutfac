"""Calm: a slow, soft spot for a breathing app, dusk colours and long fades."""

import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motion import *  # noqa: E402,F403

SECONDS = 18
TOP = (247, 214, 196)
BOTTOM = (176, 168, 214)
INK = (64, 56, 92)
SOFT = (255, 250, 246)

COPY = copy_of(__file__)

BLOBS = [
    ((255, 186, 160), 420, (0.2, 0.25), 0.11),
    ((198, 178, 255), 480, (0.85, 0.55), 0.08),
    ((255, 226, 190), 360, (0.35, 0.85), 0.13),
]

_sprites = {}


def blob(color, r):
    key = (color, r)
    if key not in _sprites:
        pad = 360
        layer = Image.new("RGBA", (r * 2 + pad * 2, r * 2 + pad * 2), (*color, 0))
        ImageDraw.Draw(layer).ellipse((pad, pad, pad + 2 * r, pad + 2 * r), fill=(*color, 130))
        _sprites[key] = layer.filter(ImageFilter.GaussianBlur(150))
    return _sprites[key]


_background = None


def background(t):
    global _background
    if _background is None:
        _background = gradient(TOP, BOTTOM)
    img = _background.copy()
    for color, r, (x, y), speed in BLOBS:
        sprite = blob(color, r)
        cx = W * x + 120 * math.sin(t * speed * 2 * math.pi)
        cy = H * y + 160 * math.cos(t * speed * 1.6 * math.pi)
        img.alpha_composite(sprite, (int(cx - sprite.width / 2), int(cy - sprite.height / 2)))
    return img


def fade(t, start, length=0.9, hold=None):
    """In over `length`, then out over `length` once `hold` seconds have passed."""
    a = ease_in_out(progress(t, start, length))
    if hold is not None:
        a *= 1 - ease_in_out(progress(t, start + length + hold, length))
    return a


def title(img, t):
    a = fade(t, 0.3, 1.2, 1.4)
    rise = 40 * (1 - ease_out(progress(t, 0.3, 1.6)))
    text(img, (W / 2, 820 + rise), COPY["title"], 360, INK, "batang", alpha=a)
    sub = fade(t, 1.1, 1.0, 1.0)
    text(img, (W / 2, 1110 + rise), COPY["tagline"], 62, INK, "batang", alpha=sub * 0.85)


def breathing(img, t):
    start, end = 3.6, 8.6
    a = fade(t, start, 0.8, end - start - 1.6)
    if a <= 0:
        return
    cycle = (t - start) / 2.5
    swell = 0.5 - 0.5 * math.cos(cycle * 2 * math.pi)
    r = mix(150, 330, swell)
    circle(img, (W / 2, 900), r + 60, SOFT, alpha=a * 0.25, blur=30)
    circle(img, (W / 2, 900), r, SOFT, alpha=a * 0.55)
    inhale = (cycle % 1) < 0.5
    word = COPY["in"] if inhale else COPY["out"]
    phase = (cycle % 0.5) / 0.5
    word_alpha = a * math.sin(phase * math.pi)
    text(img, (W / 2, 900), word, 84, INK, "batang", alpha=word_alpha)


def steps(img, t):
    for i, line in enumerate(COPY["steps"]):
        start = 8.9 + i * 0.9
        a = fade(t, start, 0.8) * (1 - ease_in_out(progress(t, 12.3, 0.8)))
        drift = 30 * (1 - ease_out(progress(t, start, 1.2)))
        text(img, (W / 2, 760 + i * 170 + drift), line, 76, INK, "batang", alpha=a)


def timer(img, t):
    start = 13.0
    a = fade(t, start, 0.8) * (1 - ease_in_out(progress(t, 15.4, 0.7)))
    if a <= 0:
        return
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    box = (W / 2 - 260, 640, W / 2 + 260, 1160)
    d.ellipse(box, outline=(*SOFT, int(140 * a)), width=14)
    sweep = 360 * ease_in_out(progress(t, start + 0.4, 2.0))
    d.arc(box, -90, -90 + sweep, fill=(*INK, int(230 * a)), width=14)
    img.alpha_composite(layer)
    text(img, (W / 2, 880), "5:00", 150, INK, "batang", alpha=a)
    text(img, (W / 2, 1010), COPY["timer"], 52, INK, "batang", alpha=a * 0.8)


def ending(img, t):
    a = fade(t, 15.8, 1.2)
    if a <= 0:
        return
    text(img, (W / 2, 840), COPY["title"], 300, INK, "batang", alpha=a)
    line = fade(t, 16.4, 1.0)
    text(img, (W / 2, 1100), COPY["ending"], 64, INK, "batang", alpha=line * 0.9)


def frame(t):
    img = background(t)
    title(img, t)
    breathing(img, t)
    steps(img, t)
    timer(img, t)
    ending(img, t)
    return img


def music(path):
    track = np.zeros(int(SECONDS * RATE) + RATE)
    chords = [(196.0, 246.9, 293.7, 392.0), (174.6, 220.0, 261.6, 349.2), (164.8, 207.7, 246.9, 329.6), (174.6, 220.0, 293.7, 349.2)]
    for i in range(5):
        chord = chords[i % len(chords)]
        pad = sum(tone(f, 4.6) + 0.3 * tone(f * 2.001, 4.6) for f in chord)
        place(track, pad * envelope(len(pad), 1.4, 1.8), i * 3.8, 0.12)
    rng = np.random.default_rng(11)
    for k in range(22):
        at = 0.6 + k * 0.8 + rng.uniform(-0.1, 0.1)
        f = rng.choice([587.3, 659.3, 784.0, 880.0, 987.8])
        bell = tone(f, 1.6) * np.exp(-np.arange(int(RATE * 1.6)) / RATE * 3)
        place(track, bell, at, 0.05)
    write_wav(track, path)


if __name__ == "__main__":
    main(__file__, "calm", frame, SECONDS, music)
