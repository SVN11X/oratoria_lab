import { normalize, STOP_WORDS, words } from '@oratoria/defense';

/** Raíz muy simple para comparar formas como «resultado» y «resultados». */
export function stem(w: string): string {
  return w
    .replace(/(amientos|imientos|aciones|uciones|amiento|imiento|mente)$/, '')
    .replace(/(acion|ucion|ciones|cion|idad|ables|ibles|able|ible)$/, '')
    .replace(/(es|s)$/, '')
    .replace(/[aeo]$/, '');
}
/** Tokens de búsqueda: minúsculas, sin tildes, sin palabras vacías y con raíz. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const w of words(text)) {
    const n = normalize(w);
    if (n.length < 2 || STOP_WORDS.has(n)) continue;
    if (/^\d+$/.test(n)) {
      if (n.length >= 2) out.push(n);
      continue;
    }
    out.push(stem(n));
  }
  return out;
}

export type NumericClaim = { value: number; unit: string; raw: string; context: Set<string> };
const UNIT =
  /^(%|cm|mm|m|km|s|ms|seg|segundos|minutos|min|h|horas|hz|khz|mhz|ghz|kg|g|v|a|w|mw|kw|°|grados|db|fps|ppm|mb|gb|clp|usd|pesos|dolares|veces|personas|participantes|casos|muestras|pruebas|ensayos)$/;
const fold = (s: string) => normalize(s).replace(/[^\p{L}\p{N} %.,°]+/gu, ' ');
/** Cifras con su unidad y palabras cercanas, para comparar textos entre sí. */
export function numericClaims(text: string): NumericClaim[] {
  const t = fold(text)
    .replace(/(\d)\s*%/g, '$1 %')
    .replace(/(\d)°/g, '$1 °');
  const tokens = t.split(/\s+/).filter(Boolean);
  const out: NumericClaim[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const m = /^(\d+(?:[.,]\d+)?)[.,]?$/.exec(tokens[i]!);
    if (!m) continue;
    const value = Number(m[1]!.replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    let unit = '';
    const next = (tokens[i + 1] ?? '').replace(/[.,]$/, '');
    if (UNIT.test(next)) unit = next;
    if (next === 'por' && tokens[i + 2]?.startsWith('ciento')) unit = '%';
    if (!unit) continue;
    const ctx = new Set<string>();
    for (let j = Math.max(0, i - 6); j <= Math.min(tokens.length - 1, i + 6); j++) {
      if (j === i || j === i + 1) continue;
      const w = tokens[j]!.replace(/[.,]/g, '');
      if (w.length >= 5 && !STOP_WORDS.has(w) && !/^\d/.test(w)) ctx.add(stem(w));
    }
    out.push({ value, unit, raw: `${m[1]} ${unit}`, context: ctx });
  }
  return out;
}
/** Similitud de Jaccard entre conjuntos de tokens. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}
