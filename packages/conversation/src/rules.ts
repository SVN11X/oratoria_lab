import { keyTerms, normalize, words } from '@oratoria/defense';
import { similarity } from './analysis';
import { DIFFICULTIES, STAGES, TEMPERAMENTS, pick, reactionFor, stageIndex, styleQuestion } from './personas';
export { openerOf } from './personas';
import type {
  AnswerAnalysis,
  AreaDef,
  Citation,
  Participant,
  RetrievedChunk,
  ScenarioDef,
  Stage,
} from './types';

export const usesTu = (s: ScenarioDef) => s.id === 'dificil' || s.id === 'educativa';
const T = (s: ScenarioDef, usted: string, tu: string) => (usesTu(s) ? tu : usted);

/** Etapa que corresponde a la pregunta principal número `index` (desde 0) de un total. */
export function stageFor(
  index: number,
  total: number,
  participant: Participant,
  progressive: boolean,
  performance: number | null,
  rng: () => number,
): Stage {
  const d = DIFFICULTIES[participant.difficulty];
  const min = stageIndex(d.minStage),
    max = stageIndex(d.maxStage);
  let i: number;
  if (progressive) {
    const f = total <= 1 ? 1 : index / (total - 1);
    i = f < 0.15 ? 0 : f < 0.4 ? 1 : f < 0.6 ? 2 : f < 0.8 ? 3 : f < 0.95 ? 4 : 5;
    if (performance !== null && index > 0) {
      if (performance > 0.75) i += 1;
      else if (performance < 0.35) i -= 1;
    }
    if (index === total - 1 && total > 2) i = Math.max(i, 4);
  } else i = min + Math.floor(rng() * (Math.min(max, 4) - min + 1));
  return STAGES[Math.max(min, Math.min(max, i))]!;
}

/** Orden de turnos: quien preside pregunta al final de cada ronda. */
export function speakerOrder(participants: Participant[], scenario: ScenarioDef): Participant[] {
  const chairId = scenario.roles.find((r) => r.chair)?.id;
  const chair = participants.filter((p) => p.roleId === chairId),
    rest = participants.filter((p) => p.roleId !== chairId);
  return rest.length ? [...rest, ...chair] : chair;
}
export function chairOf(participants: Participant[], scenario: ScenarioDef): Participant {
  const chairId = scenario.roles.find((r) => r.chair)?.id;
  return participants.find((p) => p.roleId === chairId) ?? participants[0]!;
}

/** Elige el área menos cubierta del interlocutor, priorizando las que tienen material relacionado. */
export function chooseArea(
  participant: Participant,
  scenario: ScenarioDef,
  covered: Map<string, number>,
  relevance: Map<string, number> | null,
  rng: () => number,
  position: { index: number; total: number } = { index: 0, total: 1 },
): AreaDef {
  const last = position.index >= position.total - 1,
    late = position.index >= position.total / 2;
  const allowed = (a: AreaDef) => !a.when || (a.when === 'final' ? last : late);
  const own = scenario.areas.filter((a) => participant.areas.includes(a.id) && allowed(a));
  const finalArea = last ? own.find((a) => a.when === 'final') : undefined;
  if (finalArea && !(covered.get(finalArea.id) ?? 0)) return finalArea;
  const pool = own.length ? own : scenario.areas.filter(allowed);
  const score = (a: AreaDef) =>
    (covered.get(a.id) ?? 0) * 10 - (relevance ? Math.min(5, relevance.get(a.id) ?? 0) : 0) + rng() * 0.5;
  return [...pool].sort((a, b) => score(a) - score(b))[0]!;
}

const CLAIM_MARKERS =
  /\b(se obtuvo|se obtuvieron|obtuvimos|resultado|resultados|permite|permitio|logra|logro|se logro|precision|error|exactitud|mejora|reduce|aumenta|se utilizo|se utilizaron|se implemento|se diseno|se eligio|se selecciono|mediante|metodologia|limitacion|no se considero|se asume|supuesto|concluye|conclusion|demuestra|muestra que|propone|objetivo)\b/;
/** Qué tipo de afirmación necesita cada plantilla citada, para no preguntar por «esa cifra» sin cifra. */
const AREA_CLAIM: Record<string, RegExp> = {
  problematizacion: /\b(problema|necesidad|dificultad|desafio|carencia|actualmente)\b/,
  pregunta: /\b(pregunta|interrogante|se busca responder|hipotesis)\b/,
  objetivos: /\b(objetivo|se busca|pretende|tiene como fin|proposito)\b/,
  hipotesis: /\b(se asume|supuesto|suponemos|se supone|hipotesis|asumimos)\b/,
  justificacion: /\b(aporte|contribucion|permite|relevancia|importancia|beneficio)\b/,
  marco: /\b(se define|definicion|concepto|se entiende por|teoria|modelo)\b/,
  estado_arte: /\b(trabajos|autores|estudios|propuesto por|literatura|frente a|comparado)\b/,
  diseno:
    /\b(se utilizo|se utilizaron|se implemento|se diseno|se eligio|se selecciono|mediante|metodologia|frente a|en lugar de|etapa)\b/,
  muestreo: /\b(\d+ (pruebas|ensayos|casos|muestras|participantes|repeticiones|escenarios)|muestra)\b/,
  instrumentos: /\b(sensor|instrumento|herramienta|software|equipo|camara|encuesta|lidar)\b/,
  validez: /\b(error|precision|exactitud|validacion|repetibilidad|confiabilidad|desviacion)\b/,
  analisis: /\b(analisis|se calculo|metrica|promedio|desviacion|comparacion|estadistic)\b/,
  resultados: /\b(resultado|resultados|se obtuvo|obtuvimos|logro|alcanzo|fue de|muestran que)\b/,
  discusion: /\b(se interpreta|indica que|sugiere|se explica|en comparacion|a diferencia)\b/,
  limitaciones: /\b(limitacion|no se considero|no fue posible|restriccion|fuera del alcance|no se evaluo)\b/,
  implicancias: /\b(aplicacion|industria|uso real|implementacion|costo|permitiria)\b/,
  recomendaciones: /\b(se recomienda|trabajo futuro|como mejora|proximos pasos|se propone)\b/,
  referencias: /\b(segun|propuesto por|et al|autor|referencia)\b/,
};
/** Las plantillas que hablan de «esa cifra» exigen un número en la cita. */
const needsNumber = (template: string) => /cifra|muestra representativa/.test(template);
const LEAD_INS =
  /^(los resultados (muestran|indican) que|se observa que|cabe (destacar|mencionar) que|es importante (mencionar|destacar) que|en este trabajo|en esta tesis|por otro lado,?|ademas,?)\s+/i;

/** Frase más «discutible» de un fragmento: con cifras o marcadores de resultado, método o límite. */
export function claimSentence(text: string, areaId?: string): string | null {
  const want = areaId ? AREA_CLAIM[areaId] : undefined;
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9])/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 320 && words(s).length >= 7);
  let best: { s: string; score: number } | null = null;
  for (const s of sentences) {
    const n = normalize(s);
    let score = 0;
    if (/\d/.test(s)) score += 2;
    if (CLAIM_MARKERS.test(n)) score += 2;
    if (s.length >= 60 && s.length <= 220) score += 1;
    if (/^(figura|tabla|fuente|ver )/i.test(s)) score -= 3;
    if (want) score += want.test(n) ? 3 : -4;
    if (!best || score > best.score) best = { s, score };
  }
  return best && best.score >= 2 ? best.s : null;
}
/** Acorta una cita en un límite de palabra, sin cortar a mitad y sin muletillas de redacción. */
export function shortQuote(s: string, max = 120): string {
  let t = s
    .replace(/\s+/g, ' ')
    .replace(/[.;]+$/, '')
    .trim();
  const lead = LEAD_INS.exec(t);
  if (lead) t = t.slice(lead[0].length);
  t =
    t.charAt(0).toLocaleLowerCase('es') === t.charAt(0)
      ? t
      : /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(t)
        ? t.charAt(0).toLocaleLowerCase('es') + t.slice(1)
        : t;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 60))}…`;
}
/** Ubicación legible en voz alta: «en la página 41, sección 3.2 Metodología». */
export function spokenLocation(location: string): string {
  return location
    .replace(/\bpágs?\.\s*/gi, 'la página ')
    .replace(/\bdiap\.\s*/gi, 'la diapositiva ')
    .replace(/\s*·\s*/g, ', sección ')
    .replace(/sección (\d+(?:\.\d+)*)\s/, 'sección $1, ');
}
const docLabel = (name: string) => {
  const base = name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return /^tu exposici/i.test(base) ? 'su exposición' : `el documento «${base}»`;
};
/** Une «de» + «el documento» como «del documento». */
const de = (label: string) => (label.startsWith('el ') ? `del ${label.slice(3)}` : `de ${label}`);
/** Pone en minúscula la primera letra tras un prefijo como «En pocas palabras:». */
const afterPrefix = (prefix: string, q: string) =>
  prefix.endsWith(':')
    ? `${prefix} ${q.replace(/^[A-ZÁÉÍÓÚÑ]/, (m) => m.toLocaleLowerCase('es'))}`
    : `${prefix} ${q}`;
const toCitation = (c: RetrievedChunk, excerpt?: string): Citation => ({
  docId: c.docId,
  docName: c.docName,
  chunkId: c.chunkId,
  location: c.location,
  excerpt: excerpt ?? shortQuote(c.excerpt || c.text, 240),
});

const INTEGRATIVE: Record<string, string[]> = {
  tesis: [
    'Para cerrar: ¿cómo se conectan su problema de investigación, su metodología y su conclusión principal en un solo argumento?',
    'En dos minutos: ¿qué demuestra su trabajo, con qué evidencia y hasta dónde llega esa demostración?',
  ],
  entrevista: [
    'Para terminar: ¿por qué usted es la persona adecuada para este cargo, en tres razones concretas?',
  ],
  presentacion: [
    'Para cerrar: resuma su recomendación, su principal riesgo y el siguiente paso en una sola respuesta.',
  ],
  debate: ['Cierre: ¿por qué su postura resiste mejor los contraargumentos que escuchó?'],
  educativa: ['Para terminar, ¿podrías resumir todo en una idea que podamos recordar?'],
  dificil: ['Entonces, ¿qué acordamos exactamente y cómo lo vamos a revisar?'],
};

/** Pregunta principal por reglas: plantilla del área, material citado y estilo del temperamento. */
export function ruleQuestion(input: {
  participant: Participant;
  scenario: ScenarioDef;
  stage: Stage;
  area: AreaDef;
  chunks: RetrievedChunk[];
  topic: string;
  asked: string[];
  weak: { area: string; question: string; answer: string }[];
  rng: () => number;
  lastOpener?: string;
}): { text: string; core: string; sources: Citation[]; reason: string } {
  const { participant: p, scenario: s, stage, area, rng } = input;
  const style = (q: string) =>
    styleQuestion(q, p.temperament, rng, { tu: usesTu(s), last: input.lastOpener });
  const fresh = (q: string) => !input.asked.some((a) => similarity(a, q) >= 0.6);
  const fill = (q: string) => q.replaceAll('{tema}', input.topic || 'su trabajo');
  if (stage === 'integracion') {
    const q = (INTEGRATIVE[s.id] ?? INTEGRATIVE.tesis!).find(fresh);
    if (q)
      return {
        text: style(q),
        core: q,
        sources: [],
        reason: 'Etapa integradora: relaciona todo lo conversado.',
      };
  }
  const weak = input.weak.find((w) => p.areas.includes(w.area) || w.area === area.id);
  if (weak && (stage === 'inconsistencias' || stage === 'objeciones') && rng() < 0.6) {
    const q = T(
      s,
      `Vuelvo a un punto anterior. Cuando se le preguntó «${shortQuote(simplify(weak.question).replace(/[¿?]/g, ''), 80)}», usted respondió «${shortQuote(weak.answer, 80)}». ¿Qué evidencia concreta sostiene esa respuesta?`,
      `Vuelvo a algo que dijiste: «${shortQuote(weak.answer, 90)}». ¿Qué hay concretamente detrás de eso?`,
    );
    if (fresh(q))
      return {
        text: style(q),
        core: q,
        sources: [],
        reason: 'Retoma una respuesta débil anterior para buscar inconsistencias.',
      };
  }
  const tier =
    stage === 'introduccion' || stage === 'fundamentos'
      ? area.base
      : stage === 'inconsistencias' || stage === 'objeciones'
        ? area.deep
        : area.extreme;
  if (input.chunks.length && area.grounded.length && stage !== 'introduccion') {
    for (const c of input.chunks) {
      const claim = claimSentence(c.text, area.id);
      if (!claim) continue;
      const quote = shortQuote(claim);
      const templates = area.grounded.filter((t) => !needsNumber(t) || /\d/.test(quote));
      if (!templates.length) continue;
      const where =
        c.docId === 'exposicion'
          ? `En ${docLabel(c.docName)}`
          : `En ${spokenLocation(c.location)} ${de(docLabel(c.docName))},`;
      const q = pick(templates, rng)
        .replaceAll('{cita}', quote)
        .replaceAll('{ubicacion}', where)
        .replace(/,\s*,/g, ',');
      if (fresh(q))
        return {
          text: style(q),
          core: q,
          sources: [toCitation(c, quote)],
          reason: `Basada en una afirmación del material (${c.location}).`,
        };
    }
  }
  const options = [...tier, ...area.base, ...area.deep].map(fill).filter(fresh);
  let q = options.length
    ? pick(tier.map(fill).filter(fresh).length ? tier.map(fill).filter(fresh) : options, rng)
    : '';
  if (!q) {
    const term = keyTerms(input.chunks.map((c) => c.text).join(' ') || input.topic, 3)[0];
    q = term
      ? T(
          s,
          `¿Qué papel cumple ${term} en su trabajo y por qué es necesario?`,
          `¿Qué papel tiene ${term} en esto?`,
        )
      : T(
          s,
          `¿Qué aspecto de ${area.name.toLowerCase()} considera más débil en su trabajo?`,
          '¿Qué parte de esto te preocupa más?',
        );
  }
  if (stage === 'sintesis') q = afterPrefix(T(s, 'Responda en menos de un minuto.', 'En pocas palabras:'), q);
  return {
    text: style(q),
    core: q,
    sources: [],
    reason: `Área «${area.name}», etapa de ${stage}.`,
  };
}

/** Repregunta por reglas a partir del análisis de la respuesta. Devuelve null si no corresponde. */
export function ruleFollowUp(input: {
  analysis: AnswerAnalysis;
  question: string;
  answer: string;
  participant: Participant;
  scenario: ScenarioDef;
  rng: () => number;
  /** Descarta variantes ya usadas; la primera aceptada se devuelve. */
  fresh?: (text: string) => boolean;
}): { text: string; reason: string } | null {
  const { analysis: a, participant: p, scenario: s, rng } = input;
  const fresh = input.fresh ?? (() => true);
  const strict =
    p.temperament === 'exigente' || p.temperament === 'desafiante' || p.temperament === 'esceptico';
  const core = input.question;
  const first = (reason: string, options: string[]) => {
    const start = Math.floor(rng() * options.length);
    for (let k = 0; k < options.length; k++) {
      const t = options[(start + k) % options.length]!;
      if (fresh(t)) return { text: t, reason };
    }
    return null;
  };
  const both = (usted: string[], tu: string[]) => (usesTu(s) ? tu : usted);
  switch (a.type) {
    case 'pide_reformulacion':
    case 'no_comprende':
      return { text: reformulation(core, undefined, s), reason: 'Pidió aclarar la pregunta.' };
    case 'sin_respuesta':
      return first(
        'No hubo respuesta.',
        both(
          ['¿Quiere que le reformule la pregunta?', '¿Necesita que la plantee de otra manera?'],
          ['¿Quieres que te lo pregunte de otra forma?', '¿Te lo digo de otra manera?'],
        ),
      );
    case 'contradice_documento': {
      const c = a.contradictions[0]!;
      return first(
        'La cifra dicha no coincide con el material.',
        both(
          [
            `Usted mencionó ${c.said}, pero en ${c.location} aparece ${c.source}. ¿Cuál es el valor correcto y a qué se debe la diferencia?`,
            `Me dice ${c.said}, pero su propio documento indica ${c.source} (${c.location}). Explique esa diferencia.`,
          ],
          [`Dijiste ${c.said}, pero en ${c.location} aparece ${c.source}. ¿Cuál es?`],
        ),
      );
    }
    case 'sin_sustento':
      return first(
        'Afirmación sin respaldo.',
        both(
          [
            ...(a.absolutes.length
              ? [`Usted afirma «${a.absolutes[0]}». ¿Qué evidencia concreta lo demuestra?`]
              : []),
            '¿En qué dato o resultado de su trabajo se apoya esa afirmación?',
            'Eso es una afirmación fuerte. ¿Cómo la comprobó?',
            'Si un evaluador externo le pidiera la prueba de eso, ¿qué le mostraría?',
          ],
          [
            ...(a.absolutes.length ? [`Dices «${a.absolutes[0]}». ¿Cómo lo sabes?`] : []),
            '¿En qué te basas para decir eso?',
            '¿Tienes algún ejemplo de eso?',
          ],
        ),
      );
    case 'evade':
      return first(
        'La respuesta se alejó de la pregunta.',
        both(
          [
            afterPrefix('Volvamos a la pregunta:', core),
            afterPrefix('Eso no responde lo que pregunté.', core),
            afterPrefix('Le repito la pregunta:', simplify(core)),
          ],
          [
            afterPrefix('Volvamos a lo que te pregunté:', core),
            afterPrefix('Te pregunto de nuevo:', simplify(core)),
          ],
        ),
      );
    case 'reconoce_limitacion':
      return strict || p.difficulty === 'experta' || p.difficulty === 'extrema'
        ? first(
            'Profundiza en la limitación reconocida.',
            both(
              [
                '¿Cuánto afecta esa limitación a sus conclusiones y cómo la abordaría?',
                'Si esa limitación es real, ¿qué parte de sus conclusiones sigue siendo válida?',
              ],
              ['¿Y cómo lo resolverías?', '¿Qué harías para que no vuelva a pasar?'],
            ),
          )
        : null;
    default:
      break;
  }
  const specific = scenarioFollowUp(a, s, input.answer);
  if (specific && fresh(specific.text)) return specific;
  if (a.type === 'parcial') {
    if (!a.justification)
      return first(
        'Faltó justificar.',
        both(
          [
            '¿Por qué? ¿Qué lo llevó a esa decisión?',
            '¿Cuál fue el criterio para decidir eso?',
            'Explíqueme la razón detrás de esa respuesta.',
          ],
          ['¿Por qué?', '¿Y por qué lo ves así?'],
        ),
      );
    if (!a.evidence)
      return first(
        'Faltó evidencia.',
        both(
          [
            '¿Qué evidencia de su trabajo respalda eso?',
            '¿Tiene un resultado o dato que lo muestre?',
            '¿Cómo lo demostró en su trabajo?',
          ],
          ['¿Tienes algún ejemplo concreto?', '¿Cómo lo sabes?'],
        ),
      );
    if (!a.example)
      return first(
        'Faltó un ejemplo.',
        both(
          [
            '¿Puede darme un ejemplo concreto de su trabajo?',
            'Deme un caso concreto, por favor.',
            '¿Dónde se ve eso en su trabajo?',
          ],
          ['¿Me das un ejemplo?', '¿Cuándo pasó eso?'],
        ),
      );
    if (a.words > 200)
      return first(
        'Respuesta extensa.',
        both(
          ['Resúmalo en una sola frase, por favor.', '¿Cuál es la idea central, en una frase?'],
          ['¿Lo puedes decir en una frase?'],
        ),
      );
    return first(
      'Respuesta incompleta.',
      both(
        ['¿Podría precisar un poco más?', '¿Qué le faltó decir para responder completamente?'],
        ['¿Puedes precisar un poco más?'],
      ),
    );
  }
  if (
    a.type === 'correcta' &&
    strict &&
    (p.difficulty === 'avanzada' || p.difficulty === 'experta' || p.difficulty === 'extrema')
  ) {
    const term = keyTerms(input.answer, 3)[0];
    return first(
      'Respuesta completa: profundiza con un escenario alternativo.',
      both(
        [
          ...(term
            ? [`Bien. ¿Y qué pasaría con su conclusión si ${term} cambiara de forma importante?`]
            : []),
          '¿Y en qué condiciones dejaría de ser válida esa respuesta?',
          'Supongamos que sus condiciones de prueba hubieran sido más difíciles. ¿Qué cambiaría?',
        ],
        [...(term ? [`¿Y qué pasa si ${term} cambia?`] : []), '¿Y cuándo no funcionaría?'],
      ),
    );
  }
  return null;
}
function scenarioFollowUp(
  a: AnswerAnalysis,
  s: ScenarioDef,
  answer: string,
): { text: string; reason: string } | null {
  const has = (m: string) => a.markers.includes(m);
  if (s.id === 'entrevista' && a.words >= 15) {
    if (!has('acción'))
      return {
        text: '¿Qué hizo usted específicamente en esa situación?',
        reason: 'Faltó la acción en el ejemplo (STAR).',
      };
    if (!has('resultado'))
      return {
        text: '¿Y cuál fue el resultado? ¿Lo puede cuantificar?',
        reason: 'Faltó el resultado (STAR).',
      };
  }
  if (s.id === 'dificil') {
    if (has('juicio sobre la persona'))
      return {
        text: 'Eso suena a un juicio sobre mí. ¿Qué pasó concretamente?',
        reason: 'Juicio en lugar de hecho.',
      };
    if (!has('propone') && a.words >= 20) return { text: '¿Y qué propones?', reason: 'Falta una propuesta.' };
  }
  if (s.id === 'debate' && !has('refuta') && a.words >= 15)
    return {
      text: 'No respondió a mi argumento. ¿Por qué estaría equivocado?',
      reason: 'No refutó el contraargumento.',
    };
  if (s.id === 'educativa' && !has('ejemplifica') && a.words >= 15)
    return { text: '¿Me puede dar un ejemplo?', reason: 'Faltó un ejemplo.' };
  if (
    s.id === 'presentacion' &&
    !has('costo o beneficio') &&
    /cost|inversion|presupuesto|retorno/.test(normalize(answer)) === false &&
    a.type === 'parcial'
  )
    return {
      text: '¿Y cuánto cuesta y cuánto beneficio esperamos?',
      reason: 'Faltaron datos de costo o beneficio.',
    };
  return null;
}
/** Otra forma de preguntar lo mismo: otra plantilla del área o una versión más directa. */
export function reformulation(core: string, area: AreaDef | undefined, s: ScenarioDef): string {
  const alt = area?.base.find((t) => !t.includes('{') && similarity(t, core) < 0.6 && t !== core);
  const lead = T(s, 'Se lo pregunto de otra forma:', 'Te lo pregunto de otra forma:');
  if (alt) return afterPrefix(lead, alt);
  const direct = simplify(core);
  return direct !== core
    ? afterPrefix(lead, direct)
    : afterPrefix(T(s, 'En otras palabras:', 'O sea:'), direct);
}
/** Versión más directa de una pregunta: sin incisos y con la frase interrogativa principal. */
export function simplify(question: string): string {
  const q = question
    .replace(/\([^)]*\)/g, '')
    .replace(/«[^»]{60,}»/g, 'eso')
    .trim();
  const asks = q.match(/¿[^?]+\?/g);
  return asks?.length ? asks[asks.length - 1]! : q;
}

export function ruleInterruption(recent: string, s: ScenarioDef, p: Participant, rng: () => number): string {
  const term = keyTerms(recent, 3)[0];
  const polite =
    p.temperament === 'desafiante' || p.temperament === 'exigente'
      ? T(s, 'Un momento.', 'Espera.')
      : T(s, 'Disculpe que lo interrumpa.', 'Perdón que te interrumpa.');
  if (term)
    return `${polite} ${pick(
      [
        T(s, `¿Qué quiere decir exactamente con ${term}?`, `¿Qué quieres decir con ${term}?`),
        T(s, `¿Por qué es necesario ${term} en su propuesta?`, `¿Por qué ${term}?`),
        T(s, `¿Cómo comprobó lo que acaba de decir sobre ${term}?`, `¿Cómo sabes eso de ${term}?`),
      ],
      rng,
    )}`;
  return `${polite} ${T(s, '¿Podría explicar mejor la idea que acaba de mencionar?', '¿Puedes explicar mejor eso?')}`;
}
export function longAnswerInterruption(
  s: ScenarioDef,
  p: Participant,
  offTopic: boolean,
  core: string,
): string {
  if (offTopic)
    return T(
      s,
      `Disculpe, pero se está alejando de la pregunta. ${simplify(core)}`,
      `Perdón, pero nos estamos desviando. ${simplify(core)}`,
    );
  return p.temperament === 'desafiante' || p.temperament === 'exigente' || p.temperament === 'serio'
    ? T(
        s,
        'Le voy a pedir que vaya al punto. ¿Cuál es su respuesta en una frase?',
        'Ve al punto, por favor. ¿Qué quieres decir en una frase?',
      )
    : T(
        s,
        'Disculpe que lo interrumpa por el tiempo. ¿Podría resumir su respuesta en una frase?',
        'Perdón, por el tiempo: ¿me lo resumes en una frase?',
      );
}
export function timeNotice(kind: '5' | '2' | '0' | 'x', s: ScenarioDef, p: Participant): string {
  const harsh = p.temperament === 'desafiante' || p.temperament === 'exigente' || p.temperament === 'serio';
  if (kind === '5') return T(s, 'Le quedan cinco minutos.', 'Te quedan cinco minutos.');
  if (kind === '2') return T(s, 'Le quedan dos minutos.', 'Te quedan dos minutos.');
  if (kind === '0')
    return harsh
      ? T(s, 'Se cumplió el tiempo. Cierre ahora, por favor.', 'Se acabó el tiempo, cierra por favor.')
      : T(
          s,
          'Se cumplió el tiempo; le pido ir cerrando, por favor.',
          'Se acabó el tiempo; ve cerrando, por favor.',
        );
  return T(
    s,
    'Debe terminar ahora para pasar a las preguntas.',
    'Tenemos que pasar a la conversación ahora.',
  );
}
export function reactionText(
  p: Participant,
  a: AnswerAnalysis,
  rng: () => number,
  avoid: string[] = [],
): string {
  return reactionFor(p.temperament, a.type, rng, avoid);
}
/** Probabilidad de repreguntar según temperamento, tipo de respuesta y dificultad. */
export function followUpChance(p: Participant, a: AnswerAnalysis): number {
  const weak = ['parcial', 'sin_sustento', 'evade', 'contradice_documento'].includes(a.type);
  const t = TEMPERAMENTS[p.temperament].followUp;
  if (a.type === 'pide_reformulacion' || a.type === 'no_comprende') return 1;
  if (a.type === 'contradice_documento') return Math.max(0.8, t);
  if (weak) return t;
  if (a.type === 'reconoce_limitacion') return t * 0.6;
  if (a.type === 'correcta') {
    const deep = ['avanzada', 'experta', 'extrema'].includes(p.difficulty);
    return deep ? t * 0.5 : t * 0.15;
  }
  return 0.3;
}
