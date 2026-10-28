// Helpers for a motion graphic drawn on a canvas as a pure function of time, so any frame can be
// drawn on its own: render.mjs seeks to each one in turn, and a browser plays it in real time.

export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

/** How far `t` is through [start, start + length], from 0 to 1. */
export const progress = (t, start, length) => clamp((t - start) / length);

export const mix = (a, b, p) => a + (b - a) * p;

export const ease = {
  out: (p) => 1 - (1 - p) ** 3,
  in: (p) => p ** 3,
  inOut: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  outExpo: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
  inExpo: (p) => (p <= 0 ? 0 : 2 ** (10 * p - 10)),
  outBack: (p, s = 1.7) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2,
};

/** A spring's step response: overshoots and settles, for things that pop into place. */
export function spring(p, bounce = 0.35) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return 1 - Math.exp(-6 * p) * Math.cos(p * Math.PI * (2 + bounce * 6));
}

/** `#rrggbb` mixed toward another by `p`, as a CSS colour. */
export function mixColor(a, b, p) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return `rgb(${x.map((v, i) => Math.round(mix(v, y[i], p))).join(",")})`;
}

/** A repeatable number in [0, 1) for `n`, for scattering things the same way in every frame. */
export const hash = (n) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Sets the canvas font; `stretch` is a CSS keyword such as "expanded" for a variable font. */
export function font(ctx, size, family, weight = 400, stretch = "normal") {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fontStretch = stretch;
  return ctx;
}

/**
 * Draws `words` centred on (x, y) unless `align` says otherwise, scaled about that point, stretched
 * across by `wide`, and shrunk to fit `width`.
 */
export function text(ctx, words, x, y, o = {}) {
  const { size = 80, family = "Pretendard", weight = 700, stretch = "normal", color = "#fff" } = o;
  const { alpha = 1, scale = 1, align = "center", tracking = 0, width = 980, rotate = 0 } = o;
  const { wide = 1 } = o;
  if (alpha <= 0 || scale <= 0 || words === "") return;
  ctx.save();
  font(ctx, size, family, weight, stretch);
  ctx.letterSpacing = `${tracking}px`;
  const natural = ctx.measureText(words).width * wide;
  const fit = natural > width ? width / natural : 1;
  ctx.translate(x, y);
  ctx.rotate(rotate);
  ctx.scale(scale * fit * wide, scale * fit);
  ctx.globalAlpha *= clamp(alpha);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(words, 0, 0);
  ctx.restore();
}

/** The width `words` take at a size, for laying out letters or lines by hand. */
export function measure(ctx, words, o = {}) {
  const { size = 80, family = "Pretendard", weight = 700, stretch = "normal", tracking = 0 } = o;
  ctx.save();
  font(ctx, size, family, weight, stretch);
  ctx.letterSpacing = `${tracking}px`;
  const width = ctx.measureText(words).width;
  ctx.restore();
  return width;
}

export function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Starts a video: fetches the words in copy.json, waits for the fonts, then hands render.mjs
 * `seek(t)` and `soundtrack()`. In a plain browser it plays itself on a loop instead.
 */
export async function start({ width = 1080, height = 1920, fps = 30, seconds, name, fonts, draw, sound }) {
  const canvas = document.querySelector("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const copy = await fetch("copy.json").then((response) => response.json());
  await Promise.all(fonts.map((face) => document.fonts.load(face)));

  window.VIDEO = { width, height, fps, seconds, name };
  window.seek = (t) => {
    ctx.reset();
    draw(ctx, t, copy);
  };
  window.soundtrack = () => renderSound(seconds, (audio) => sound(audio, copy));
  window.ready = true;

  if (navigator.webdriver) return;
  const began = performance.now();
  const loop = () => {
    window.seek(((performance.now() - began) / 1000) % seconds);
    requestAnimationFrame(loop);
  };
  loop();
}

const RATE = 44100;

/** The soundtrack as 16-bit stereo PCM in base64, rendered offline by the page's Web Audio. */
async function renderSound(seconds, build) {
  const audio = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
  const master = audio.createDynamicsCompressor();
  master.threshold.value = -12;
  master.ratio.value = 4;
  master.connect(audio.destination);
  build(sounds(audio, master));
  const buffer = await audio.startRendering();
  const [l, r] = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const pcm = new Int16Array(l.length * 2);
  for (let i = 0; i < l.length; i++) {
    pcm[i * 2] = clamp(l[i], -1, 1) * 32767;
    pcm[i * 2 + 1] = clamp(r[i], -1, 1) * 32767;
  }
  let binary = "";
  const bytes = new Uint8Array(pcm.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { rate: RATE, channels: 2, pcm: btoa(binary) };
}

/** Small synthesised instruments, each placed at a time in seconds. */
function sounds(audio, out) {
  const noise = audio.createBuffer(1, RATE, RATE);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const env = (at, gain, attack, decay, peak = 1) => {
    const g = audio.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak * gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(out);
    return g;
  };

  const tone = (at, freq, { gain = 0.2, type = "sine", attack = 0.005, decay = 0.4, to } = {}) => {
    const o = audio.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + attack + decay);
    o.connect(env(at, gain, attack, decay));
    o.start(at);
    o.stop(at + attack + decay + 0.05);
  };

  const hiss = (at, { gain = 0.2, decay = 0.08, filter = "highpass", freq = 7000, to, q = 0.7 } = {}) => {
    const s = audio.createBufferSource();
    s.buffer = noise;
    const f = audio.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, at);
    f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, at + decay);
    s.connect(f);
    f.connect(env(at, gain, 0.003, decay));
    s.start(at);
    s.stop(at + decay + 0.05);
  };

  return {
    tone,
    hiss,
    kick: (at, gain = 0.9) => tone(at, 140, { gain, decay: 0.35, to: 42 }),
    snare: (at, gain = 0.35) => {
      hiss(at, { gain, decay: 0.16, filter: "bandpass", freq: 1800, q: 0.8 });
      tone(at, 220, { gain: gain * 0.5, decay: 0.08, to: 140 });
    },
    hat: (at, gain = 0.12) => hiss(at, { gain, decay: 0.04 }),
    whoosh: (at, length = 0.5, gain = 0.25) =>
      hiss(at, { gain, decay: length, filter: "bandpass", freq: 300, to: 6000, q: 1.2 }),
    pluck: (at, freq, gain = 0.12) => tone(at, freq, { gain, type: "triangle", decay: 0.35 }),
    pop: (at, gain = 0.25) => tone(at, 900, { gain, decay: 0.09, to: 300 }),
    chord: (at, freqs, length, gain = 0.06) =>
      freqs.forEach((f) =>
        ["sine", "triangle"].forEach((type, i) =>
          tone(at, f * (i ? 2.003 : 1), { gain: gain * (i ? 0.35 : 1), type, attack: length * 0.35, decay: length * 0.65 }),
        ),
      ),
  };
}
