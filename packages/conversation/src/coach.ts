import type { CriterionResult } from './evaluation';
import type { Difficulty, ScenarioId, SessionConfig } from './types';

/** Ejercicio dirigido: qué practicar, cómo y cómo se verificará el progreso. */
export type Exercise = {
  criterionId: string;
  title: string;
  why: string;
  steps: string[];
  /** Cómo se comprueba en la próxima sesión comparable. */
  verify: string;
  /** Ajustes de una práctica breve enfocada en esta habilidad. */
  preset: Partial<
    Pick<SessionConfig, 'questions' | 'progressive' | 'followUps' | 'interruptions' | 'openingMinutes'>
  > & {
    difficulty?: Difficulty;
  };
};

const CATALOG: Record<string, Omit<Exercise, 'criterionId'>> = {
  sintesis: {
    title: 'Síntesis en un minuto',
    why: 'Tus respuestas tienden a extenderse o quedarse cortas.',
    steps: [
      'Responde cada pregunta en 60 segundos como máximo.',
      'Empieza por la conclusión, luego una razón y un ejemplo.',
      'Termina con una frase de cierre en vez de seguir agregando ideas.',
    ],
    verify:
      'Se compara la mediana de palabras por respuesta y el nivel de «Capacidad de síntesis» con tu sesión anterior del mismo escenario.',
    preset: { questions: 4, progressive: false, followUps: true, interruptions: true, openingMinutes: 0 },
  },
  fundamentacion: {
    title: 'Cada afirmación con su evidencia',
    why: 'Varias afirmaciones quedaron sin datos, resultados o ejemplos.',
    steps: [
      'Antes de la práctica, anota tres cifras o resultados clave y dónde aparecen.',
      'En cada respuesta usa la estructura: afirmación, porque, dato.',
      'Si no tienes el dato, dilo y explica cómo lo obtendrías.',
    ],
    verify: 'Se compara el porcentaje de respuestas que combinan razón y evidencia.',
    preset: { questions: 4, progressive: false, followUps: true, openingMinutes: 0, difficulty: 'avanzada' },
  },
  objeciones: {
    title: 'Responder objeciones en tres pasos',
    why: 'Ante repreguntas u objeciones, la respuesta no aportó argumentos nuevos.',
    steps: [
      'Reconoce la objeción: «Es un punto válido».',
      'Responde con un argumento o dato nuevo.',
      'Cierra reafirmando tu conclusión.',
    ],
    verify: 'Se compara la proporción de repreguntas respondidas con argumentos.',
    preset: { questions: 4, progressive: true, followUps: true, openingMinutes: 0, difficulty: 'experta' },
  },
  pertinencia: {
    title: 'Responder la pregunta que te hicieron',
    why: 'Algunas respuestas se desviaron de la pregunta.',
    steps: [
      'Repite mentalmente el núcleo de la pregunta antes de responder.',
      'Empieza la respuesta con esas mismas palabras.',
      'Si te vas a otro tema, vuelve con «En resumen, respecto de su pregunta…».',
    ],
    verify: 'Se compara la coincidencia temática entre preguntas y respuestas.',
    preset: { questions: 5, progressive: false, followUps: true, openingMinutes: 0 },
  },
  turnos: {
    title: 'Empezar a responder sin silencios largos',
    why: 'Tardas en empezar a responder o te interrumpen por extenderte.',
    steps: [
      'Ten preparadas frases de entrada: «Lo explico en dos partes…».',
      'Empieza a hablar en menos de 3 segundos.',
      'Mira el reloj de la sala y cierra antes del minuto y medio.',
    ],
    verify: 'Se compara la mediana de segundos hasta la primera voz y las interrupciones por extensión.',
    preset: { questions: 5, progressive: false, followUps: false, interruptions: true, openingMinutes: 0 },
  },
  asertividad: {
    title: 'Afirmar sin «creo que»',
    why: 'Usas muchas expresiones de duda en puntos que podrías afirmar.',
    steps: [
      'Graba tus respuestas y cuenta cuántas veces dices «creo que».',
      'Reformula empezando por la conclusión: «Sí, porque…».',
      'Reserva la duda para lo que realmente no sabes, y dilo una sola vez.',
    ],
    verify: 'Se comparan las expresiones de duda cada 100 palabras.',
    preset: { questions: 4, progressive: false, followUps: true, openingMinutes: 0 },
  },
  dominio_metodologico: {
    title: 'Defender cada decisión metodológica',
    why: 'Describes qué hiciste, pero no siempre por qué ni qué alternativas descartaste.',
    steps: [
      'Lista tus 5 decisiones metodológicas principales.',
      'Para cada una escribe: qué elegiste, qué descartaste y por qué.',
      'Practica con un evaluador metodológico escéptico.',
    ],
    verify: 'Se compara el nivel de «Dominio metodológico» en la próxima defensa.',
    preset: { questions: 4, progressive: true, followUps: true, openingMinutes: 0, difficulty: 'experta' },
  },
  limitaciones: {
    title: 'Limitaciones con su efecto',
    why: 'Las limitaciones se mencionaron de forma vaga o no se reconocieron.',
    steps: [
      'Escribe tres limitaciones concretas.',
      'Para cada una indica cuánto afecta las conclusiones.',
      'Añade cómo la abordarías en un trabajo futuro.',
    ],
    verify: 'Se compara el nivel de «Reconocimiento de limitaciones».',
    preset: { questions: 3, progressive: false, followUps: true, openingMinutes: 0 },
  },
  coherencia_documento: {
    title: 'Cifras clave de memoria',
    why: 'Algunas cifras dichas no coincidieron con tu documento.',
    steps: [
      'Haz una ficha con las 10 cifras más importantes y su sección.',
      'Repásala en voz alta antes de practicar.',
      'Ante la duda, di el rango y la sección donde está el dato.',
    ],
    verify: 'Se compara la cantidad de cifras contradictorias detectadas.',
    preset: { questions: 5, progressive: false, followUps: true, openingMinutes: 0 },
  },
  star: {
    title: 'Historias STAR',
    why: 'Tus ejemplos no siempre muestran acción y resultado.',
    steps: [
      'Prepara 5 historias: situación, tarea, acción, resultado.',
      'Cuantifica cada resultado.',
      'Cuenta cada historia en menos de dos minutos.',
    ],
    verify: 'Se compara el promedio de partes STAR por respuesta conductual.',
    preset: { questions: 4, progressive: false, followUps: true, openingMinutes: 0 },
  },
  escucha: {
    title: 'Reformular antes de responder',
    why: 'Pocas respuestas retoman lo planteado por el interlocutor.',
    steps: [
      'Ante preguntas complejas, reformula: «Si entiendo bien, me pregunta…».',
      'Responde exactamente eso.',
      'Comprueba: «¿Responde eso a su pregunta?».',
    ],
    verify: 'Se compara la frecuencia con que retomas la pregunta.',
    preset: { questions: 4, progressive: false, followUps: true, openingMinutes: 0 },
  },
};
const GENERIC = (c: CriterionResult): Omit<Exercise, 'criterionId'> => ({
  title: `Practicar «${c.name}»`,
  why: c.observed,
  steps: [
    c.improve,
    'Repite una práctica breve enfocada solo en este punto.',
    'Revisa tu grabación buscando este aspecto.',
  ],
  verify: `Se compara el nivel de «${c.name}» con tu sesión anterior del mismo escenario.`,
  preset: { questions: 3, progressive: false, followUps: true, openingMinutes: 0 },
});

/** Plan de entrenamiento: los criterios evaluados más débiles, ordenados por peso. */
export function coachPlan(results: CriterionResult[], limit = 3): Exercise[] {
  return results
    .filter((r) => r.level !== null && r.level <= 1)
    .sort((a, b) => a.level! - b.level! || b.weight - a.weight)
    .slice(0, limit)
    .map((r) => ({ criterionId: r.id, ...(CATALOG[r.id] ?? GENERIC(r)) }));
}

export type ProgressVerdict = 'mejoró' | 'se mantiene' | 'empeoró' | 'sin datos';
/** Compara un criterio entre dos sesiones comparables (mismo escenario). */
export function compareCriterion(
  before: CriterionResult | undefined,
  after: CriterionResult | undefined,
): ProgressVerdict {
  if (!before || !after || before.level === null || after.level === null) return 'sin datos';
  return after.level > before.level ? 'mejoró' : after.level < before.level ? 'empeoró' : 'se mantiene';
}
export type HistoryPoint = {
  id: string;
  createdAt: string;
  scenario: ScenarioId;
  difficulty: Difficulty;
  criteria: CriterionResult[];
};
/** Sesión anterior comparable: mismo escenario; prefiere la misma dificultad. */
export function previousComparable(history: HistoryPoint[], current: HistoryPoint): HistoryPoint | undefined {
  const older = history
    .filter((h) => h.id !== current.id && h.scenario === current.scenario && h.createdAt < current.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return older.find((h) => h.difficulty === current.difficulty) ?? older[0];
}
/** Habilidades prioritarias: criterios que quedaron en nivel 0 o 1 con más frecuencia. */
export function prioritySkills(history: HistoryPoint[], limit = 4) {
  const counts = new Map<string, { name: string; weak: number; seen: number; last: number | null }>();
  for (const h of [...history].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    for (const c of h.criteria) {
      if (c.level === null) continue;
      const e = counts.get(c.id) ?? { name: c.name, weak: 0, seen: 0, last: null };
      e.seen++;
      if (c.level <= 1) e.weak++;
      e.last = c.level;
      counts.set(c.id, e);
    }
  return [...counts]
    .map(([id, e]) => ({ id, ...e, rate: e.weak / e.seen }))
    .filter((e) => e.weak > 0)
    .sort((a, b) => b.rate - a.rate || b.weak - a.weak)
    .slice(0, limit);
}
