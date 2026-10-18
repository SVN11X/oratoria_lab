/**
 * Visemas: formas de la boca asociadas a sonidos. Se derivan del texto en español, porque ni las
 * voces del sistema ni Piper entregan la alineación fonética. Es una aproximación: sincroniza la
 * boca con la duración real del audio, no con cada fonema exacto.
 */
export type Mouth = { open: number; wide: number; round: number };
export type Viseme = 'rest' | 'A' | 'E' | 'I' | 'O' | 'U' | 'MBP' | 'FV' | 'L' | 'S' | 'K';
export const SHAPES: Record<Viseme, Mouth> = {
  rest: { open: 0.02, wide: 0.5, round: 0 },
  A: { open: 0.85, wide: 0.62, round: 0 },
  E: { open: 0.5, wide: 0.82, round: 0 },
  I: { open: 0.28, wide: 0.95, round: 0 },
  O: { open: 0.66, wide: 0.32, round: 0.8 },
  U: { open: 0.34, wide: 0.2, round: 1 },
  MBP: { open: 0, wide: 0.5, round: 0.1 },
  FV: { open: 0.14, wide: 0.62, round: 0 },
  L: { open: 0.36, wide: 0.6, round: 0 },
  S: { open: 0.16, wide: 0.86, round: 0 },
  K: { open: 0.42, wide: 0.55, round: 0 },
};
type Unit = { v: Viseme; w: number; char: number };
export type Track = { units: Unit[]; total: number; starts: number[] };

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
/** Convierte texto en una secuencia de visemas con pesos de duración relativos. */
export function visemeTrack(text: string): Track {
  const t = fold(text);
  const units: Unit[] = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!,
      n = t[i + 1] ?? '';
    let v: Viseme | null = null,
      w = 0.6;
    if ('a'.includes(c)) [v, w] = ['A', 1];
    else if (c === 'e') [v, w] = ['E', 1];
    else if (c === 'i' || (c === 'y' && !/[aeiou]/.test(n))) [v, w] = ['I', 0.9];
    else if (c === 'o') [v, w] = ['O', 1];
    else if (c === 'u') [v, w] = ['U', 0.9];
    else if ('mbpv'.includes(c)) v = 'MBP';
    else if (c === 'f') v = 'FV';
    else if ('sz'.includes(c) || (c === 'c' && /[ei]/.test(n)) || c === 'x') v = 'S';
    else if (c === 'c' && n === 'h') {
      v = 'S';
      i++;
    } else if ('lndtr'.includes(c) || c === 'ñ') v = 'L';
    else if ('kgjqc'.includes(c)) v = 'K';
    else if (c === 'h') continue;
    else if (c === ',' || c === ';' || c === ':') [v, w] = ['rest', 1.4];
    else if (c === '.' || c === '?' || c === '!') [v, w] = ['rest', 2.2];
    else if (/\s/.test(c)) [v, w] = ['rest', 0.25];
    else if (/\d/.test(c)) [v, w] = ['E', 1.6];
    if (!v) continue;
    units.push({ v, w, char: i });
  }
  if (!units.length) units.push({ v: 'rest', w: 1, char: 0 });
  const starts: number[] = [];
  let acc = 0;
  for (const u of units) {
    starts.push(acc);
    acc += u.w;
  }
  return { units, total: acc, starts };
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Forma de la boca en una posición 0–1 del enunciado, con transición suave entre visemas. */
export function sample(track: Track, progress: number): Mouth {
  const x = Math.max(0, Math.min(0.9999, progress)) * track.total;
  let lo = 0,
    hi = track.units.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.starts[mid]! <= x) lo = mid;
    else hi = mid - 1;
  }
  const u = track.units[lo]!,
    next = track.units[lo + 1] ?? u;
  const k = Math.min(1, (x - track.starts[lo]!) / u.w);
  const ease = k < 0.6 ? 0 : (k - 0.6) / 0.4;
  const a = SHAPES[u.v],
    b = SHAPES[next.v];
  return {
    open: lerp(a.open, b.open, ease),
    wide: lerp(a.wide, b.wide, ease),
    round: lerp(a.round, b.round, ease),
  };
}
/** Posición 0–1 correspondiente a un índice de carácter (eventos de palabra de la voz). */
export function progressAtChar(track: Track, charIndex: number): number {
  const i = track.units.findIndex((u) => u.char >= charIndex);
  return i < 0 ? 1 : track.starts[i]! / track.total;
}
/** Duración estimada en segundos para voces que no informan la duración (≈14 caracteres/s). */
export const estimateSeconds = (text: string, rate = 1) => Math.max(0.6, text.length / 14 / rate);
