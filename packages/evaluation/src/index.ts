import { type Transcript, type Rubric, type Evaluation, type Rating } from '@oratoria/core';

const normalize = (word: string) =>
  word
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/([aeiou])\p{M}+/gu, '$1')
    .normalize('NFC');
export const DEFAULT_FILLERS = ['eh', 'em', 'mmm', 'este', 'o sea', 'digamos', 'bueno'];
const STOP_WORDS = new Set(
  'a al de del el la los las un una unos unas y o en con por para que es se su sus me mi te tu lo no si como porque pero yo nos esto esta eso'.split(
    ' ',
  ),
);
export function analyzeText(transcript: Transcript, audioDuration: number | null, fillers = DEFAULT_FILLERS) {
  const occurrences: { term: string; segmentId: string; start: number | null; quote: string }[] = [];
  const counts = new Map<string, number>();
  let words = 0;
  const dictionary = fillers
    .map((f) => ({ term: f, tokens: normalize(f).match(/[\p{L}\p{N}]+/gu) ?? [] }))
    .filter((f) => f.tokens.length)
    .sort((a, b) => b.tokens.length - a.tokens.length);
  for (const segment of transcript.segments) {
    const tokens = [...segment.text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)].map((m) => ({
      raw: m[0],
      normalized: normalize(m[0]),
      index: m.index,
    }));
    words += tokens.length;
    for (const token of tokens)
      if (!STOP_WORDS.has(token.normalized))
        counts.set(token.normalized, (counts.get(token.normalized) ?? 0) + 1);
    for (let i = 0; i < tokens.length; i++) {
      const match = dictionary.find((f) => f.tokens.every((t, j) => tokens[i + j]?.normalized === t));
      if (match) {
        const end = tokens[i + match.tokens.length - 1]!;
        occurrences.push({
          term: match.term,
          segmentId: segment.id,
          start: segment.start,
          quote: segment.text.slice(tokens[i]!.index, end.index + end.raw.length),
        });
        i += match.tokens.length - 1;
      }
    }
  }
  return {
    method: 'spanish-token-count-1.0.0',
    words,
    wordsPerMinute: audioDuration && audioDuration > 0 && words > 0 ? (words * 60) / audioDuration : null,
    fillerCandidates: occurrences,
    fillersPer100Words: words ? (occurrences.length * 100) / words : null,
    repeatedTerms: [...counts]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15),
  };
}
export function validateRatings(ratings: Rating[], rubric: Rubric, transcript: Transcript): string[] {
  const errors: string[] = [],
    seen = new Set<string>();
  for (const rating of ratings) {
    if (seen.has(rating.criterionId)) errors.push('Hay criterios duplicados.');
    seen.add(rating.criterionId);
    if (!rubric.criteria.some((c) => c.id === rating.criterionId))
      errors.push('El criterio no pertenece a la rúbrica.');
    if (rating.level !== null) {
      if (!rating.note.trim())
        errors.push('Cada nivel puntuado necesita una justificación escrita además de su cita.');
      const segment = transcript.segments.find((s) => s.id === rating.segmentId);
      if (!rating.quote.trim() || !segment?.text.includes(rating.quote.trim()))
        errors.push('Cada valoración necesita una cita exacta de un segmento.');
    }
  }
  return [...new Set(errors)];
}
export function scoreEvaluation(evaluation: Evaluation) {
  const { rubric, ratings } = evaluation;
  let earned = 0,
    evaluatedWeight = 0;
  for (const criterion of rubric.criteria) {
    const rating = ratings.find((r) => r.criterionId === criterion.id);
    if (rating?.level !== null && rating?.level !== undefined) {
      earned += (rating.level / 3) * criterion.weight;
      evaluatedWeight += criterion.weight;
    }
  }
  const total = rubric.criteria.reduce((n, c) => n + c.weight, 0);
  return {
    percent: evaluatedWeight ? (earned / evaluatedWeight) * 100 : null,
    coverage: evaluatedWeight / total,
    evaluatedWeight,
    totalWeight: total,
  };
}
const specs = [
  [
    'general',
    'Oratoria general',
    'Presenta el propósito de la intervención.',
    'Desarrolla las ideas en una secuencia identificable.',
    'Incluye un ejemplo conectado con una idea.',
    'Cierra retomando el propósito.',
  ],
  [
    'tesis',
    'Defensa académica',
    'Identifica problema y objetivo de investigación.',
    'Relaciona decisiones metodológicas con el objetivo.',
    'Sustenta una afirmación con un resultado o evidencia.',
    'Reconoce una limitación y su alcance.',
  ],
  [
    'entrevista',
    'Entrevista laboral',
    'Responde directamente la pregunta.',
    'Describe una situación concreta y su propia acción.',
    'Explica un resultado y cómo lo verificó.',
    'Conecta la experiencia con el cargo.',
  ],
  [
    'exposicion',
    'Exposición educativa',
    'Explicita qué debe aprender la audiencia.',
    'Define los conceptos necesarios antes de utilizarlos.',
    'Explica un ejemplo paso a paso.',
    'Verifica o resume la comprensión.',
  ],
  [
    'argumentacion',
    'Argumentación',
    'Formula una postura identificable.',
    'Presenta una razón vinculada con la postura.',
    'Aporta evidencia para la razón.',
    'Aborda una objeción con una respuesta fundamentada.',
  ],
  [
    'profesional',
    'Comunicación profesional',
    'Identifica la decisión que se necesita tomar.',
    'Distingue datos, interpretación y propuesta.',
    'Explica impacto y límites de la propuesta.',
    'Define un siguiente paso y responsable.',
  ],
] as const;
export const INITIAL_RUBRICS: Rubric[] = specs.map(([id, name, ...indicators]) => ({
  id,
  name,
  version: 1,
  criteria: indicators.map((indicator, i) => ({
    id: `${id}-${i}`,
    name: ['Propósito', 'Desarrollo', 'Evidencia', 'Cierre / alcance'][i]!,
    indicator,
    weight: 25,
    descriptors: [
      'La cita muestra que el indicador no se cumple.',
      'La cita muestra una parte del indicador; la nota identifica lo que falta.',
      'La cita cubre el indicador con un vínculo parcialmente explicitado.',
      'La cita cubre el indicador y explicita el vínculo requerido.',
    ],
  })),
}));
export function coachingNotes(
  audio: { clippingFraction: number; activeSeconds: number; duration: number } | null,
  text: ReturnType<typeof analyzeText> | null,
) {
  const notes: { title: string; evidence: string; exercise: string; method: string }[] = [];
  if (audio?.clippingFraction && audio.clippingFraction > 0.01)
    notes.push({
      title: 'Revisa la captura de audio',
      evidence: `${(audio.clippingFraction * 100).toFixed(1)} % de muestras cerca del límite digital.`,
      exercise: 'Haz una prueba de 20 segundos con menor ganancia o más distancia del micrófono.',
      method: 'DSP: saturación digital; no mide calidad comunicativa.',
    });
  if (audio && audio.activeSeconds / audio.duration < 0.1)
    notes.push({
      title: 'Verifica el umbral y la grabación',
      evidence: 'Se detectó actividad en menos del 10 % del audio.',
      exercise: 'Escucha la grabación y ajusta el umbral antes de interpretar las pausas.',
      method: 'Detector energético; puede perder voz suave.',
    });
  if (text?.fillerCandidates.length)
    notes.push({
      title: 'Escucha los términos señalados en contexto',
      evidence: `${text.fillerCandidates.length} candidatos por coincidencia de palabras.`,
      exercise: 'Escoge un fragmento; ensaya una segunda versión con una pausa donde te resulte útil.',
      method: 'Reglas léxicas; «este» y «bueno» pueden tener un uso legítimo.',
    });
  return notes;
}
