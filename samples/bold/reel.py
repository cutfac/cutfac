"""Bold: a punchy launch spot for a to-do app, black and yellow, cut on the beat at 120 BPM."""

import math
import os
import sys

import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motion import *  # noqa: E402,F403

SECONDS = 16
BEAT = 0.5
BLACK = (14, 14, 16)
YELLOW = (255, 214, 0)
WHITE = (246, 244, 238)
GREY = (120, 120, 126)

COPY = copy_of(__file__)
TITLE = COPY["title"]


def shake(t, start, amount=26):
    p = progress(t, start, 0.25)
    if p >= 1:
        return 0, 0
    k = (1 - p) * amount
    return k * math.sin(t * 90), k * math.cos(t * 70)


def title(img, t):
    p = progress(t, 0.15, 0.35)
    scale = mix(2.6, 1.0, ease_out(p))
    dx, dy = shake(t, 0.5)
    out = progress(t, 2.3, 0.25)
    text(img, (W / 2 + dx, 860 + dy), TITLE, 380, WHITE, "condensed", alpha=p * (1 - out), scale=scale)
    bar = ease_out(progress(t, 0.6, 0.35)) * (1 - out)
    rounded(img, (W / 2 - 330 * bar, 1030, W / 2 + 330 * bar, 1046), 8, YELLOW)
    sub = progress(t, 0.9, 0.3)
    text(img, (W / 2, 1130 + 30 * (1 - ease_out(sub))), COPY["tagline"], 76, YELLOW, "bold", alpha=sub * (1 - out))


def words(img, t):
    for i, word in enumerate(COPY["words"]):
        start = 2.5 + i * 1.0
        p = progress(t, start, 0.2)
        out = progress(t, start + 0.85, 0.15)
        if p <= 0 or out >= 1:
            continue
        wipe = ease_out(progress(t, start, 0.3))
        rounded(img, (0, 900 - 190 * wipe, W, 900 + 190 * wipe), 0, YELLOW if i % 2 == 0 else WHITE, alpha=1 - out)
        dx, dy = shake(t, start + 0.05, 18)
        text(img, (W / 2 + dx, 900 + dy), word, 190, BLACK, "black", alpha=p * (1 - out), scale=mix(1.25, 1.0, ease_out(p)))
    question = progress(t, 5.5, 0.2)
    q_out = progress(t, 6.3, 0.2)
    text(img, (W / 2, 900), COPY["stop"], 170, YELLOW, "black", alpha=question * (1 - q_out), scale=mix(1.2, 1.0, ease_out(question)))


def tasks(img, t):
    start = 6.5
    appear = progress(t, start, 0.3)
    leave = progress(t, 10.2, 0.3)
    if appear <= 0 or leave >= 1:
        return
    shift = -W * ease_in_out(leave)
    text(img, (W / 2 + shift, 600), COPY["today"], 84, GREY, "bold", alpha=appear)
    for i, task in enumerate(COPY["tasks"]):
        y = 820 + i * 220
        row = ease_back(progress(t, start + 0.15 + i * 0.15, 0.4))
        x = mix(W + 200, 170, row) + shift
        rounded(img, (x, y - 80, x + 740, y + 80), 40, (32, 32, 36))
        checked = progress(t, 7.5 + i * BEAT * 2, 0.2)
        box = (x + 50, y - 40, x + 130, y + 40)
        rounded(img, box, 20, YELLOW if checked > 0 else (70, 70, 76))
        if checked > 0:
            text(img, (x + 90, y + 2), "✓", 64, BLACK, alpha=checked, scale=spring(checked))
        color = mix_color(WHITE, GREY, checked)
        text(img, (x + 180, y), task, 68, color, "semibold", anchor="lm", width=520)
        if checked > 0:
            length = min(font(68, "semibold").getlength(task), 520) * ease_out(checked)
            rounded(img, (x + 180, y - 3, x + 180 + length, y + 5), 4, YELLOW)


def counter(img, t):
    p = progress(t, 10.5, 0.3)
    out = progress(t, 12.8, 0.25)
    if p <= 0 or out >= 1:
        return
    step = 0.45
    done = int(clamp((t - 10.9) / step, 0, 3))
    left = 3 - done
    pop = spring(progress(t, 10.9 + done * step, 0.3)) if done > 0 else ease_out(p)
    text(img, (W / 2, 830), str(left), 640, YELLOW, "condensed", alpha=p * (1 - out), scale=max(pop, 0.05))
    text(img, (W / 2, 1250), COPY["left"], 80, WHITE, "bold", alpha=p * (1 - out))


def ending(img, t):
    p = progress(t, 13.0, 0.45)
    if p <= 0:
        return
    r = ease_out(p) * 2300
    circle(img, (W / 2, H / 2), r, YELLOW)
    word = progress(t, 13.35, 0.35)
    text(img, (W / 2, 880), TITLE, 340, BLACK, "condensed", alpha=word, scale=mix(0.7, 1.0, ease_back(word)))
    line = progress(t, 13.7, 0.35)
    text(img, (W / 2, 1100 + 24 * (1 - ease_out(line))), COPY["ending"], 74, BLACK, "bold", alpha=line)


def frame(t):
    img = gradient(BLACK, (24, 24, 28))
    title(img, t)
    words(img, t)
    tasks(img, t)
    counter(img, t)
    ending(img, t)
    return img


def music(path):
    track = np.zeros(int(SECONDS * RATE) + RATE)
    beats = int(SECONDS / BEAT)
    for b in range(beats):
        at = b * BEAT
        if at < 13:
            place(track, kick(), at, 1.0)
            if b % 2 == 1:
                place(track, snap(), at, 0.35)
        place(track, hat(), at + BEAT / 2, 0.25)
        root = [55, 55, 65.4, 49][(b // 4) % 4]
        note = tone(root, BEAT * 0.9, "saw") * envelope(int(RATE * BEAT * 0.9), 0.005, 0.15)
        place(track, note, at, 0.18)
    place(track, kick(1.2), 13.0, 1.3)
    chord = sum(tone(f, 2.8, "sine") for f in (220, 277.2, 329.6, 440))
    place(track, chord * envelope(len(chord), 0.05, 1.5), 13.0, 0.18)
    write_wav(track, path)


if __name__ == "__main__":
    main(__file__, "bold", frame, SECONDS, music)
