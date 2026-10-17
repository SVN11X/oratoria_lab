import { HEDGES, keyTerms, wordCount, countTerms } from './text';

export type Difficulty = 'amable' | 'estandar' | 'exigente';
export type MemberId = 0 | 1 | 2;
export const COMMITTEE = [
  {
    id: 0,
    name: 'Prof. Ana Rojas',
    role: 'Profesora guía',
    focus: 'motivación, objetivos, aporte y claridad para un público general',
    pitch: 1.12,
    rate: 1,
  },
  {
    id: 1,
    name: 'Prof. Diego Muñoz',
    role: 'Profesor informante',
    focus: 'metodología, decisiones técnicas, validación y resultados',
    pitch: 0.82,
    rate: 1.02,
  },
  {
    id: 2,
    name: 'Prof. Carla Soto',
    role: 'Integrante externa',
    focus: 'limitaciones, aplicación real, costos y trabajo futuro',
    pitch: 1,
    rate: 0.97,
  },
] as const;
export const DIFFICULTY_TEXT: Record<Difficulty, string> = {
  amable: 'Amable: preguntas de comprensión, sin presión ni repreguntas insistentes.',
  estandar: 'Estándar: como una comisión real, pide evidencia cuando la respuesta queda incompleta.',
  exigente: 'Exigente: interrumpe, repregunta casi siempre y busca puntos débiles.',
};
export type QuestionKind = 'pregunta' | 'repregunta' | 'interrupcion';
export type PlannedQuestion = {
  member: MemberId;
  text: string;
  kind: QuestionKind;
  source: 'ia' | 'tema' | 'banco' | 'regla';
};
/** Generador pseudoaleatorio reproducible para poder probar las reglas. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const BANK: Record<MemberId, { base: string[]; dificil: string[] }> = {
  0: {
    base: [
      '¿Qué lo motivó a elegir este tema y qué problema concreto resuelve su trabajo?',
      '¿Cuál considera que es el principal aporte de su tesis?',
      'Si tuviera que explicar su trabajo en un minuto a alguien que no es del área, ¿cómo lo haría?',
      '¿Cómo se relacionan sus objetivos específicos con el objetivo general?',
    ],
    dificil: [
      '¿Qué haría distinto si tuviera que empezar este trabajo de nuevo?',
      '¿En qué se diferencia su propuesta de trabajos anteriores sobre el mismo problema?',
    ],
  },
  1: {
    base: [
      '¿Por qué eligió esta metodología y no otra alternativa?',
      '¿Cómo validó que sus resultados son correctos?',
      '¿Qué parámetros o configuraciones fueron más críticos y cómo los ajustó?',
      '¿Qué resultado le parece más sólido y cuál le parece más débil?',
    ],
    dificil: [
      'Si otra persona repite sus pruebas, ¿obtendría los mismos resultados? ¿Cómo lo sabe?',
      '¿Qué supuestos hizo que, si no se cumplen, invalidarían sus conclusiones?',
      '¿Cómo descarta que sus resultados se deban solo a las condiciones particulares de sus pruebas?',
    ],
  },
  2: {
    base: [
      '¿Cuáles son las principales limitaciones de su trabajo?',
      '¿En qué contexto real se podría aplicar lo que desarrolló?',
      '¿Qué trabajo futuro propone y por qué sería el siguiente paso lógico?',
      '¿Qué costo o recursos requeriría llevar su propuesta a un uso real?',
    ],
    dificil: [
      'Si alguien quisiera usar su solución mañana, ¿qué le advertiría antes?',
      '¿Qué pasaría con su propuesta en condiciones más difíciles que las que probó?',
    ],
  },
};
const TERM_TEMPLATES: Record<MemberId, string[]> = {
  0: [
    'Respecto de {t}, ¿por qué es importante para el problema que plantea?',
    '¿Podría explicar {t} con un ejemplo sencillo?',
  ],
  1: [
    '¿Por qué eligió {t} y qué alternativas descartó?',
    '¿Cómo comprobó que {t} funciona como usted espera?',
    '¿Qué parámetros de {t} tuvo que ajustar y cómo decidió sus valores?',
  ],
  2: [
    '¿Qué limitaciones tiene {t} en su trabajo?',
    '¿Qué pasaría con sus resultados si {t} fallara o cambiaran sus condiciones?',
  ],
};
/**
 * Preguntas sin IA: combina un banco fijo por integrante con plantillas que usan términos
 * extraídos del resumen y de lo dicho. Se usa cuando no hay un modelo de lenguaje conectado.
 */
export function fallbackQuestions(options: {
  text: string;
  count: number;
  difficulty: Difficulty;
  seed?: number;
}): PlannedQuestion[] {
  const rng = seeded(options.seed ?? 7),
    terms = keyTerms(options.text, 8),
    count = Math.max(1, Math.min(12, Math.round(options.count)));
  const order: MemberId[] = options.difficulty === 'amable' ? [0, 1, 2] : [1, 2, 0];
  const used = new Set<string>(),
    out: PlannedQuestion[] = [];
  const pools: Record<MemberId, string[]> = { 0: [], 1: [], 2: [] };
  for (const m of [0, 1, 2] as MemberId[])
    pools[m] =
      options.difficulty === 'exigente'
        ? [...BANK[m].dificil, ...BANK[m].base]
        : options.difficulty === 'amable'
          ? [...BANK[m].base]
          : [...BANK[m].base.slice(0, 2), ...BANK[m].dificil.slice(0, 1), ...BANK[m].base.slice(2)];
  let termIndex = 0;
  for (let i = 0; out.length < count && i < count * 4; i++) {
    const member = order[i % 3]!;
    const wantsTerm = termIndex < terms.length && (i % 2 === 0 || options.difficulty === 'exigente');
    let text = '';
    let source: PlannedQuestion['source'] = 'banco';
    if (wantsTerm) {
      const templates = TERM_TEMPLATES[member];
      text = templates[Math.floor(rng() * templates.length)]!.replace('{t}', terms[termIndex++]!);
      source = 'tema';
    } else {
      text = pools[member].find((q) => !used.has(q)) ?? '';
    }
    if (!text || used.has(text)) continue;
    used.add(text);
    out.push({ member, text, kind: 'pregunta', source });
  }
  return out;
}
export function countHedges(text: string) {
  return countTerms([text], HEDGES);
}
/** Repregunta por reglas explícitas: brevedad, expresiones de duda y extensión. */
export function fallbackFollowUp(answer: string, difficulty: Difficulty, rng: () => number): string | null {
  const n = wordCount(answer),
    hedges = countHedges(answer).total;
  if (n < 12 && difficulty !== 'amable')
    return 'Su respuesta fue muy breve. ¿Podría desarrollarla con un ejemplo concreto de su trabajo?';
  if (n < 6) return '¿Podría contarnos un poco más sobre eso?';
  if (difficulty === 'amable') return null;
  if (hedges >= 2)
    return 'Noto algunas dudas en su respuesta. ¿Qué evidencia concreta de su trabajo respalda lo que dice?';
  if (n > 380) return 'Si tuviera que resumir su respuesta en una sola frase, ¿cuál sería?';
  if (difficulty === 'exigente' && rng() < 0.6)
    return rng() < 0.5
      ? '¿Y cómo sabe que eso es correcto? ¿Lo midió o lo comprobó de alguna forma?'
      : 'Entiendo. Pero, ¿qué pasaría si esa decisión hubiera sido distinta?';
  return null;
}
export function fallbackInterruption(recent: string, rng: () => number): string {
  const term = keyTerms(recent, 3)[0];
  if (term)
    return rng() < 0.5
      ? `Disculpe que lo interrumpa. ¿Qué quiere decir exactamente con ${term}?`
      : `Perdón, antes de seguir: ¿por qué es necesario ${term} en su propuesta?`;
  return 'Disculpe que lo interrumpa. ¿Podría explicar mejor la idea que acaba de mencionar?';
}
