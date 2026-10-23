import { normalize, words } from '@oratoria/defense';
import type { Finding } from '@oratoria/defense';
import { contentTerms, overlap } from './analysis';
import { EvaluationSchema, EVALUATION_JSON_SCHEMA, evaluationPrompt, extractJson } from './prompts';
import { SCENARIOS } from './scenarios';
import type { EngineSnapshot } from './engine';
import type { CriterionDef, Dimension, LlmPort, TurnRecord } from './types';

export type Method = 'medicion' | 'reglas' | 'ia';
export type Evidence = { kind: 'cita' | 'medicion'; text: string; turn?: number };
export type CriterionResult = {
  id: string;
  name: string;
  dimension: Dimension;
  level: 0 | 1 | 2 | 3 | null;
  observed: string;
  why: string;
  evidence: Evidence[];
  improve: string;
  method: Method | null;
  methodText: string;
  weight: number;
};
export const LEVEL_NAMES = ['Inicial', 'En desarrollo', 'Logrado', 'Destacado'] as const;
export const DIMENSION_NAMES: Record<Dimension, string> = {
  contenido: 'Contenido y fundamentación',
  verbal: 'Comunicación verbal',
  vocal: 'Comunicación vocal',
  no_verbal: 'Comunicación no verbal',
  interpersonal: 'Inteligencia interpersonal',
};

type Answered = TurnRecord & { answer: NonNullable<TurnRecord['answer']> };
const answered = (s: EngineSnapshot) =>
  s.turns.filter((t): t is Answered => !!t.answer && t.answer.text.trim().length > 0);
const quote = (t: Answered, i: number, max = 160): Evidence => {
  const text = t.answer.text.replace(/\s+/g, ' ').trim();
  return { kind: 'cita', text: text.length > max ? `${text.slice(0, max)}…` : text, turn: i };
};
const share = (list: Answered[], pred: (t: Answered) => boolean) =>
  list.length ? list.filter(pred).length / list.length : 0;
const median = (v: number[]) => {
  if (!v.length) return null;
  const a = [...v].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2]! : (a[a.length / 2 - 1]! + a[a.length / 2]!) / 2;
};
const lv = (x: number, cuts: [number, number, number]): 0 | 1 | 2 | 3 =>
  x >= cuts[2] ? 3 : x >= cuts[1] ? 2 : x >= cuts[0] ? 1 : 0;
const hasMarker = (t: Answered, m: string) => t.answer.analysis.markers.includes(m);

type RuleOut = { level: 0 | 1 | 2 | 3 | null; observed: string; evidence: Evidence[]; methodText: string };
const none = (observed: string): RuleOut => ({ level: null, observed, evidence: [], methodText: '' });

/** Evaluadores por reglas explícitas. Cada uno explica qué contó y muestra citas reales. */
function ruleEvaluate(c: CriterionDef, s: EngineSnapshot): RuleOut {
  const all = answered(s);
  const indexed = all.map((t) => ({ t, i: s.turns.indexOf(t) }));
  const best = (pred: (t: Answered) => boolean, n = 2) =>
    indexed
      .filter(({ t }) => pred(t))
      .slice(0, n)
      .map(({ t, i }) => quote(t, i));
  if (!all.length) return none('No hubo respuestas con texto para evaluar.');
  const scenario = SCENARIOS[s.scenario];
  switch (c.id) {
    case 'pertinencia': {
      const ov = all.map((t) => t.answer.analysis.overlap);
      const m = ov.reduce((a, b) => a + b, 0) / ov.length;
      const evade = share(all, (t) => t.answer.analysis.type === 'evade');
      const level = evade > 0.3 ? 0 : lv(m - evade, [0.15, 0.28, 0.45]);
      return {
        level,
        observed: `En promedio, las respuestas retoman ${Math.round(m * 100)} % de los términos clave de la pregunta; ${Math.round(evade * 100)} % se desviaron.`,
        evidence: best((t) => t.answer.analysis.type === 'evade', 1).concat(
          best((t) => t.answer.analysis.overlap >= 0.45, 1),
        ),
        methodText:
          'Coincidencia de términos de contenido entre pregunta y respuesta; respuestas desviadas según reglas.',
      };
    }
    case 'claridad': {
      const structure =
        /\b(primero|en primer lugar|segundo|por un lado|por otro lado|en resumen|en conclusion|finalmente|dos razones|tres razones)\b/;
      const ordered = share(
        all,
        (t) =>
          t.answer.analysis.justification && t.answer.analysis.words >= 20 && t.answer.analysis.words <= 230,
      );
      const marks = share(all, (t) => structure.test(normalize(t.answer.text)));
      return {
        level: lv(ordered * 0.75 + marks * 0.5, [0.2, 0.45, 0.75]),
        observed: `${Math.round(ordered * 100)} % de las respuestas tienen una idea justificada con extensión adecuada; ${Math.round(marks * 100)} % usan marcadores de orden.`,
        evidence: best((t) => structure.test(normalize(t.answer.text)), 2),
        methodText: 'Conectores de justificación, marcadores de orden («primero», «en resumen») y extensión.',
      };
    }
    case 'fundamentacion': {
      const backed = share(
        all,
        (t) => (t.answer.analysis.evidence || t.answer.analysis.example) && t.answer.analysis.justification,
      );
      const abs = all.reduce((n, t) => n + t.answer.analysis.absolutes.length, 0);
      return {
        level: lv(backed - Math.min(0.3, abs * 0.05), [0.2, 0.45, 0.7]),
        observed: `${Math.round(backed * 100)} % de las respuestas combinan una razón con datos, resultados o ejemplos. ${abs} afirmaciones absolutas.`,
        evidence: best((t) => t.answer.analysis.evidence && t.answer.analysis.justification, 2),
        methodText:
          'Presencia simultánea de justificación («porque», «debido a») y evidencia (cifras, resultados, ejemplos).',
      };
    }
    case 'sintesis': {
      const m = median(all.map((t) => t.answer.analysis.words))!;
      const longs = share(all, (t) => t.answer.analysis.words > 250),
        shorts = share(all, (t) => t.answer.analysis.words < 15);
      const inRange = m >= 35 && m <= 180;
      const level: 0 | 1 | 2 | 3 = inRange
        ? longs === 0 && shorts === 0
          ? 3
          : 2
        : m >= 20 && m <= 260
          ? 1
          : 0;
      return {
        level,
        observed: `Mediana de ${Math.round(m)} palabras por respuesta; ${Math.round(longs * 100)} % muy largas y ${Math.round(shorts * 100)} % muy breves.`,
        evidence: best((t) => t.answer.analysis.words > 250, 1),
        methodText: 'Palabras por respuesta (referencia práctica: 35 a 180).',
      };
    }
    case 'objeciones': {
      const pressed = indexed.filter(
        ({ t }) =>
          t.question.kind === 'repregunta' ||
          t.question.stage === 'objeciones' ||
          t.question.stage === 'inconsistencias',
      );
      if (!pressed.length) return none('No hubo repreguntas u objeciones que evaluar.');
      const ok = pressed.filter(
        ({ t }) =>
          !['evade', 'sin_respuesta', 'contradice_documento'].includes(t.answer.analysis.type) &&
          (t.answer.analysis.justification || t.answer.analysis.evidence),
      );
      const r = ok.length / pressed.length;
      return {
        level: lv(r, [0.25, 0.5, 0.8]),
        observed: `Respondió con argumentos ${ok.length} de ${pressed.length} repreguntas u objeciones.`,
        evidence: ok.slice(0, 2).map(({ t, i }) => quote(t, i)),
        methodText:
          'Respuestas a repreguntas y objeciones que no evaden y aportan justificación o evidencia.',
      };
    }
    case 'escucha': {
      const rx =
        /\b(si entiendo bien|me pregunta|me preguntas|respecto a su pregunta|respecto a tu pregunta|como usted (dice|menciona|plantea)|como dices|lo que plantea|buena pregunta|sobre lo que pregunta)\b/;
      const refs = share(all, (t) => rx.test(normalize(t.answer.text)));
      const ov = all.reduce((a, t) => a + t.answer.analysis.overlap, 0) / all.length;
      return {
        level: lv(refs * 0.6 + ov, [0.2, 0.35, 0.6]),
        observed: `Retoma la pregunta explícitamente en ${Math.round(refs * 100)} % de las respuestas; coincidencia temática promedio ${Math.round(ov * 100)} %.`,
        evidence: best((t) => rx.test(normalize(t.answer.text)), 2),
        methodText:
          'Frases que retoman la pregunta («si entiendo bien», «me pregunta») y coincidencia temática.',
      };
    }
    case 'asertividad': {
      const total = all.reduce((n, t) => n + t.answer.analysis.words, 0);
      const hedges = all.reduce((n, t) => n + t.answer.analysis.hedges, 0);
      const per100 = total ? (hedges * 100) / total : 0;
      return {
        level: per100 < 0.8 ? 3 : per100 < 2 ? 2 : per100 < 4 ? 1 : 0,
        observed: `${hedges} expresiones de duda (${per100.toFixed(1)} cada 100 palabras).`,
        evidence: best((t) => t.answer.analysis.hedges >= 2, 2),
        methodText:
          'Expresiones de duda («creo que», «tal vez») por cada 100 palabras. Pueden ser prudencia legítima.',
      };
    }
    case 'turnos': {
      const lat = all.map((t) => t.answer.latencySec).filter((x): x is number => x !== null);
      const cut = share(all, (t) => t.answer.interrupted);
      const m = median(lat);
      if (m === null) return none('No se midió el tiempo de inicio de las respuestas.');
      return {
        // Las interrupciones del profesor dependen de su temperamento, no del mérito del usuario.
        level: m <= 3 ? 3 : m <= 5 ? 2 : m <= 8 ? 1 : 0,
        observed: `Empieza a responder en ${m.toFixed(1)} s (mediana); ${Math.round(cut * 100)} % de las respuestas fueron interrumpidas por extensión.`,
        evidence: [],
        methodText:
          'Segundos hasta la primera voz detectada. Las interrupciones del interlocutor se informan sin penalización.',
      };
    }
    case 'dominio_metodologico': {
      const areas = new Set(['diseno', 'muestreo', 'instrumentos', 'validez', 'analisis']);
      const m = indexed.filter(({ t }) => t.question.area && areas.has(t.question.area));
      if (!m.length) return none('No hubo preguntas metodológicas en esta sesión.');
      const r =
        m.filter(
          ({ t }) =>
            t.answer.analysis.justification &&
            (hasMarker(t, 'justifica metodología') || t.answer.analysis.evidence),
        ).length / m.length;
      return {
        level: lv(r, [0.25, 0.5, 0.8]),
        observed: `Justificó decisiones metodológicas con alternativas o evidencia en ${Math.round(r * 100)} % de ${m.length} respuestas.`,
        evidence: m
          .filter(({ t }) => hasMarker(t, 'justifica metodología'))
          .slice(0, 2)
          .map(({ t, i }) => quote(t, i)),
        methodText:
          'Respuestas a preguntas metodológicas con justificación y mención de alternativas o evidencia.',
      };
    }
    case 'limitaciones': {
      const m = indexed.filter(({ t }) => t.question.area === 'limitaciones' || t.answer.analysis.limitation);
      if (!m.length) return none('No se conversó sobre limitaciones.');
      const r =
        m.filter(
          ({ t }) =>
            t.answer.analysis.limitation && (t.answer.analysis.justification || t.answer.analysis.evidence),
        ).length / m.length;
      return {
        level: lv(r, [0.2, 0.5, 0.8]),
        observed: `Reconoció limitaciones explicando su efecto en ${Math.round(r * 100)} % de ${m.length} respuestas relacionadas.`,
        evidence: m
          .filter(({ t }) => t.answer.analysis.limitation)
          .slice(0, 2)
          .map(({ t, i }) => quote(t, i)),
        methodText: 'Expresiones de limitación acompañadas de explicación o evidencia.',
      };
    }
    case 'coherencia_documento': {
      const usedMaterial = s.moves.some((m) => m.sources.some((c) => c.docId !== 'exposicion'));
      if (!usedMaterial) return none('No se cargó material con el que comparar lo dicho.');
      const contradictions = all.flatMap((t) => t.answer.analysis.contradictions);
      return {
        level: contradictions.length === 0 ? 2 : contradictions.length === 1 ? 1 : 0,
        observed: contradictions.length
          ? `${contradictions.length} cifras dichas no coinciden con el material: ${contradictions.map((c) => `${c.said} frente a ${c.source} (${c.location})`).join('; ')}.`
          : 'No se detectaron cifras contradictorias con el material. La comparación solo cubre cifras con unidad.',
        evidence: contradictions.slice(0, 2).map((c) => ({
          kind: 'medicion' as const,
          text: `Dijo ${c.said}; el material indica ${c.source} (${c.location}).`,
        })),
        methodText:
          'Comparación de cifras con unidad entre respuestas y fragmentos del material sobre el mismo asunto.',
      };
    }
    case 'star': {
      const m = indexed.filter(({ t }) =>
        ['conductual', 'trayectoria', 'situacional'].includes(t.question.area ?? ''),
      );
      if (!m.length) return none('No hubo preguntas conductuales.');
      const parts = m.map(
        ({ t }) => ['situación', 'tarea', 'acción', 'resultado'].filter((x) => hasMarker(t, x)).length,
      );
      const mean = parts.reduce((a, b) => a + b, 0) / parts.length;
      return {
        level: mean >= 3.5 ? 3 : mean >= 2.5 ? 2 : mean >= 1.5 ? 1 : 0,
        observed: `En promedio, cada respuesta conductual incluyó ${mean.toFixed(1)} de 4 partes STAR.`,
        evidence: m.slice(0, 2).map(({ t, i }) => quote(t, i)),
        methodText: 'Marcadores de situación, tarea, acción y resultado en respuestas conductuales.',
      };
    }
    case 'logros': {
      const r = share(all, (t) => /\d/.test(t.answer.text) && hasMarker(t, 'resultado'));
      return {
        level: lv(r, [0.1, 0.3, 0.55]),
        observed: `${Math.round(r * 100)} % de las respuestas mencionan un resultado con una cifra.`,
        evidence: best((t) => /\d/.test(t.answer.text) && hasMarker(t, 'resultado'), 2),
        methodText: 'Respuestas con cifras y marcadores de resultado.',
      };
    }
    case 'alineacion_cargo': {
      const req = s.config.context.requisitos ?? '';
      if (contentTerms(req).size < 3) return none('No se indicaron los requisitos del cargo.');
      const ov = all.reduce((a, t) => a + overlap(req, t.answer.text), 0) / all.length;
      return {
        level: lv(ov, [0.05, 0.12, 0.22]),
        observed: `Las respuestas retoman en promedio ${Math.round(ov * 100)} % de los términos de los requisitos del cargo.`,
        evidence: [],
        methodText: 'Coincidencia entre respuestas y requisitos del cargo.',
      };
    }
    case 'recomendacion': {
      const text = `${s.exposition.map((e) => e.text).join(' ')} ${all.map((t) => t.answer.text).join(' ')}`;
      const explicit = /\b(propongo|recomiendo|les pido|solicito|aprobar|la decision)\b/.test(
        normalize(text),
      );
      const decision = s.config.context.decision ?? '';
      const ov = decision ? overlap(decision, text) : 0;
      return {
        level: explicit ? (ov >= 0.4 ? 3 : 2) : ov >= 0.3 ? 1 : 0,
        observed: explicit
          ? 'Formuló una recomendación o petición explícita.'
          : 'No se escuchó una petición o recomendación explícita.',
        evidence: [],
        methodText: 'Frases de petición explícita y coincidencia con la decisión declarada.',
      };
    }
    case 'datos_impacto': {
      const r = share(all, (t) => /\d/.test(t.answer.text) && hasMarker(t, 'costo o beneficio'));
      return {
        level: lv(r, [0.1, 0.3, 0.55]),
        observed: `${Math.round(r * 100)} % de las respuestas incluyen cifras de costo, beneficio o retorno.`,
        evidence: best((t) => hasMarker(t, 'costo o beneficio'), 2),
        methodText: 'Cifras junto a términos de costo, beneficio o retorno.',
      };
    }
    case 'argumentacion': {
      const r = share(
        all,
        (t) => t.answer.analysis.justification && (t.answer.analysis.evidence || t.answer.analysis.example),
      );
      const stance =
        all.some((t) => hasMarker(t, 'postura explícita')) ||
        /\b(sostengo|mi postura|estoy a favor|estoy en contra)\b/.test(
          normalize(s.exposition.map((e) => e.text).join(' ')),
        );
      return {
        level: Math.min(3, lv(r, [0.2, 0.45, 0.7]) + (stance ? 0 : -1)) as 0 | 1 | 2 | 3,
        observed: `${stance ? 'Declaró su postura de forma explícita.' : 'No declaró su postura de forma explícita.'} ${Math.round(r * 100)} % de las intervenciones combinan razón y evidencia.`,
        evidence: best((t) => t.answer.analysis.justification && t.answer.analysis.evidence, 2),
        methodText: 'Postura explícita, razones y evidencia en cada intervención.',
      };
    }
    case 'refutacion': {
      const opp = indexed.filter(
        ({ t }) => s.config.participants.find((p) => p.id === t.question.speakerId)?.roleId === 'oponente',
      );
      if (!opp.length) return none('El oponente no planteó contraargumentos.');
      const r = opp.filter(({ t }) => hasMarker(t, 'refuta')).length / opp.length;
      return {
        level: lv(r, [0.2, 0.5, 0.8]),
        observed: `Refutó explícitamente ${Math.round(r * 100)} % de los contraargumentos del oponente.`,
        evidence: opp
          .filter(({ t }) => hasMarker(t, 'refuta'))
          .slice(0, 2)
          .map(({ t, i }) => quote(t, i)),
        methodText: 'Marcadores de refutación («sin embargo», «discrepo») ante el oponente.',
      };
    }
    case 'falacias': {
      const abs = all.reduce((n, t) => n + t.answer.analysis.absolutes.length, 0);
      return {
        level: abs === 0 ? 2 : abs <= 2 ? 1 : 0,
        observed: `${abs} afirmaciones absolutas («siempre», «nunca», «obviamente»). La detección de otras falacias requiere el evaluador con IA.`,
        evidence: best((t) => t.answer.analysis.absolutes.length > 0, 2),
        methodText: 'Conteo de absolutos sin evidencia; no detecta todas las falacias.',
      };
    }
    case 'explicacion': {
      const exp = s.exposition.map((e) => e.text).join(' ');
      const defines =
        /\b(es un|es una|significa|se define|consiste en|se refiere a)\b/.test(normalize(exp)) ||
        all.some((t) => hasMarker(t, 'define'));
      const r = share(all, (t) => hasMarker(t, 'define') || hasMarker(t, 'ejemplifica'));
      return {
        level: defines ? lv(r, [0, 0.3, 0.6]) : r > 0.3 ? 1 : 0,
        observed: defines
          ? 'Incluyó definiciones explícitas del concepto.'
          : 'No se escuchó una definición explícita.',
        evidence: best((t) => hasMarker(t, 'define'), 2),
        methodText: 'Fórmulas de definición («significa», «consiste en») en la explicación y respuestas.',
      };
    }
    case 'ejemplos': {
      const r = share(all, (t) => hasMarker(t, 'ejemplifica') || t.answer.analysis.example);
      return {
        level: lv(r, [0.15, 0.35, 0.65]),
        observed: `${Math.round(r * 100)} % de las respuestas incluyen un ejemplo o analogía.`,
        evidence: best((t) => t.answer.analysis.example, 2),
        methodText: 'Marcadores de ejemplo o analogía.',
      };
    }
    case 'comprension': {
      const exp = normalize(s.exposition.map((e) => e.text).join(' '));
      const n =
        all.filter((t) => hasMarker(t, 'comprueba comprensión')).length +
        (/\b(se entiende|queda claro|alguna duda|me explico)\b/.test(exp) ? 1 : 0);
      return {
        level: n >= 3 ? 3 : n === 2 ? 2 : n === 1 ? 1 : 0,
        observed: `Comprobó la comprensión ${n} veces.`,
        evidence: best((t) => hasMarker(t, 'comprueba comprensión'), 2),
        methodText: 'Preguntas de verificación («¿se entiende?», «en otras palabras»).',
      };
    }
    case 'hechos': {
      const facts = share(all, (t) => hasMarker(t, 'hechos concretos')),
        judg = all.filter((t) => hasMarker(t, 'juicio sobre la persona')).length;
      return {
        level: Math.max(0, lv(facts, [0.1, 0.3, 0.55]) - Math.min(2, judg)) as 0 | 1 | 2 | 3,
        observed: `${Math.round(facts * 100)} % de las intervenciones mencionan hechos concretos; ${judg} juicios sobre la persona.`,
        evidence: best((t) => hasMarker(t, 'juicio sobre la persona'), 1).concat(
          best((t) => hasMarker(t, 'hechos concretos'), 1),
        ),
        methodText: 'Referencias a hechos con tiempo o lugar frente a calificativos personales.',
      };
    }
    case 'necesidades': {
      const r = share(all, (t) => hasMarker(t, 'mensaje en primera persona'));
      return {
        level: lv(r, [0.1, 0.3, 0.55]),
        observed: `${Math.round(r * 100)} % de las intervenciones expresan necesidades en primera persona.`,
        evidence: best((t) => hasMarker(t, 'mensaje en primera persona'), 2),
        methodText: 'Mensajes en primera persona («necesito», «me preocupa»).',
      };
    }
    case 'empatia': {
      const r = share(all, (t) => hasMarker(t, 'reconoce la perspectiva'));
      return {
        level: lv(r, [0.1, 0.3, 0.55]),
        observed: `Reconoció verbalmente la perspectiva del otro en ${Math.round(r * 100)} % de las intervenciones. No se infieren emociones desde la imagen.`,
        evidence: best((t) => hasMarker(t, 'reconoce la perspectiva'), 2),
        methodText: 'Expresiones verbales de reconocimiento («entiendo», «tiene sentido»).',
      };
    }
    case 'acuerdos': {
      const prop = all.some((t) => hasMarker(t, 'propone')),
        verif = all.some((t) => hasMarker(t, 'acuerdo verificable'));
      return {
        level: prop && verif ? 3 : prop ? 2 : verif ? 1 : 0,
        observed: `${prop ? 'Hizo una propuesta' : 'No hizo una propuesta explícita'}${verif ? ' con plazo o forma de revisión' : ''}.`,
        evidence: best((t) => hasMarker(t, 'acuerdo verificable') || hasMarker(t, 'propone'), 2),
        methodText: 'Propuestas («propongo», «podríamos») y referencias a plazos o revisión.',
      };
    }
    default:
      void scenario;
      return none('Este criterio no tiene una regla automática.');
  }
}
const FINDING_LEVEL: Record<Finding['level'], 0 | 1 | 2 | 3 | null> = {
  fortaleza: 3,
  adecuado: 2,
  mejorar: 1,
  'sin-datos': null,
};

const fold = (s: string) =>
  normalize(s)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
/** Comprueba que una cita del evaluador exista literalmente en el turno indicado. */
export function verifyQuote(q: string, turnId: string, s: EngineSnapshot): number | null {
  const needle = fold(q);
  if (needle.length < 8) return null;
  if (turnId === 'EXP') return fold(s.exposition.map((e) => e.text).join(' ')).includes(needle) ? -1 : null;
  if (!/^T[1-9]\d*$/.test(turnId)) return null;
  const i = Number(turnId.slice(1)) - 1;
  const t = s.turns[i];
  return t?.answer && fold(t.answer.text).includes(needle) ? i : null;
}

export type EvaluationResult = {
  criteria: CriterionResult[];
  summary: string;
  strengths: string[];
  improvements: string[];
  notes: string[];
  evaluatorModel: string | null;
  /** Índice orientativo 0–100 sobre los criterios evaluados, con su cobertura. */
  index: { value: number; coverage: number } | null;
};

/**
 * Evalúa la sesión combinando mediciones, reglas y, si está disponible, un modelo evaluador.
 * El evaluador no conoce el temperamento de los interlocutores y sus niveles se descartan si no
 * se apoyan en citas literales verificables.
 */
export async function evaluateSession(input: {
  snapshot: EngineSnapshot;
  findings: Finding[];
  llm?: LlmPort | null;
  signal?: AbortSignal;
  chunks?: Parameters<typeof evaluationPrompt>[0]['chunks'];
  /** Criterios activos con sus pesos; por defecto, los recomendados del escenario. */
  criteria?: CriterionDef[];
}): Promise<EvaluationResult> {
  const s = input.snapshot,
    scenario = SCENARIOS[s.scenario];
  const notes: string[] = [];
  const criteria = (input.criteria ?? scenario.criteria).map((c) => ({
    ...c,
    weight: Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 1,
  }));
  let ai: ReturnType<typeof EvaluationSchema.parse> | null = null;
  let evaluatorModel: string | null = null;
  const aiCriteria = criteria.filter((c) => c.methods.includes('ia'));
  if (input.llm && aiCriteria.length && answered(s).length) {
    const prompt = evaluationPrompt({
      scenario,
      config: s.config,
      criteria: aiCriteria,
      exposition: s.exposition.map((e) => e.text).join(' '),
      turns: s.turns.map((t, i) => ({
        id: `T${i + 1}`,
        question: t.question.text,
        answer: t.answer?.text ?? '',
      })),
      chunks: input.chunks ?? [],
    });
    if (prompt.clippedTurns)
      notes.push(
        `El evaluador con IA recibió ${prompt.clippedTurns} respuestas recortadas a 1.500 caracteres; las reglas sí usaron el texto completo.`,
      );
    try {
      const raw = await input.llm.complete(prompt.messages, {
        json: true,
        schema: EVALUATION_JSON_SCHEMA,
        signal: input.signal,
        timeoutMs: 120000,
        temperature: 0.2,
      });
      ai = EvaluationSchema.parse(extractJson(raw));
      evaluatorModel = input.llm.model;
    } catch (e) {
      notes.push(
        `No se obtuvo la evaluación del modelo (${e instanceof Error ? e.message.slice(0, 120) : 'error'}); se usaron reglas y mediciones.`,
      );
    }
  }
  let discarded = 0;
  const results: CriterionResult[] = criteria.map((c) => {
    const base = {
      id: c.id,
      name: c.name,
      dimension: c.dimension,
      why: c.whyItMatters,
      improve: c.improve,
      weight: c.weight,
    };
    for (const method of c.methods) {
      if (method === 'medicion' && c.metric) {
        const f = input.findings.find((x) => x.id === c.metric);
        if (f && FINDING_LEVEL[f.level] !== null)
          return {
            ...base,
            level: FINDING_LEVEL[f.level],
            observed: `${f.value}. ${f.explanation}`,
            evidence: [{ kind: 'medicion', text: f.value }],
            method,
            methodText: f.method,
            improve: f.exercise || c.improve,
          };
      }
      if (method === 'ia' && ai) {
        const r = ai.criterios.find((x) => x.id === c.id);
        if (r && r.nivel !== null) {
          const verified = r.evidencias
            .map((e) => ({ e, i: verifyQuote(e.cita, e.turno, s) }))
            .filter((x): x is { e: { turno: string; cita: string }; i: number } => x.i !== null);
          if (verified.length)
            return {
              ...base,
              level: r.nivel as 0 | 1 | 2 | 3,
              observed: r.observacion || 'Valoración del modelo evaluador.',
              evidence: verified.map(({ e, i }) => ({
                kind: 'cita' as const,
                text: e.cita,
                ...(i >= 0 ? { turn: i } : {}),
              })),
              method,
              methodText: `Valoración del modelo ${evaluatorModel} con citas verificadas literalmente en la transcripción. Es una apreciación automática, no una medición.`,
              improve: r.mejora || c.improve,
            };
          discarded++;
        }
      }
      if (method === 'reglas') {
        const r = ruleEvaluate(c, s);
        if (r.level !== null) return { ...base, ...r, method };
        if (c.methods.length === 1 || c.methods.at(-1) === 'reglas')
          return { ...base, ...r, method: null, methodText: 'No evaluado' };
      }
    }
    const fallback = c.metric ? input.findings.find((x) => x.id === c.metric) : undefined;
    return {
      ...base,
      level: null,
      observed: fallback
        ? fallback.explanation
        : c.methods.includes('medicion')
          ? 'Faltaron datos para medirlo (cámara, transcripción o duración insuficientes).'
          : 'No hubo información suficiente para evaluarlo.',
      evidence: [],
      method: null,
      methodText: 'No evaluado',
    };
  });
  if (discarded)
    notes.push(
      `Se descartaron ${discarded} valoraciones del modelo porque sus citas no aparecían literalmente en la transcripción.`,
    );
  const evaluated = results.filter((r) => r.level !== null);
  const totalW = results.reduce((n, r) => n + r.weight, 0),
    evalW = evaluated.reduce((n, r) => n + r.weight, 0);
  const index = evaluated.length
    ? {
        value: Math.round((evaluated.reduce((n, r) => n + r.weight * (r.level! / 3), 0) / evalW) * 100),
        coverage: Math.round((evalW / totalW) * 100),
      }
    : null;
  // El resumen se deriva de los criterios aceptados. El texto libre del modelo no tiene citas.
  const strengths = evaluated.filter((r) => r.level === 3).map((r) => `${r.name}: ${r.observed}`);
  const improvements = evaluated
    .filter((r) => r.level !== null && r.level <= 1)
    .map((r) => `${r.name}: ${r.improve}`);
  const summary = evaluated.length
    ? `Se evaluaron ${evaluated.length} de ${results.length} criterios. ${evaluated.filter((r) => r.level! >= 2).length} quedaron en nivel logrado o destacado y ${evaluated.filter((r) => r.level! <= 1).length} requieren práctica.`
    : 'No hubo datos suficientes para evaluar criterios.';
  return {
    criteria: results,
    summary,
    strengths: strengths.slice(0, 5),
    improvements: improvements.slice(0, 5),
    notes,
    evaluatorModel,
    index,
  };
}
export const answeredTurns = answered;
export const wordsIn = (t: string) => words(t).length;
