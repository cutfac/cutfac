"""Playful: a bouncy spot for a neighbourhood bakery's new cream bun, bright colours and stickers."""

import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motion import *  # noqa: E402,F403

SECONDS = 16
BEAT = 0.5
CREAM = (255, 244, 226)
PINK = (255, 120, 160)
MINT = (92, 214, 180)
BLUE = (92, 140, 255)
BROWN = (92, 56, 40)
BUN = (238, 170, 92)
WHITE = (255, 255, 255)

COPY = copy_of(__file__)
STICKERS = list(zip(COPY["stickers"], [PINK, MINT, BLUE], [-8, 6, -4]))

_rng = np.random.default_rng(7)
DOTS = [(_rng.uniform(0, W), _rng.uniform(0, H), [PINK, MINT, BLUE][i % 3], _rng.uniform(10, 26)) for i in range(28)]


def sticker(img, center, words, bg, fg, angle, scale, size=96):
    if scale <= 0.01:
        return
    f = font(size * scale, "jua")
    left, top, right, bottom = f.getbbox(words)
    pad_x, pad_y = 56 * scale, 34 * scale
    w, h = int(right - left + pad_x * 2), int(bottom - top + pad_y * 2)
    layer = Image.new("RGBA", (w + 24, h + 24), (*bg, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((12, 20, w + 12, h + 20), h / 2, fill=(*BROWN, 70))
    d.rounded_rectangle((12, 12, w + 12, h + 12), h / 2, fill=(*bg, 255), outline=(*WHITE, 255), width=max(2, int(8 * scale)))
    d.text((12 + w / 2, 12 + h / 2), words, font=f, fill=(*fg, 255), anchor="mm")
    layer = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(layer, (int(center[0] - layer.width / 2), int(center[1] - layer.height / 2)))


def confetti(img, t):
    for x, y, color, r in DOTS:
        wobble = math.sin(t * 3 + x * 0.01) * 18
        circle(img, (x + wobble, (y + t * 40) % (H + 80) - 40), r, color, alpha=0.55)


def title(img, t):
    out = progress(t, 2.7, 0.3)
    for i, (syllable, x) in enumerate(zip(COPY["title"], row(COPY["title"], 300, "jua", 20))):
        p = spring(progress(t, 0.2 + i * 0.18, 0.7))
        y = mix(-300, 820, p)
        squash = 1 + 0.12 * math.sin(progress(t, 0.2 + i * 0.18, 0.7) * math.pi * 3) * (1 - progress(t, 0.2 + i * 0.18, 0.9))
        text(img, (x, y), syllable, 300, PINK, "jua", alpha=1 - out, scale=squash * (1 - 0.4 * out))
    sub = ease_out(progress(t, 1.2, 0.4))
    sticker(img, (W / 2, 1120), COPY["tagline"], WHITE, BROWN, -3, spring(progress(t, 1.2, 0.6)) * (1 - out), 64)


def stickers(img, t):
    for i, (words, color, angle) in enumerate(STICKERS):
        start = 3.0 + i * BEAT * 2
        p = spring(progress(t, start, 0.5))
        out = ease_in_out(progress(t, 6.7, 0.3))
        wobble = math.sin((t - start) * 6) * 3
        sticker(img, (W / 2 + (i - 1) * 40, 700 + i * 260), words, color, WHITE, angle + wobble, p * (1 - out), 110)


def bun(img, t):
    start = 7.0
    appear = spring(progress(t, start, 0.6))
    leave = ease_in_out(progress(t, 9.8, 0.3))
    s = appear * (1 - leave)
    if s <= 0.01:
        return
    hop = abs(math.sin((t - start) * math.pi * 2)) * 70 * (1 - leave)
    squash = 1 + 0.08 * math.cos((t - start) * math.pi * 4)
    cx, cy = W / 2, 960 - hop
    w, h = 520 * s * squash, 360 * s / squash
    layer = Image.new("RGBA", img.size, (*BUN, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((cx - w / 2, cy - h / 2 + 30, cx + w / 2, cy + h / 2 + 30), fill=(*BROWN, 50))
    d.ellipse((cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), fill=(*BUN, 255))
    d.ellipse((cx - w * 0.3, cy - h * 0.62, cx + w * 0.3, cy - h * 0.1), fill=(*WHITE, 255))
    blink = 0.15 if (t * 2) % 3 < 0.12 else 1.0
    for side in (-1, 1):
        ex = cx + side * w * 0.17
        d.ellipse((ex - 18 * s, cy + 10 - 22 * s * blink, ex + 18 * s, cy + 10 + 22 * s * blink), fill=(*BROWN, 255))
        d.ellipse((ex + side * 50 * s - 26 * s, cy + 60, ex + side * 50 * s + 26 * s, cy + 84), fill=(*PINK, 140))
    d.arc((cx - 40 * s, cy + 20, cx + 40 * s, cy + 80), 20, 160, fill=(*BROWN, 255), width=max(2, int(10 * s)))
    img.alpha_composite(layer)
    text(img, (W / 2, 1300), COPY["cream"], 72, BROWN, "jua", alpha=ease_out(progress(t, 7.5, 0.4)) * (1 - leave))


def price(img, t):
    start = 10.2
    p = spring(progress(t, start, 0.6))
    out = ease_in_out(progress(t, 12.8, 0.3))
    if p <= 0.01 or out >= 1:
        return
    burst = Image.new("RGBA", img.size, (*MINT, 0))
    d = ImageDraw.Draw(burst)
    spin = t * 25
    points = []
    for k in range(32):
        r = (380 if k % 2 == 0 else 300) * p * (1 - out)
        a = math.radians(spin + k * 360 / 32)
        points.append((W / 2 + r * math.cos(a), 900 + r * math.sin(a)))
    d.polygon(points, fill=(*MINT, 255))
    img.alpha_composite(burst)
    text(img, (W / 2, 880), COPY["price"], 150, WHITE, "jua", alpha=1 - out, scale=p)
    sticker(img, (W / 2 + 160, 1180), COPY["deal"], PINK, WHITE, 8, spring(progress(t, start + 0.5, 0.5)) * (1 - out), 84)


def ending(img, t):
    p = ease_out(progress(t, 13.0, 0.5))
    if p <= 0:
        return
    circle(img, (W / 2, H), p * 2200, PINK)
    for i, (syllable, x) in enumerate(zip(COPY["title"], row(COPY["title"], 260, "jua", 16))):
        q = spring(progress(t, 13.4 + i * 0.15, 0.6))
        text(img, (x, mix(1100, 860, q)), syllable, 260, WHITE, "jua", alpha=clamp(q * 2), scale=max(q, 0.05))
    line = spring(progress(t, 13.9, 0.6))
    sticker(img, (W / 2, 1130), COPY["ending"], WHITE, PINK, -3, line, 68)


def frame(t):
    img = Image.new("RGBA", (W, H), (*CREAM, 255))
    confetti(img, t)
    title(img, t)
    stickers(img, t)
    bun(img, t)
    price(img, t)
    ending(img, t)
    return img


def music(path):
    track = np.zeros(int(SECONDS * RATE) + RATE)
    melody = [523.3, 659.3, 784.0, 659.3, 587.3, 698.5, 880.0, 698.5]
    bass = [130.8, 130.8, 174.6, 196.0]
    for b in range(int(SECONDS / BEAT)):
        at = b * BEAT
        place(track, kick(0.2), at, 0.6 if b % 2 == 0 else 0.3)
        place(track, hat(), at + BEAT / 2, 0.2)
        n = melody[b % len(melody)]
        pluck = tone(n, 0.3, "square") * np.exp(-np.arange(int(RATE * 0.3)) / RATE * 14)
        place(track, pluck, at, 0.06)
        if b % 2 == 0:
            f = bass[(b // 2) % len(bass)]
            note = tone(f, BEAT * 1.8) * envelope(int(RATE * BEAT * 1.8), 0.01, 0.3)
            place(track, note, at, 0.25)
    for at in (0.2, 0.38, 3.0, 4.0, 5.0, 7.0, 10.2, 13.4, 13.55):
        boing = tone(1, 0.25)
        t = np.arange(len(boing)) / RATE
        sweep = np.sin(2 * np.pi * np.cumsum(300 + 500 * np.exp(-t * 12)) / RATE) * np.exp(-t * 10)
        place(track, sweep, at, 0.2)
    write_wav(track, path)


if __name__ == "__main__":
    main(__file__, "playful", frame, SECONDS, music)
