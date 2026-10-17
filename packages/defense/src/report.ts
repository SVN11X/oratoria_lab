import { DEFAULT_FILLERS } from '@oratoria/evaluation';
import type { Difficulty, MemberId, QuestionKind } from './committee';
import { countHedges } from './committee';
import { countTerms, wordCount } from './text';

export const DEFENSE_METHOD = 'oratoria-defensa-1.0.0';
export type Phase = 'exposicion' | 'pregunta' | 'respuesta';
/** Resumen de un segundo de práctica. Los campos de cámara son null si la cámara no se usó. */
export type Tick = {
  t: number;
  /** Duración real del resumen (1 s, o menos en un cambio de fase). */
  seconds: number;
  phase: Phase;
  speaking: number;
  db: number | null;
  nearThreshold: number;
  pitch: number[];
  clipped: boolean;
  face: number | null;
  contact: number | null;
  down: number | null;
  smile: number | null;
  pose: number | null;
  handsVisible: number | null;
  handsMoving: number | null;
  touchFace: number | null;
  tilt: number | null;
  midX: number | null;
  shoulderW: number | null;
};
export type SpeechChunk = { text: string; t: number; phase: Phase };
export type AnswerRecord = {
  member: MemberId;
  kind: QuestionKind;
  question: string;
  source: string;
  askedAt: number;
  startedAt: number | null;
  endedAt: number;
  text: string;
  feedback: string | null;
};
export type Level = 'fortaleza' | 'adecuado' | 'mejorar' | 'sin-datos';
export type Finding = {
  id: string;
  area: 'voz' | 'lenguaje' | 'cuerpo' | 'respuestas' | 'tiempo';
  title: string;
  level: Level;
  value: string;
  explanation: string;
  exercise: string;
  method: string;
  weight: number;
};
export type AnswerReview = AnswerRecord & {
  latency: number | null;
  duration: number;
  words: number;
  hedges: number;
  fillers: number;
};
export type ContentFeedback = {
  model: string;
  resumen: string;
  fortalezas: string[];
  mejoras: string[];
  estructura: Record<string, boolean>;
};
export type DefenseReport = {
  method: typeof DEFENSE_METHOD;
  id: string;
  createdAt: string;
  title: string;
  difficulty: Difficulty;
  mode: 'completa' | 'preguntas' | 'exposicion';
  targetMinutes: number;
  cameraUsed: boolean;
  transcriptUsed: boolean;
  exposition: {
    seconds: number;
    words: number;
    wpm: number | null;
    fillers: number;
    fillersPer100: number | null;
    topFillers: [string, number][];
    longSilences: number;
    contact: number | null;
  };
  answers: AnswerReview[];
  findings: Finding[];
  timeline: { t: number; phase: Phase; speaking: number; contact: number | null; wpm: number | null }[];
  expositionText: string;
  content: ContentFeedback | null;
  notes: string[];
};
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const sd = (v: number[]) => {
  const m = mean(v);
  return m === null || v.length < 2
    ? null
    : Math.sqrt(v.reduce((n, x) => n + (x - m) ** 2, 0) / (v.length - 1));
};
const median = (v: number[]) => {
  if (!v.length) return null;
  const a = [...v].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2]! : (a[a.length / 2 - 1]! + a[a.length / 2]!) / 2;
};
const pct = (x: number) => `${Math.round(x * 100)} %`;
const nonNull = (v: (number | null)[]) => v.filter((x): x is number => x !== null);
function level(value: number, good: [number, number], ok: [number, number]): Level {
  if (value >= good[0] && value <= good[1]) return 'fortaleza';
  if (value >= ok[0] && value <= ok[1]) return 'adecuado';
  return 'mejorar';
}
/** Variación de tono en semitonos respecto de la mediana; descarta saltos de octava. */
export function pitchSpread(pitches: number[]): { median: number; semitones: number } | null {
  if (pitches.length < 30) return null;
  const m = median(pitches)!;
  const st = pitches.map((p) => 12 * Math.log2(p / m)).filter((s) => Math.abs(s) <= 9);
  const spread = sd(st);
  return spread === null ? null : { median: m, semitones: spread };
}
export function longSilences(ticks: Tick[], minSeconds = 4): number {
  let run = 0,
    count = 0;
  for (const t of ticks) {
    if (t.speaking < 0.1) run++;
    else {
      if (run >= minSeconds) count++;
      run = 0;
    }
  }
  return count;
}
/** Promedio de la desviación del centro de los hombros en ventanas de 20 s, en anchos de hombro. */
export function swayIndex(ticks: Tick[]): number | null {
  const values: number[] = [];
  for (let i = 0; i < ticks.length; i += 20) {
    const w = ticks.slice(i, i + 20).filter((t) => t.midX !== null && t.shoulderW);
    if (w.length < 10) continue;
    const s = sd(w.map((t) => t.midX!)),
      width = mean(w.map((t) => t.shoulderW!));
    if (s !== null && width) values.push(s / width);
  }
  return mean(values);
}
export type ReportInput = {
  id: string;
  createdAt: string;
  title: string;
  difficulty: Difficulty;
  mode: DefenseReport['mode'];
  targetMinutes: number;
  ticks: Tick[];
  chunks: SpeechChunk[];
  answers: AnswerRecord[];
  transcriptUsed: boolean;
  fillers?: string[];
};
export function buildReport(input: ReportInput): DefenseReport {
  const fillers = input.fillers?.length ? input.fillers : DEFAULT_FILLERS;
  const exp = input.ticks.filter((t) => t.phase === 'exposicion'),
    talk = input.ticks.filter((t) => t.phase !== 'pregunta');
  const expTexts = input.chunks.filter((c) => c.phase === 'exposicion').map((c) => c.text);
  const expCount = countTerms(expTexts, fillers);
  const expSeconds = Math.round(exp.reduce((n, t) => n + t.seconds, 0));
  const wpm =
    input.transcriptUsed && expSeconds >= 30 && expCount.words > 0
      ? (expCount.words * 60) / expSeconds
      : null;
  const silences = longSilences(exp);
  const camera = talk.filter((t) => t.face !== null);
  const faceTime = camera.reduce((n, t) => n + (t.face ?? 0), 0);
  const contact = faceTime > 5 ? camera.reduce((n, t) => n + (t.contact ?? 0), 0) / faceTime : null;
  const expCamera = exp.filter((t) => t.face !== null),
    expFace = expCamera.reduce((n, t) => n + (t.face ?? 0), 0);
  const expContact = expFace > 5 ? expCamera.reduce((n, t) => n + (t.contact ?? 0), 0) / expFace : null;
  const down = faceTime > 5 ? camera.reduce((n, t) => n + (t.down ?? 0), 0) / faceTime : null;
  const faceFraction = camera.length ? faceTime / camera.length : null;
  const smile = faceTime > 5 ? camera.reduce((n, t) => n + (t.smile ?? 0), 0) / faceTime : null;
  const answers: AnswerReview[] = input.answers.map((a) => {
    const h = countHedges(a.text),
      f = countTerms([a.text], fillers);
    return {
      ...a,
      latency: a.startedAt === null ? null : Math.max(0, a.startedAt - a.askedAt),
      duration: Math.max(0, a.endedAt - a.askedAt),
      words: wordCount(a.text),
      hedges: h.total,
      fillers: f.total,
    };
  });
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);
  const target = input.targetMinutes * 60;
  if (input.mode !== 'preguntas') {
    if (expSeconds >= 20) {
      const ratio = expSeconds / target;
      const lv = level(ratio, [0.85, 1.1], [0.7, 1.2]);
      push({
        id: 'tiempo',
        area: 'tiempo',
        title: 'Manejo del tiempo',
        level: lv,
        value: `${Math.round(expSeconds / 60)} de ${input.targetMinutes} min (${pct(ratio)})`,
        explanation:
          ratio > 1.1
            ? 'Te pasaste del tiempo. En una defensa real la comisión puede cortarte antes de las conclusiones.'
            : ratio < 0.85
              ? 'Terminaste antes de lo previsto. Puede faltar desarrollo en metodología o resultados.'
              : 'Usaste el tiempo disponible de forma equilibrada.',
        exercise:
          'Marca en tu guion en qué diapositiva deberías ir en cada cuarto del tiempo y ensaya con esas marcas.',
        method: 'Segundos de exposición contados por la app; no incluye pausas ni interrupciones.',
        weight: 6,
      });
    }
    if (wpm !== null) {
      push({
        id: 'ritmo',
        area: 'voz',
        title: 'Velocidad al hablar',
        level: level(wpm, [120, 160], [105, 175]),
        value: `${Math.round(wpm)} palabras por minuto`,
        explanation:
          wpm > 160
            ? 'Hablas rápido. La comisión puede perder detalles técnicos y transmites apuro.'
            : wpm < 120
              ? 'Hablas lento. Puede bajar la atención y parecer que dudas del contenido.'
              : 'Tu velocidad permite seguir las ideas con comodidad.',
        exercise:
          wpm > 160
            ? 'Lee en voz alta un párrafo de tu tesis haciendo una pausa de un segundo en cada punto.'
            : 'Explica cada diapositiva en 60 segundos con cronómetro, sin leer.',
        method:
          'Palabras reconocidas por minuto de exposición. Una referencia común para presentaciones es 120 a 160.',
        weight: 8,
      });
      const per100 = expCount.per100 ?? 0;
      push({
        id: 'muletillas',
        area: 'lenguaje',
        title: 'Muletillas',
        level: per100 < 1.5 ? 'fortaleza' : per100 < 4 ? 'adecuado' : 'mejorar',
        value: `${expCount.total} en la exposición (${per100.toFixed(1)} cada 100 palabras)`,
        explanation: expCount.byTerm.length
          ? `Las más repetidas: ${expCount.byTerm
              .slice(0, 3)
              .map(([t, n]) => `«${t}» (${n})`)
              .join(', ')}.`
          : 'No se detectaron muletillas de tu diccionario.',
        exercise:
          'Graba 2 minutos y, cuando sientas que viene la muletilla, cámbiala por un silencio de un segundo.',
        method:
          'Coincidencias con tu diccionario. El reconocimiento de voz del navegador suele omitir «eh» y «em», así que pueden faltar.',
        weight: 8,
      });
    }
    if (expSeconds >= 60) {
      const per10 = (silences * 600) / expSeconds;
      push({
        id: 'silencios',
        area: 'voz',
        title: 'Silencios largos',
        level: per10 <= 2 ? 'fortaleza' : per10 <= 5 ? 'adecuado' : 'mejorar',
        value: `${silences} silencios de 4 s o más`,
        explanation:
          per10 > 5
            ? 'Te quedaste en blanco varias veces. Las pausas cortas ayudan, pero las largas cortan el hilo.'
            : 'Tus pausas no interrumpen el hilo de la exposición.',
        exercise:
          'Prepara una frase puente para pasar de una sección a otra, por ejemplo «ya vimos el problema, ahora veamos cómo lo resolví».',
        method: 'Tramos de 4 segundos o más sin voz detectada por el micrófono.',
        weight: 6,
      });
    }
  }
  const voiced = talk.filter((t) => t.speaking > 0.2);
  if (voiced.length >= 20) {
    const weak =
      voiced.reduce((n, t) => n + t.nearThreshold * t.speaking, 0) /
      voiced.reduce((n, t) => n + t.speaking, 0);
    push({
      id: 'volumen',
      area: 'voz',
      title: 'Fuerza de la voz',
      level: weak < 0.2 ? 'fortaleza' : weak < 0.35 ? 'adecuado' : 'mejorar',
      value: `${pct(weak)} del habla cerca del mínimo detectable`,
      explanation:
        weak >= 0.35
          ? 'Tu voz baja mucho por momentos, sobre todo al final de las frases. En una sala se perdería.'
          : 'Mantienes una voz audible la mayor parte del tiempo.',
      exercise:
        'Ensaya hablándole a la persona más lejana de la sala y termina cada frase con la misma fuerza con que la empiezas.',
      method:
        'Nivel del micrófono en relación con el umbral de Preferencias. Depende del micrófono y la distancia; compara intentos con el mismo equipo.',
      weight: 6,
    });
  }
  const spread = pitchSpread(exp.length ? exp.flatMap((t) => t.pitch) : talk.flatMap((t) => t.pitch));
  if (spread)
    push({
      id: 'entonacion',
      area: 'voz',
      title: 'Variación de la voz',
      level: spread.semitones >= 2.5 ? 'fortaleza' : spread.semitones >= 1.6 ? 'adecuado' : 'mejorar',
      value: `${spread.semitones.toFixed(1)} semitonos de variación`,
      explanation:
        spread.semitones < 1.6
          ? 'Tu tono varía poco y puede sonar monótono. Cuesta distinguir qué ideas son las importantes.'
          : 'Tu tono cambia lo suficiente para marcar ideas importantes.',
      exercise:
        'Elige las tres ideas clave de cada sección y destácalas con una pausa antes y un tono un poco más alto.',
      method:
        'Estimación del tono de voz con autocorrelación. Un semitono es el paso más pequeño de una escala musical; valores bajos indican voz plana.',
      weight: 5,
    });
  if (contact !== null) {
    push({
      id: 'contacto',
      area: 'cuerpo',
      title: 'Contacto visual con la comisión',
      level: level(contact, [0.7, 1], [0.5, 1]),
      value: `${pct(contact)} del tiempo mirando hacia la comisión`,
      explanation:
        contact < 0.5
          ? `Pasas mucho tiempo mirando a otro lado${down !== null && down > 0.25 ? ', sobre todo hacia abajo (notas o teclado)' : ''}. Transmite inseguridad o lectura.`
          : contact < 0.7
            ? 'Miras a la comisión, pero te desconectas en varios tramos.'
            : 'Mantienes la mirada en la comisión la mayor parte del tiempo.',
      exercise:
        'Pon la ventana de la comisión junto a la cámara y dirige cada frase a un integrante distinto. Usa notas solo con palabras clave.',
      method:
        'Orientación de la cabeza y de los ojos estimada con MediaPipe. «Mirar a la comisión» es mirar hacia la pantalla con la cámara.',
      weight: 9,
    });
    if (faceFraction !== null && faceFraction < 0.8)
      push({
        id: 'encuadre',
        area: 'cuerpo',
        title: 'Encuadre de la cámara',
        level: 'adecuado',
        value: `Rostro visible ${pct(faceFraction)} del tiempo`,
        explanation:
          'La cámara no te vio parte del tiempo, así que las medidas de mirada y postura son menos confiables.',
        exercise: 'Ubica la cámara a la altura de los ojos y deja visibles cabeza, hombros y manos.',
        method: 'Porcentaje de imágenes en que MediaPipe detectó un rostro.',
        weight: 3,
      });
    if (smile !== null)
      push({
        id: 'expresion',
        area: 'cuerpo',
        title: 'Expresión cercana',
        level: smile >= 0.03 ? 'fortaleza' : 'adecuado',
        value: `Sonrisa visible ${pct(smile)} del tiempo`,
        explanation:
          smile >= 0.03
            ? 'Muestras una expresión cercana en algunos momentos.'
            : 'Tu rostro se mantuvo serio todo el tiempo. Una sonrisa breve al saludar y al cerrar genera cercanía.',
        exercise: 'Ensaya el saludo y el cierre mirando a la comisión y con una sonrisa breve.',
        method: 'Gesto de sonrisa medido en la cara. No interpreta emociones.',
        weight: 2,
      });
  }
  const poseTicks = talk.filter((t) => t.pose !== null && (t.pose ?? 0) > 0.3 && t.speaking > 0.2);
  if (poseTicks.length >= 20) {
    const moving = mean(nonNull(poseTicks.map((t) => t.handsMoving)))!,
      seen = mean(nonNull(poseTicks.map((t) => t.handsVisible)))!;
    push({
      id: 'gestos',
      area: 'cuerpo',
      title: 'Uso de las manos',
      level: seen < 0.15 ? 'adecuado' : level(moving, [0.15, 0.6], [0.06, 0.8]),
      value: `Manos visibles ${pct(seen)}; en movimiento ${pct(moving)} del tiempo hablando`,
      explanation:
        seen < 0.15
          ? 'Tus manos casi no aparecen en cámara. Puede ser el encuadre o que las mantienes abajo.'
          : moving > 0.6
            ? 'Mueves las manos casi todo el tiempo. Puede verse como nerviosismo y distraer.'
            : moving < 0.15
              ? 'Casi no usas gestos. Las manos ayudan a enumerar, comparar y marcar ideas.'
              : 'Acompañas tu discurso con gestos en una medida adecuada.',
      exercise:
        'Ensaya con las manos a la altura de la cintura y úsalas con intención: contar puntos, mostrar tamaños o comparar.',
      method: 'Movimiento de las muñecas entre imágenes, medido con el modelo de postura de MediaPipe.',
      weight: 4,
    });
    let touches = 0,
      prev = false;
    for (const t of poseTicks) {
      const now = (t.touchFace ?? 0) > 0.5;
      if (now && !prev) touches++;
      prev = now;
    }
    const minutes = poseTicks.length / 60;
    if (touches >= 3 && touches / minutes > 0.5)
      push({
        id: 'manos-cara',
        area: 'cuerpo',
        title: 'Manos en la cara',
        level: 'mejorar',
        value: `${touches} veces`,
        explanation:
          'Te llevas la mano a la cara con frecuencia. La comisión lo suele leer como nerviosismo.',
        exercise: 'Sostén un lápiz o el control de diapositivas para dar a tus manos una tarea fija.',
        method: 'Muñeca a menos de media distancia de hombros de la nariz.',
        weight: 4,
      });
    const tilt = mean(nonNull(poseTicks.map((t) => t.tilt))),
      sway = swayIndex(talk);
    if (tilt !== null || sway !== null)
      push({
        id: 'postura',
        area: 'cuerpo',
        title: 'Postura',
        level:
          (tilt ?? 0) > 8 || (sway ?? 0) > 0.12
            ? 'mejorar'
            : (tilt ?? 0) > 5 || (sway ?? 0) > 0.07
              ? 'adecuado'
              : 'fortaleza',
        value: `Inclinación de hombros ${tilt === null ? 'sin dato' : `${tilt.toFixed(0)}°`}; balanceo ${sway === null ? 'sin dato' : sway.toFixed(2)}`,
        explanation:
          (sway ?? 0) > 0.12
            ? 'Te balanceas de lado a lado. Distrae y transmite nerviosismo.'
            : (tilt ?? 0) > 8
              ? 'Inclinas los hombros hacia un lado de forma sostenida.'
              : 'Mantienes una postura estable y erguida.',
        exercise:
          'Apoya el peso en ambos pies separados al ancho de los hombros y quédate quieto al decir una idea importante.',
        method:
          'Ángulo de la línea entre hombros y desplazamiento lateral, medido en anchos de hombro (0,12 equivale a moverse un octavo del ancho).',
        weight: 4,
      });
  }
  const latencies = nonNull(answers.map((a) => a.latency));
  if (latencies.length) {
    const m = median(latencies)!;
    push({
      id: 'latencia',
      area: 'respuestas',
      title: 'Tiempo para empezar a responder',
      level: m <= 3 ? 'fortaleza' : m <= 6 ? 'adecuado' : 'mejorar',
      value: `${m.toFixed(1)} s en la mitad de las respuestas`,
      explanation:
        m > 6
          ? 'Tardas en empezar a responder. Un silencio largo después de la pregunta transmite que no sabes la respuesta.'
          : 'Empiezas a responder con prontitud. Una pausa breve para ordenar la idea es positiva.',
      exercise:
        'Usa una frase de entrada mientras ordenas tu idea: «Lo explico en dos partes…» o «La razón principal es…».',
      method: 'Segundos entre el final de la pregunta y la primera voz detectada (mediana).',
      weight: 7,
    });
  }
  const answerWords = answers.reduce((n, a) => n + a.words, 0);
  if (answerWords >= 20) {
    const hedges = answers.reduce((n, a) => n + a.hedges, 0),
      per100 = (hedges * 100) / answerWords;
    push({
      id: 'seguridad',
      area: 'respuestas',
      title: 'Seguridad al responder',
      level: per100 < 1 ? 'fortaleza' : per100 < 3 ? 'adecuado' : 'mejorar',
      value: `${hedges} expresiones de duda (${per100.toFixed(1)} cada 100 palabras)`,
      explanation:
        per100 >= 3
          ? 'Usas muchas expresiones como «creo que» o «tal vez». Debilitan respuestas que quizás sí sabes.'
          : 'Respondes con afirmaciones directas.',
      exercise:
        'Reformula en voz alta tus respuestas quitando «creo que» y empezando por la conclusión: «Sí, porque…», «No, debido a…».',
      method: 'Coincidencias con una lista de expresiones de duda. Pueden ser prudencia legítima.',
      weight: 7,
    });
    const per = median(answers.filter((a) => a.kind !== 'interrupcion').map((a) => a.words));
    if (per !== null)
      push({
        id: 'desarrollo',
        area: 'respuestas',
        title: 'Desarrollo de las respuestas',
        level: level(per, [40, 220], [20, 320]),
        value: `${Math.round(per)} palabras por respuesta (mediana)`,
        explanation:
          per < 40
            ? 'Tus respuestas son muy breves. La comisión suele esperar una razón y un ejemplo.'
            : per > 220
              ? 'Te extiendes demasiado. Arriesgas perder el foco de la pregunta.'
              : 'Tus respuestas tienen una extensión adecuada.',
        exercise:
          'Responde con la estructura «respuesta directa, razón y ejemplo de mi trabajo» en menos de un minuto.',
        method: 'Palabras reconocidas en cada respuesta.',
        weight: 6,
      });
  } else if (answers.length) {
    const per = median(answers.map((a) => a.duration));
    if (per !== null)
      push({
        id: 'desarrollo',
        area: 'respuestas',
        title: 'Duración de las respuestas',
        level: level(per, [20, 120], [10, 180]),
        value: `${Math.round(per)} s por respuesta (mediana)`,
        explanation:
          per < 20
            ? 'Tus respuestas son muy breves.'
            : per > 120
              ? 'Tus respuestas son largas.'
              : 'Duración adecuada.',
        exercise: 'Responde con la estructura «respuesta directa, razón y ejemplo de mi trabajo».',
        method: 'Tiempo desde el fin de la pregunta hasta que indicaste que terminaste.',
        weight: 5,
      });
  }
  const timeline: DefenseReport['timeline'] = [];
  const last = input.ticks.length ? input.ticks[input.ticks.length - 1]!.t : 0;
  for (let start = 0; start <= last; start += 30) {
    const bin = input.ticks.filter((t) => t.t >= start && t.t < start + 30);
    if (!bin.length) continue;
    const phases = new Map<Phase, number>();
    for (const t of bin) phases.set(t.phase, (phases.get(t.phase) ?? 0) + 1);
    const phase = [...phases].sort((a, b) => b[1] - a[1])[0]![0];
    const fb = bin.reduce((n, t) => n + (t.face ?? 0), 0);
    const binWords = input.chunks
      .filter((c) => c.t >= start && c.t < start + 30)
      .reduce((n, c) => n + wordCount(c.text), 0);
    timeline.push({
      t: start,
      phase,
      speaking: mean(bin.map((t) => t.speaking))!,
      contact: fb > 3 ? bin.reduce((n, t) => n + (t.contact ?? 0), 0) / fb : null,
      wpm: input.transcriptUsed
        ? (binWords * 60) /
          Math.max(
            1,
            bin.reduce((n, t) => n + t.seconds, 0),
          )
        : null,
    });
  }
  const notes = [
    'Las mediciones son estimaciones automáticas para practicar. No reemplazan la opinión de tu profesor ni equivalen a una nota.',
  ];
  if (!input.transcriptUsed)
    notes.push('Sin transcripción no se miden velocidad, muletillas ni expresiones de duda.');
  if (contact === null)
    notes.push('Sin cámara (o sin modelos de cámara) no se miden mirada, gestos ni postura.');
  const clipped = input.ticks.filter((t) => t.clipped).length;
  if (input.ticks.length && clipped / input.ticks.length > 0.02)
    notes.push('El micrófono se saturó en varios momentos; baja la ganancia o aléjate un poco.');
  return {
    method: DEFENSE_METHOD,
    id: input.id,
    createdAt: input.createdAt,
    title: input.title,
    difficulty: input.difficulty,
    mode: input.mode,
    targetMinutes: input.targetMinutes,
    cameraUsed: input.ticks.some((t) => t.face !== null),
    transcriptUsed: input.transcriptUsed,
    exposition: {
      seconds: expSeconds,
      words: expCount.words,
      wpm,
      fillers: expCount.total,
      fillersPer100: expCount.per100,
      topFillers: expCount.byTerm.slice(0, 5),
      longSilences: silences,
      contact: expContact,
    },
    answers,
    findings,
    timeline,
    expositionText: expTexts.join(' ').slice(0, 60000),
    content: null,
    notes,
  };
}
/** Debilidades ordenadas por importancia para practicar primero. */
export function priorities(report: DefenseReport, limit = 3): Finding[] {
  return report.findings
    .filter((f) => f.level === 'mejorar')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}
export function strengths(report: DefenseReport): Finding[] {
  return report.findings.filter((f) => f.level === 'fortaleza').sort((a, b) => b.weight - a.weight);
}
export function reportText(r: DefenseReport): string {
  const lines = [
    `Simulación de defensa: ${r.title}`,
    `Fecha: ${new Date(r.createdAt).toLocaleString('es-CL')}`,
    `Nivel: ${r.difficulty}. Modalidad: ${r.mode}. Tiempo objetivo: ${r.targetMinutes} min.`,
    '',
    'PRIORIDADES PARA MEJORAR',
    ...(priorities(r).length
      ? priorities(r).map(
          (f, i) => `${i + 1}. ${f.title}: ${f.value}. ${f.explanation} Ejercicio: ${f.exercise}`,
        )
      : ['No se detectaron aspectos marcados como prioritarios.']),
    '',
    'FORTALEZAS',
    ...(strengths(r).length
      ? strengths(r).map((f) => `${f.title}: ${f.value}.`)
      : ['Sin fortalezas marcadas.']),
    '',
    'TODAS LAS MEDICIONES',
    ...r.findings.map((f) => `${f.title} (${f.level}): ${f.value}. ${f.explanation} Método: ${f.method}`),
    '',
    'PREGUNTAS Y RESPUESTAS',
    ...r.answers.flatMap((a, i) => [
      `${i + 1}. [${a.kind}] ${a.question}`,
      `   Respuesta (${Math.round(a.duration)} s, ${a.words} palabras, inicio en ${a.latency === null ? 'sin dato' : `${a.latency.toFixed(1)} s`}): ${a.text || '(sin transcripción)'}`,
      ...(a.feedback ? [`   Comentario: ${a.feedback}`] : []),
    ]),
  ];
  if (r.content)
    lines.push(
      '',
      `COMENTARIO DEL CONTENIDO (${r.content.model})`,
      r.content.resumen,
      ...r.content.fortalezas.map((s) => `Fortaleza: ${s}`),
      ...r.content.mejoras.map((s) => `Mejora: ${s}`),
    );
  lines.push('', ...r.notes);
  return lines.join('\n');
}
