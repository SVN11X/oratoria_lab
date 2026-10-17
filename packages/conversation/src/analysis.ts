import { countHedges, normalize, STOP_WORDS, words } from '@oratoria/defense';
import type { AnswerAnalysis, AnswerType, RetrievedChunk, ScenarioId } from './types';

/** Palabras propias de las preguntas que no indican el tema. */
const QUESTION_WORDS = new Set(
  'usted ustedes podria puede explique explicar describa describir diga cual cuales como por que porque quiere decir respecto sobre trabajo tesis concreto concreta especifico especifica principal principales realmente exactamente entonces brevemente cuenteme cuentame hableme queda claro deberiamos seria haria hizo tiene tenia sostiene afirma indica plantea senala considera'.split(
    ' ',
  ),
);
const fold = (s: string) => normalize(s).replace(/[^\p{L}\p{N} %.,]+/gu, ' ');

/** Términos de contenido normalizados (sin tildes ni palabras vacías). */
export function contentTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(text)) {
    const n = normalize(w);
    if (n.length < 4 || STOP_WORDS.has(n) || QUESTION_WORDS.has(n) || /^\d+$/.test(n)) continue;
    out.add(stem(n));
  }
  return out;
}
/** Raíz muy simple para comparar formas como «resultado» y «resultados». */
export function stem(w: string): string {
  return w
    .replace(/(amientos|imientos|aciones|uciones|amiento|imiento|mente)$/, '')
    .replace(/(acion|ucion|ciones|cion|idad|ables|ibles|able|ible)$/, '')
    .replace(/(es|s)$/, '')
    .replace(/[aeo]$/, '');
}
/** Similitud de Jaccard entre los términos de contenido de dos textos (0–1). */
export function similarity(a: string, b: string): number {
  const A = contentTerms(a),
    B = contentTerms(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
/** Proporción de términos de la pregunta presentes en la respuesta. */
export function overlap(question: string, answer: string): number {
  const Q = contentTerms(question),
    A = contentTerms(answer);
  if (Q.size < 2) return 0.5;
  let hit = 0;
  for (const q of Q) if (A.has(q)) hit++;
  return hit / Q.size;
}

const RX = {
  repeat:
    /\b(puede|podria|podrias|puedes|me) (repetir|reformular|repite|repetirme)\b|\bno (escuche|alcance a escuchar)\b|\b(a que se refiere|que quiere decir|me la repite|la pregunta de nuevo)\b/,
  notUnderstand: /\bno (entiendo|entendi|comprendo|comprendi)( bien)?( la pregunta| lo que| a que)?\b/,
  limitation:
    /\b(limitacion|limitaciones|no se considero|no consideramos|no considere|no alcanzamos|no alcance|queda pendiente|quedo pendiente|reconozco|una debilidad|no fue posible|fuera del alcance|no se pudo|no logramos|no logre)\b/,
  justification:
    /\b(porque|ya que|debido a|dado que|puesto que|por eso|por lo tanto|la razon|se debe a|con el fin de|para que|por esa razon|esto permite|lo que permite)\b/,
  evidence:
    /\b(resultado|resultados|datos|medimos|medi|medicion|mediciones|tabla|figura|grafico|segun|referencia|estudio|experimento|pruebas|prueba|ensayo|ensayos|comparamos|compare|obtuvimos|obtuve|se obtuvo|evidencia|registro|registramos|validamos|valide|error|precision|porcentaje)\b/,
  example:
    /\b(por ejemplo|como ejemplo|un ejemplo|en el caso de|imaginemos|imagina|es como|similar a|pensemos en|un caso)\b/,
  generic:
    /\b(es importante|depende|en general|es complejo|hay muchos factores|como dije|es relativo|de alguna manera|en cierto modo|basicamente)\b/,
  method:
    /\b(elegimos|elegi|seleccione|seleccionamos|se eligio|descartamos|descarte|alternativa|alternativas|en lugar de|comparado con|frente a|criterio)\b/,
};
const ABSOLUTES = [
  'siempre',
  'nunca',
  'todos',
  'nadie',
  'sin duda',
  'obviamente',
  'claramente',
  'evidentemente',
  'es imposible',
  'la mejor',
  'el mejor',
  'perfecto',
  'perfectamente',
  'totalmente',
  'completamente seguro',
];
const SCENARIO_MARKERS: Record<ScenarioId, [string, RegExp][]> = {
  tesis: [['justifica metodología', RX.method]],
  entrevista: [
    [
      'situación',
      /\b(cuando|en mi (trabajo|practica|empresa)|en el proyecto|en (la|una) empresa|habia|teniamos|en ese momento)\b/,
    ],
    ['tarea', /\b(mi (tarea|rol|responsabilidad|objetivo)|tenia que|debia|me encargaron|me pidieron)\b/],
    [
      'acción',
      /\b(decidi|hice|implemente|organice|propuse|desarrolle|lidere|coordine|converse|analice|cree|automatice|diseñe|disene)\b/,
    ],
    [
      'resultado',
      /\b(logramos|logre|resultado|redujimos|reduje|aumentamos|aumente|mejoramos|mejore|ahorramos|ahorre|conseguimos|consegui|aprendi)\b/,
    ],
  ],
  presentacion: [
    ['decisión explícita', /\b(propongo|recomiendo|les pido|solicito|aprobar|aprobemos|la decision)\b/],
    ['costo o beneficio', /\b(costo|cuesta|inversion|ahorro|retorno|beneficio|presupuesto)\b/],
  ],
  debate: [
    [
      'refuta',
      /\b(sin embargo|no obstante|al contrario|eso no es|discrepo|el argumento contrario|se dice que|aunque)\b/,
    ],
    ['postura explícita', /\b(sostengo|mi postura|estoy a favor|estoy en contra|defiendo)\b/],
  ],
  educativa: [
    ['define', /\b(es un|es una|significa|se define|consiste en|se refiere a)\b/],
    ['ejemplifica', RX.example],
    [
      'comprueba comprensión',
      /\b(se entiende|queda claro|alguna duda|me explico|en otras palabras|lo resumo|te hace sentido|tiene sentido)\b/,
    ],
  ],
  dificil: [
    [
      'mensaje en primera persona',
      /\b(yo (siento|necesito|pienso|quisiera|me siento)|me (preocupa|afecta|gustaria|importa)|necesito)\b/,
    ],
    [
      'hechos concretos',
      /\b(el (lunes|martes|miercoles|jueves|viernes)|la semana pasada|ayer|en la reunion|el dia|\d+ (veces|dias|horas))\b/,
    ],
    [
      'reconoce la perspectiva',
      /\b(entiendo|comprendo|tiene sentido|me imagino|tienes razon|tiene razon|valoro|reconozco)\b/,
    ],
    ['propone', /\b(propongo|podriamos|que te parece|acordemos|sugiero|que tal si)\b/],
    [
      'acuerdo verificable',
      /\b(para el|antes del|cada semana|plazo|fecha|revisemos|nos juntamos|el proximo)\b/,
    ],
    [
      'juicio sobre la persona',
      /\b(irresponsable|flojo|floja|desordenado|desordenada|no te importa|tu culpa|eres un|eres una)\b/,
    ],
  ],
};

export type NumericClaim = { value: number; unit: string; raw: string; context: Set<string> };
const UNIT =
  /^(%|por ?ciento|cm|mm|m|km|s|ms|seg|segundos|minutos|min|h|horas|hz|khz|mhz|ghz|kg|g|v|a|w|mw|kw|°|grados|db|fps|ppm|mb|gb|clp|usd|pesos|dolares|veces|personas|participantes|casos|muestras)$/;
/** Cifras con su unidad y palabras cercanas, para comparar lo dicho con el material. */
export function numericClaims(text: string): NumericClaim[] {
  const t = fold(text).replace(/(\d)\s*%/g, '$1 %');
  const tokens = t.split(/\s+/).filter(Boolean);
  const out: NumericClaim[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const m = /^(\d+(?:[.,]\d+)?)[.,]?$/.exec(tokens[i]!);
    if (!m) continue;
    const value = Number(m[1]!.replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    let unit = '';
    const next = (tokens[i + 1] ?? '').replace(/[.,]$/, '');
    if (UNIT.test(next)) unit = next === 'por' || next.startsWith('por') ? '%' : next;
    if (tokens[i + 1] === 'por' && tokens[i + 2]?.startsWith('ciento')) unit = '%';
    if (!unit && value >= 1900 && value <= 2100) continue; // años
    if (!unit) continue;
    const ctx = new Set<string>();
    for (let j = Math.max(0, i - 6); j <= Math.min(tokens.length - 1, i + 6); j++) {
      if (j === i) continue;
      const w = tokens[j]!.replace(/[.,]/g, '');
      if (w.length >= 5 && !STOP_WORDS.has(w) && !/^\d/.test(w)) ctx.add(stem(w));
    }
    out.push({ value, unit, raw: `${m[1]} ${unit}`.trim(), context: ctx });
  }
  return out;
}
/**
 * Cifras dichas que no coinciden con ninguna cifra del material sobre el mismo asunto.
 * Es conservador: exige unidad igual, contexto compartido y una diferencia mayor al 10 %.
 */
export function numericContradictions(answer: string, chunks: RetrievedChunk[]) {
  const said = numericClaims(answer);
  const found: AnswerAnalysis['contradictions'] = [];
  for (const s of said) {
    const candidates = chunks.flatMap((c) =>
      numericClaims(c.text)
        .filter((d) => d.unit === s.unit && [...d.context].some((w) => s.context.has(w)))
        .map((d) => ({ d, c })),
    );
    if (!candidates.length) continue;
    const close = candidates.some(
      ({ d }) => Math.abs(d.value - s.value) <= Math.max(0.02 * Math.abs(d.value), 0.05),
    );
    if (close) continue;
    const { d, c } = candidates.sort(
      (a, b) =>
        [...b.d.context].filter((w) => s.context.has(w)).length -
        [...a.d.context].filter((w) => s.context.has(w)).length,
    )[0]!;
    const rel = Math.abs(d.value - s.value) / Math.max(Math.abs(d.value), 1e-6);
    if (rel > 0.1 && Math.abs(d.value - s.value) > 0.5)
      found.push({ said: s.raw, source: d.raw, location: `${c.docName}, ${c.location}` });
  }
  return found;
}

export function analyzeAnswer(input: {
  question: string;
  answer: string;
  scenario: ScenarioId;
  area?: string | null;
  retrieved?: RetrievedChunk[];
}): AnswerAnalysis {
  const text = input.answer.trim();
  const n = words(text).length;
  const f = ` ${fold(text)} `;
  const ov = overlap(input.question, text);
  const justification = RX.justification.test(f);
  const evidence = RX.evidence.test(f) || /\d/.test(text);
  const example = RX.example.test(f);
  const hedges = countHedges(text).total;
  const absolutes = ABSOLUTES.filter((a) => f.includes(` ${a} `));
  const limitation = RX.limitation.test(f);
  const contradictions = input.retrieved?.length ? numericContradictions(text, input.retrieved) : [];
  const markers = SCENARIO_MARKERS[input.scenario].filter(([, rx]) => rx.test(f)).map(([name]) => name);
  const notes: string[] = [];
  let type: AnswerType;
  if (n < 3) type = 'sin_respuesta';
  else if (RX.repeat.test(f) && n < 30) type = 'pide_reformulacion';
  else if (RX.notUnderstand.test(f) && n < 30) type = 'no_comprende';
  else if (contradictions.length) type = 'contradice_documento';
  else if (limitation && (input.area === 'limitaciones' || ov >= 0.25) && n >= 8)
    type = 'reconoce_limitacion';
  else if (ov < 0.12 && n > 15 && !evidence) type = 'evade';
  else if ((absolutes.length && !evidence) || (n >= 12 && !justification && !evidence && !example))
    type = 'sin_sustento';
  else if ((justification || evidence) && (evidence || example) && ov >= 0.25 && n >= 25) type = 'correcta';
  else type = 'parcial';
  if (RX.generic.test(f) && type === 'parcial') notes.push('Usa expresiones generales sin concretar.');
  if (n > 250) notes.push('Respuesta muy extensa.');
  if (n > 0 && n < 15 && type !== 'sin_respuesta') notes.push('Respuesta muy breve.');
  if (hedges >= 2) notes.push(`${hedges} expresiones de duda.`);
  if (absolutes.length) notes.push(`Afirmaciones absolutas: ${absolutes.join(', ')}.`);
  if (markers.includes('juicio sobre la persona'))
    notes.push('Incluye un juicio sobre la persona en lugar de un hecho.');
  return {
    type,
    words: n,
    overlap: Math.round(ov * 100) / 100,
    justification,
    evidence,
    example,
    hedges,
    absolutes,
    limitation,
    contradictions,
    markers,
    notes,
    generator: 'reglas',
  };
}

/** Calidad aproximada de una respuesta (0–1) para regular la presión progresiva. */
export function answerScore(type: AnswerType): number {
  return {
    correcta: 1,
    reconoce_limitacion: 0.75,
    parcial: 0.5,
    pide_reformulacion: 0.4,
    no_comprende: 0.3,
    sin_sustento: 0.3,
    contradice_documento: 0.2,
    evade: 0.15,
    sin_respuesta: 0,
  }[type];
}
export const ANSWER_TYPE_TEXT: Record<AnswerType, string> = {
  correcta: 'Respuesta completa',
  parcial: 'Respuesta parcial',
  no_comprende: 'No comprendió la pregunta',
  contradice_documento: 'Contradice el documento',
  sin_sustento: 'Afirmación sin sustento',
  reconoce_limitacion: 'Reconoce una limitación',
  pide_reformulacion: 'Pidió reformular',
  evade: 'Se desvió de la pregunta',
  sin_respuesta: 'Sin respuesta',
};
