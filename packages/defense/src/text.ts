import type { Transcript } from '@oratoria/core';
import { analyzeText } from '@oratoria/evaluation';

const TOKEN = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;
export function normalize(word: string): string {
  return word
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/([aeiou])\p{M}+/gu, '$1')
    .normalize('NFC');
}
export function words(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((m) => m[0]);
}
export function wordCount(text: string): number {
  return words(text).length;
}
/** Palabras frecuentes sin contenido propio. Se comparan ya normalizadas (sin tildes). */
export const STOP_WORDS = new Set(
  'a al ante bajo con contra de del desde durante e el ella ellas ellos en entre era eran es esa esas ese eso esos esta estas este esto estos fue fueron ha han hay la las le les lo los mas me mi mis muy ni no nos o os para pero poco por porque que quien se ser si sin sobre son su sus tambien te tiene tienen todo todos tu un una unas uno unos y ya yo usted ustedes como cual cuales cuando donde mientras aunque entonces asi aqui ahi alli cada otro otra otros otras mismo misma puede pueden podemos poder hacer hace hecho hacemos tenemos tener estar estamos esta estan siendo sido segun luego despues antes ademas primero segundo tercero siguiente parte partes forma manera caso casos tipo tipos cosa cosas momento vez veces vamos voy van bien bueno digamos sea eh em mmm gracias buenos buenas dias tardes noches comision profesor profesora profesores trabajo tesis proyecto capitulo presentacion diapositiva objetivo objetivos general importante realizar utilizar mediante traves respecto nuestro nuestra nuestros nuestras dentro fuera menos tanto tanta algunos algunas alguno alguna mucho mucha muchos muchas'.split(
    ' ',
  ),
);
const ACRONYM = /^(?:[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9]{1,6}|[A-Z][a-z]+[A-Z][A-Za-z0-9]*)$/u;
const isNumber = (s: string) => /^\d+$/.test(s);
/**
 * Extrae términos del tema (siglas, expresiones de dos palabras y palabras largas repetidas).
 * Es un conteo de frecuencias; no interpreta el significado del texto.
 */
export function keyTerms(text: string, limit = 8): string[] {
  const tokens = [...text.matchAll(TOKEN)].map((m) => ({ raw: m[0], norm: normalize(m[0]) }));
  const minCount = tokens.length > 120 ? 2 : 1;
  const stats = new Map<string, { count: number; weight: number; shapes: Map<string, number> }>();
  const display = (raw: string) => (ACRONYM.test(raw) ? raw : raw.toLocaleLowerCase('es'));
  const add = (norm: string, shape: string, weight: number) => {
    const entry = stats.get(norm) ?? { count: 0, weight, shapes: new Map<string, number>() };
    entry.count++;
    entry.shapes.set(shape, (entry.shapes.get(shape) ?? 0) + 1);
    stats.set(norm, entry);
  };
  const content = (t: { raw: string; norm: string } | undefined, min = 4) =>
    !!t && !STOP_WORDS.has(t.norm) && !isNumber(t.norm) && (t.norm.length >= min || ACRONYM.test(t.raw));
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!content(t, 3)) continue;
    if (ACRONYM.test(t.raw)) add(t.norm, t.raw, 3);
    else if (t.norm.length >= 6) add(t.norm, display(t.raw), 1);
    const next = tokens[i + 1],
      third = tokens[i + 2];
    if (content(next) && content(t))
      add(`${t.norm} ${next!.norm}`, `${display(t.raw)} ${display(next!.raw)}`, 1.7);
    else if (next && (next.norm === 'de' || next.norm === 'del') && content(third) && content(t))
      add(
        `${t.norm} ${next.norm} ${third!.norm}`,
        `${display(t.raw)} ${next.norm} ${display(third!.raw)}`,
        1.7,
      );
  }
  const ranked = [...stats]
    .filter(([norm, s]) => s.count >= (s.weight === 3 ? 1 : minCount) && norm.length > 2)
    .map(([norm, s]) => ({
      norm,
      score: s.count * s.weight,
      shape: [...s.shapes].sort((a, b) => b[1] - a[1])[0]![0],
    }))
    .sort((a, b) => b.score - a.score || b.norm.length - a.norm.length);
  const chosen: { norm: string; shape: string }[] = [];
  for (const candidate of ranked) {
    const parts = candidate.norm.split(' ');
    const overlaps = chosen.some((c) => {
      const other = c.norm.split(' ');
      return parts.some((p) => p.length > 3 && other.includes(p));
    });
    if (!overlaps) chosen.push(candidate);
    if (chosen.length >= limit) break;
  }
  return chosen.map((c) => c.shape);
}
/** Expresiones que suelen transmitir duda. Son candidatos: pueden ser prudencia legítima. */
export const HEDGES = [
  'creo que',
  'no sé',
  'tal vez',
  'quizás',
  'a lo mejor',
  'más o menos',
  'supongo',
  'no estoy seguro',
  'no estoy segura',
  'podría ser',
  'me parece que',
  'como que',
  'no me acuerdo',
];
export function asTranscript(texts: string[]): Transcript {
  return {
    source: 'manual',
    language: 'es',
    model: null,
    revision: 1,
    updatedAt: new Date(0).toISOString(),
    segments: texts.map((text, i) => ({ id: `s${i}`, text, start: null, end: null })),
  };
}
export function countTerms(texts: string[], terms: string[]) {
  const result = analyzeText(asTranscript(texts), null, terms);
  const byTerm = new Map<string, number>();
  for (const o of result.fillerCandidates) byTerm.set(o.term, (byTerm.get(o.term) ?? 0) + 1);
  return {
    words: result.words,
    total: result.fillerCandidates.length,
    per100: result.fillersPer100Words,
    byTerm: [...byTerm].sort((a, b) => b[1] - a[1]),
  };
}
export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}
