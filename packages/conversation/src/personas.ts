import type {
  AnswerType,
  AvatarLook,
  Difficulty,
  Participant,
  RoleTemplate,
  Stage,
  Temperament,
} from './types';

export const TEMPERAMENTS: Record<
  Temperament,
  {
    name: string;
    summary: string;
    /** Instrucciones de estilo para el modelo de lenguaje. */
    style: string;
    /** Probabilidad base de repreguntar ante una respuesta débil. */
    followUp: number;
    /** Segundos que tolera una respuesta larga antes de pedir síntesis. */
    patience: number;
    /** Propensión a interrumpir una exposición (0–1). */
    interrupts: number;
    /** Modulación de la voz: tono, velocidad y pausas entre frases (ms). */
    voice: { pitch: number; rate: number; pause: number; emphasis: number };
  }
> = {
  amable: {
    name: 'Amable',
    summary: 'Tono cercano, escucha, permite aclaraciones y mantiene la exigencia académica sin intimidar.',
    style:
      'Hablas con calidez y cercanía. Reconoces lo que está bien antes de profundizar. Formulas preguntas claras y permites aclaraciones. No bajas la exigencia del contenido.',
    followUp: 0.45,
    patience: 150,
    interrupts: 0.1,
    voice: { pitch: 1.04, rate: 0.96, pause: 420, emphasis: 0 },
  },
  cordial: {
    name: 'Cordial y riguroso',
    summary: 'Respetuoso y ordenado; pide precisión y evidencia con buenas maneras.',
    style:
      'Eres respetuoso y ordenado. Agradeces brevemente y luego pides precisión y evidencia concreta. Eres riguroso sin dureza.',
    followUp: 0.6,
    patience: 120,
    interrupts: 0.25,
    voice: { pitch: 1, rate: 1, pause: 360, emphasis: 0.2 },
  },
  serio: {
    name: 'Serio y formal',
    summary: 'Formal y preciso; evita comentarios innecesarios y exige respuestas directas.',
    style:
      'Hablas de forma formal y económica. No haces comentarios de cortesía innecesarios. Priorizas la precisión conceptual y pides justificaciones específicas y respuestas directas.',
    followUp: 0.65,
    patience: 100,
    interrupts: 0.35,
    voice: { pitch: 0.95, rate: 0.98, pause: 300, emphasis: 0.3 },
  },
  esceptico: {
    name: 'Escéptico',
    summary: 'Cuestiona supuestos, busca contradicciones y no acepta respuestas vagas.',
    style:
      'Dudas de las afirmaciones hasta ver evidencia. Cuestionas supuestos, buscas contradicciones, pides fuentes y datos. No aceptas respuestas vagas. Usas preguntas que contrastan afirmaciones con evidencia.',
    followUp: 0.85,
    patience: 90,
    interrupts: 0.5,
    voice: { pitch: 0.97, rate: 0.94, pause: 520, emphasis: 0.5 },
  },
  exigente: {
    name: 'Muy exigente',
    summary: 'Plantea escenarios complejos, exige dominio profundo y detecta respuestas incompletas.',
    style:
      'Exiges dominio conceptual profundo. Planteas escenarios complejos, contrastas metodología con conclusiones, detectas respuestas incompletas y pides argumentos verificables.',
    followUp: 0.9,
    patience: 75,
    interrupts: 0.65,
    voice: { pitch: 0.96, rate: 1.03, pause: 280, emphasis: 0.6 },
  },
  desafiante: {
    name: 'Desafiante',
    summary:
      'Presión académica directa: objeta afirmaciones débiles, pide defender decisiones y puede mostrar desacuerdo profesional.',
    style:
      'Mantienes presión académica. Formulas objeciones directas, cuestionas afirmaciones débiles, pides respuestas concretas y que defienda sus decisiones. Puedes mostrar desacuerdo profesional. La presión viene de la calidad de tus preguntas, nunca de ataques personales.',
    followUp: 0.95,
    patience: 60,
    interrupts: 0.8,
    voice: { pitch: 0.93, rate: 1.06, pause: 240, emphasis: 0.8 },
  },
};

export const DIFFICULTIES: Record<
  Difficulty,
  {
    name: string;
    summary: string;
    style: string;
    maxStage: Stage;
    minStage: Stage;
    maxFollowUps: number;
    words: number;
  }
> = {
  basica: {
    name: 'Básica',
    summary: 'Comprensión general, propósito y conceptos centrales.',
    style: 'Preguntas de comprensión general sobre propósito, conceptos y decisiones principales.',
    maxStage: 'fundamentos',
    minStage: 'introduccion',
    maxFollowUps: 1,
    words: 30,
  },
  intermedia: {
    name: 'Intermedia',
    summary: 'Justificación de decisiones y relación entre partes del trabajo.',
    style: 'Preguntas que piden justificar decisiones y relacionar partes del trabajo entre sí.',
    maxStage: 'inconsistencias',
    minStage: 'introduccion',
    maxFollowUps: 1,
    words: 35,
  },
  avanzada: {
    name: 'Avanzada',
    summary: 'Alternativas, supuestos, validez y límites de los resultados.',
    style:
      'Preguntas sobre alternativas descartadas, supuestos, validez, confiabilidad y límites de los resultados.',
    maxStage: 'objeciones',
    minStage: 'fundamentos',
    maxFollowUps: 2,
    words: 40,
  },
  experta: {
    name: 'Experta',
    summary: 'Escenarios contrafactuales, explicaciones alternativas y generalización.',
    style:
      'Preguntas de especialista: explicaciones alternativas, escenarios contrafactuales, generalización, comparación con el estado del arte.',
    maxStage: 'sintesis',
    minStage: 'fundamentos',
    maxFollowUps: 2,
    words: 45,
  },
  extrema: {
    name: 'Defensa extrema',
    summary: 'Objeciones encadenadas, síntesis bajo presión y preguntas integradoras.',
    style:
      'Preguntas de máxima exigencia: objeciones encadenadas a partir de lo respondido, inconsistencias entre secciones, síntesis bajo presión de tiempo y preguntas integradoras.',
    maxStage: 'integracion',
    minStage: 'inconsistencias',
    maxFollowUps: 3,
    words: 50,
  },
};

export const STAGES: Stage[] = [
  'introduccion',
  'fundamentos',
  'inconsistencias',
  'objeciones',
  'sintesis',
  'integracion',
];
export const STAGE_TEXT: Record<Stage, { name: string; goal: string }> = {
  introduccion: { name: 'Introducción', goal: 'Preguntas introductorias para situar el trabajo.' },
  fundamentos: { name: 'Fundamentos', goal: 'Justificar decisiones metodológicas y conceptuales.' },
  inconsistencias: {
    name: 'Inconsistencias',
    goal: 'Detectar tensiones entre partes, datos y conclusiones.',
  },
  objeciones: { name: 'Objeciones', goal: 'Defender el trabajo frente a objeciones directas.' },
  sintesis: { name: 'Síntesis', goal: 'Responder breve y preciso bajo restricción de tiempo.' },
  integracion: { name: 'Integración', goal: 'Relacionar todo el trabajo en una respuesta integradora.' },
};
export const stageIndex = (s: Stage) => STAGES.indexOf(s);

/** Nombres ficticios. No corresponden a personas reales identificables. */
const NAMES = {
  f: [
    'Valentina Araya',
    'Paula Cifuentes',
    'Javiera Lagos',
    'Carolina Fuenzalida',
    'Ignacia Bravo',
    'Daniela Riquelme',
    'Francisca Olave',
    'Antonia Saavedra',
  ],
  m: [
    'Andrés Valdivia',
    'Matías Contreras',
    'Rodrigo Henríquez',
    'Felipe Navarrete',
    'Tomás Ugarte',
    'Gonzalo Pizarro',
    'Cristián Moya',
    'Sebastián Orrego',
  ],
};
const TITLE: Record<string, { f: string; m: string } | null> = {
  academic: { f: 'Dra.', m: 'Dr.' },
  prof: { f: 'Prof.', m: 'Prof.' },
};

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
export const pick = <T>(list: readonly T[], rng: () => number): T =>
  list[Math.floor(rng() * list.length) % list.length]!;

/** Apariencia por defecto, variada y determinista según el índice. */
export function defaultLook(index: number, gender: 'f' | 'm'): AvatarLook {
  const styles: AvatarLook['hairStyle'][] =
    gender === 'f'
      ? ['largo', 'recogido', 'rizado', 'corto', 'canoso']
      : ['corto', 'calvo', 'rizado', 'canoso', 'corto'];
  const outfits: AvatarLook['outfit'][] =
    gender === 'f' ? ['blusa', 'chaqueta', 'sweater', 'traje'] : ['traje', 'camisa', 'chaqueta', 'sweater'];
  const ages: AvatarLook['age'][] = ['media', 'mayor', 'joven', 'media'];
  const hairStyle = styles[index % styles.length]!;
  return {
    gender,
    age: hairStyle === 'canoso' ? 'mayor' : ages[index % ages.length]!,
    skin: (index * 3 + (gender === 'f' ? 1 : 0)) % 6,
    hair: hairStyle === 'canoso' ? 5 : (index * 2 + 1) % 5,
    hairStyle,
    outfit: outfits[index % outfits.length]!,
    accent: (index * 5 + 2) % 8,
    glasses: index % 3 === 1,
    beard: gender === 'm' && index % 4 === 2,
  };
}

/** Crea interlocutores a partir de los roles del escenario. */
export function createParticipants(
  roles: RoleTemplate[],
  difficulty: Difficulty,
  options: { academic?: boolean; seed?: number } = {},
): Participant[] {
  const rng = seeded(options.seed ?? 11);
  const used = new Set<string>();
  return roles.map((r, i) => {
    const gender: 'f' | 'm' = i % 2 === 0 ? 'f' : 'm';
    let name = pick(NAMES[gender], rng);
    for (let n = 0; used.has(name) && n < 20; n++) name = pick(NAMES[gender], rng);
    used.add(name);
    const title = options.academic ? TITLE[i === 0 ? 'academic' : 'prof']![gender] : '';
    return {
      id: `p${i + 1}`,
      name: title ? `${title} ${name}` : name,
      roleId: r.id,
      role: r.role,
      specialty: r.specialty,
      temperament: r.temperament,
      difficulty,
      goals: [...r.goals],
      areas: [...r.areas],
      look: defaultLook(i, gender),
      voice: { gender, pitch: gender === 'f' ? 1.08 : 0.9, rate: 1, voiceKey: '' },
    };
  });
}

/** Ajusta la voz del interlocutor a su temperamento. */
export function voiceFor(p: Participant) {
  const t = TEMPERAMENTS[p.temperament].voice;
  return {
    pitch: Math.max(0.5, Math.min(1.6, p.voice.pitch * t.pitch)),
    rate: Math.max(0.6, Math.min(1.5, p.voice.rate * t.rate)),
    pause: t.pause,
    emphasis: t.emphasis,
  };
}

/** Prefijos y cierres de estilo para preguntas generadas por reglas. El contenido viene de la plantilla. */
const OPENERS: Record<Temperament, { usted: string[]; tu: string[] }> = {
  amable: {
    usted: ['Me interesa entender mejor un punto.', 'Gracias. Quisiera profundizar un poco.'],
    tu: ['Oye, quiero entender algo.', 'Me gustaría entenderte mejor.'],
  },
  cordial: {
    usted: ['Gracias.', 'Muy bien. Quisiera pedirle precisión en lo siguiente.'],
    tu: ['Bien.', 'Ok, te entiendo.'],
  },
  serio: { usted: ['Pregunta.', 'Siguiente punto.'], tu: ['Mira.', 'A ver.'] },
  esceptico: { usted: ['Tengo una duda.', 'No me queda claro un punto.'], tu: ['No sé.', 'No me cuadra.'] },
  exigente: {
    usted: ['Necesito precisión en lo siguiente.', 'Vamos a un punto central.'],
    tu: ['Necesito que seas concreto.', 'Vamos al punto.'],
  },
  desafiante: {
    usted: ['Voy a ser directo.', 'No estoy convencido.'],
    tu: ['Te voy a ser directo.', 'No estoy de acuerdo.'],
  },
};
const CLOSERS: Record<Temperament, { usted: string[]; tu: string[] }> = {
  amable: { usted: ['Tómese su tiempo.'], tu: ['Con calma.'] },
  cordial: { usted: [''], tu: [''] },
  serio: { usted: ['Sea específico.'], tu: ['Sé específico.'] },
  esceptico: { usted: ['¿Con qué evidencia lo sostiene?'], tu: ['¿Cómo lo sabes?'] },
  exigente: { usted: ['Sea preciso, por favor.'], tu: ['Sé concreto, por favor.'] },
  desafiante: { usted: ['Defienda esa decisión.'], tu: ['Explícame por qué.'] },
};
/**
 * Da estilo a una pregunta según el temperamento: a veces con una frase de entrada y, con menos
 * frecuencia, con un cierre. Evita repetir la misma entrada que usó la vez anterior.
 */
export function styleQuestion(
  text: string,
  t: Temperament,
  rng: () => number,
  options: { tu?: boolean; last?: string } = {},
): string {
  const form = options.tu ? 'tu' : 'usted';
  const openers = OPENERS[t][form].filter((o) => o !== options.last);
  const opener = rng() < 0.55 ? pick(openers, rng) : '';
  let closer = rng() < 0.3 ? pick(CLOSERS[t][form], rng) : '';
  if (
    closer &&
    /evidencia|defienda|por qué|cómo lo sabes/i.test(closer) &&
    /evidencia|defiend|justific|por qué|cómo lo sab/i.test(text)
  )
    closer = '';
  if (/^(Vuelvo|Volvamos|Para cerrar|Para terminar|Cierre|En dos minutos|Entonces)/.test(text))
    return [text, closer].filter(Boolean).join(' ');
  return [opener, text, closer].filter(Boolean).join(' ');
}
export const openerOf = (text: string) =>
  Object.values(OPENERS)
    .flatMap((o) => [...o.usted, ...o.tu])
    .find((o) => text.startsWith(o)) ?? '';

/**
 * Reacciones breves según el temperamento y el tipo de respuesta. Ninguna contiene ataques
 * personales: la presión viene de la exigencia del contenido.
 */
export const REACTIONS: Record<Temperament, Partial<Record<AnswerType, string[]>>> = {
  amable: {
    correcta: ['Muy bien, quedó claro.', 'Gracias, es una buena respuesta.'],
    parcial: [
      'Va bien encaminado. Me gustaría que profundizara un poco más.',
      'Gracias. Creo que falta una parte.',
    ],
    no_comprende: ['No se preocupe, la planteo de otra manera.'],
    pide_reformulacion: ['Por supuesto, la reformulo.'],
    sin_sustento: ['Entiendo la idea. Me ayudaría ver en qué se apoya.'],
    contradice_documento: ['Creo que eso no coincide con lo que está en su documento. Revisémoslo juntos.'],
    reconoce_limitacion: ['Es valioso que reconozca esa limitación.'],
    evade: ['Volvamos a la pregunta, con calma.'],
    sin_respuesta: ['Tómese un momento si lo necesita.'],
  },
  cordial: {
    correcta: ['Bien, gracias.', 'Correcto, gracias por la precisión.'],
    parcial: ['Gracias. Le falta precisión en un punto.', 'Bien, pero quedó incompleto.'],
    no_comprende: ['La reformulo.'],
    pide_reformulacion: ['Claro, la reformulo.'],
    sin_sustento: ['Gracias. Necesito que respalde esa afirmación.'],
    contradice_documento: ['Eso no coincide con lo que su documento indica.'],
    reconoce_limitacion: ['Gracias por reconocerlo con claridad.'],
    evade: ['Le pido que responda la pregunta planteada.'],
    sin_respuesta: ['Cuando esté listo.'],
  },
  serio: {
    correcta: ['Correcto.', 'Entendido.'],
    parcial: ['Incompleto.', 'Eso responde solo una parte.'],
    no_comprende: ['La planteo nuevamente.'],
    pide_reformulacion: ['Reformulo.'],
    sin_sustento: ['Eso requiere justificación.'],
    contradice_documento: ['Eso no es lo que dice su documento.'],
    reconoce_limitacion: ['Tomo nota de la limitación.'],
    evade: ['No respondió la pregunta.'],
    sin_respuesta: ['Esperamos su respuesta.'],
  },
  esceptico: {
    correcta: ['Puede ser. Lo acepto por ahora.', 'Bien, eso tiene más sustento.'],
    parcial: ['No me convence del todo.', 'Hay algo que no cuadra.'],
    no_comprende: ['Lo digo de otra forma.'],
    pide_reformulacion: ['La reformulo.'],
    sin_sustento: ['Eso es una afirmación. ¿Dónde está la evidencia?', 'Afirmarlo no lo demuestra.'],
    contradice_documento: [
      'Curioso: su documento dice otra cosa.',
      'Eso contradice lo que usted mismo escribió.',
    ],
    reconoce_limitacion: ['Al menos lo reconoce. Eso cambia el alcance de sus conclusiones.'],
    evade: ['Esa no fue mi pregunta.'],
    sin_respuesta: ['¿No tiene respuesta para eso?'],
  },
  exigente: {
    correcta: ['Bien. Vamos más a fondo.', 'Correcto. Ahora un nivel más.'],
    parcial: ['Insuficiente. Falta lo esencial.', 'Eso es incompleto.'],
    no_comprende: ['La reformulo, atienda a la diferencia.'],
    pide_reformulacion: ['La reformulo.'],
    sin_sustento: ['Necesito un argumento verificable, no una opinión.'],
    contradice_documento: ['Hay una inconsistencia con su documento que debe explicar.'],
    reconoce_limitacion: ['Bien que lo reconozca. Ahora dígame cómo la abordaría.'],
    evade: ['No se desvíe. Responda lo que pregunté.'],
    sin_respuesta: ['Necesito una respuesta.'],
  },
  desafiante: {
    correcta: ['Bien. Pero no me quedo ahí.', 'Aceptable. Sigo.'],
    parcial: ['Eso es una afirmación, no una justificación.', 'No me convence.'],
    no_comprende: ['Se lo pregunto de forma más directa.'],
    pide_reformulacion: ['La planteo de forma más directa.'],
    sin_sustento: ['Eso es una afirmación, no una justificación.', 'No basta con decirlo; demuéstrelo.'],
    contradice_documento: ['Eso contradice su propio documento.', 'Usted escribió algo distinto.'],
    reconoce_limitacion: [
      'Reconocerlo es correcto. Ahora defienda por qué sus conclusiones siguen siendo válidas.',
    ],
    evade: ['Está evitando la pregunta.', 'No respondió lo que le pregunté.'],
    sin_respuesta: ['Le escucho.'],
  },
};

export function reactionFor(
  t: Temperament,
  type: AnswerType,
  rng: () => number,
  avoid: string[] = [],
): string {
  const options = REACTIONS[t][type] ?? REACTIONS.cordial[type] ?? [''];
  const fresh = options.filter((o) => !avoid.includes(o));
  return pick(fresh.length ? fresh : options, rng);
}

/**
 * Palabras y expresiones que no deben aparecer en boca de un evaluador: insultos,
 * humillaciones o descalificaciones personales. Se usa para filtrar textos generados por IA.
 */
const ABUSE = [
  'idiota',
  'estupido',
  'estupida',
  'tonto',
  'tonta',
  'imbecil',
  'inutil',
  'incompetente',
  'mediocre',
  'ridiculo',
  'ridicula',
  'vergonzoso',
  'verguenza',
  'patetico',
  'patetica',
  'ignorante',
  'burro',
  'burra',
  'flojo',
  'floja',
  'payaso',
  'basura',
  'callese',
  'cállate',
  'no sirve para nada',
  'no sabe nada',
  'deberia retirarse',
  'no merece',
  'es un fracaso',
  'usted es incapaz',
  'que lastima',
];
const fold = (s: string) =>
  s
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
/** Devuelve las expresiones abusivas encontradas (vacío si el texto es aceptable). */
export function civilityIssues(text: string): string[] {
  const t = ` ${fold(text).replace(/[^\p{L}\p{N} ]+/gu, ' ')} `;
  return ABUSE.filter((w) => t.includes(` ${fold(w)} `));
}
