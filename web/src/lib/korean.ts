/** Particles that change with whether the word before them ends in a consonant (받침). */
const PARTICLES = {
  "이/가": ["이", "가"],
  "을/를": ["을", "를"],
  "은/는": ["은", "는"],
  "과/와": ["과", "와"],
} as const;

/** Digits read with a final consonant: 영, 일, 삼, 육, 칠, 팔. */
const DIGITS_WITH_FINAL = "013678";

/** Latin letters whose name, as Korean reads a word ending in them, ends in a consonant. */
const LATIN_WITH_FINAL = "lmn";

/**
 * Whether `word` ends in a consonant as Korean reads it aloud. A Hangul syllable says so itself;
 * a digit or a Latin letter goes by how it is read, so "Codex" takes 가 and "Gemini 3" takes 이.
 * Quotes and other punctuation at the end are skipped.
 */
export function endsInConsonant(word: string): boolean {
  const last = [...word.replace(/[^\p{L}\p{N}]+$/u, "")].at(-1);

  if (last === undefined) return false;

  const code = last.charCodeAt(0);

  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;

  if (/\d/.test(last)) return DIGITS_WITH_FINAL.includes(last);

  return LATIN_WITH_FINAL.includes(last.toLowerCase());
}

/** The form of `particle` that fits after `word`, for when the word is set apart from it. */
export function particle(word: string, which: keyof typeof PARTICLES): string {
  const [afterConsonant, afterVowel] = PARTICLES[which];

  return endsInConsonant(word) ? afterConsonant : afterVowel;
}

/** `word` followed by the form of `particle` that fits it, such as "Codex가" or "영상을". */
export const withParticle = (word: string, which: keyof typeof PARTICLES) =>
  `${word}${particle(word, which)}`;
