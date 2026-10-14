export const SCENARIOS = [
  {
    id: 'tesis',
    name: 'Defensa de tesis',
    description: 'Explica decisiones, evidencias y límites de tu investigación.',
    questions: [
      '¿Qué problema aborda tu investigación y por qué merece estudiarse?',
      '¿Cuál es tu pregunta de investigación y cómo se relaciona con tu objetivo?',
      '¿Por qué elegiste esta metodología y qué alternativas consideraste?',
      '¿Qué resultado respalda mejor tu conclusión?',
      '¿Qué limitación podría cambiar la interpretación de tus resultados?',
      '¿Qué siguiente estudio propondrías y por qué?',
    ],
  },
  {
    id: 'entrevista',
    name: 'Entrevista laboral',
    description: 'Practica respuestas con situaciones, acciones y resultados.',
    questions: [
      '¿Qué experiencia tuya se relaciona con este cargo?',
      'Describe una dificultad laboral y la acción que tomaste.',
      '¿Qué resultado obtuviste y cómo lo verificaste?',
      'Cuéntame una ocasión en que recibiste retroalimentación difícil.',
      '¿Cómo priorizarías tareas con plazos simultáneos?',
      '¿Qué necesitas aprender para desempeñarte mejor en este cargo?',
    ],
  },
  {
    id: 'presentacion',
    name: 'Presentación profesional',
    description: 'Comunica una propuesta y la decisión que requiere.',
    questions: [
      '¿Qué decisión buscas que tome la audiencia?',
      '¿Qué datos sustentan tu propuesta?',
      '¿Qué alternativas evaluaste?',
      '¿Qué costo o riesgo tiene tu recomendación?',
      '¿Cómo medirías su resultado?',
      '¿Cuál es el siguiente paso concreto?',
    ],
  },
  {
    id: 'debate',
    name: 'Debate académico',
    description: 'Construye una postura con razones y objeciones.',
    questions: [
      '¿Cuál es tu postura sobre el tema?',
      '¿Qué razón principal la respalda?',
      '¿Qué evidencia permite comprobar esa razón?',
      '¿Cuál es la objeción más sólida a tu postura?',
      '¿Qué responderías a esa objeción?',
      '¿En qué condiciones revisarías tu postura?',
    ],
  },
  {
    id: 'educativa',
    name: 'Exposición educativa',
    description: 'Haz comprensible un concepto para tu audiencia.',
    questions: [
      '¿Qué debería comprender la audiencia al terminar?',
      '¿Cómo definirías el concepto central con palabras cotidianas?',
      '¿Qué ejemplo concreto ayuda a entenderlo?',
      '¿Qué confusión frecuente necesitas aclarar?',
      '¿Cómo comprobarías que se comprendió?',
      'Resume la idea central en dos frases.',
    ],
  },
  {
    id: 'dificil',
    name: 'Conversación difícil',
    description: 'Practica hechos, necesidades y acuerdos sin inferir emociones.',
    questions: [
      '¿Qué hecho específico necesitas conversar?',
      '¿Qué efecto tuvo para ti o para el trabajo?',
      '¿Qué necesitas pedir concretamente?',
      '¿Qué perspectiva de la otra persona sería útil escuchar?',
      '¿Qué acuerdo verificable propondrías?',
      '¿Cuándo y cómo revisarían el acuerdo?',
    ],
  },
] as const;
export type PracticeState = {
  status: 'setup' | 'answering' | 'complete';
  scenarioId: string;
  index: number;
  questions: string[];
  answers: string[];
};
export type PracticeAction =
  | { type: 'start'; scenarioId: string; count: number; difficulty: 'inicial' | 'profundizacion' }
  | { type: 'answer'; text: string }
  | { type: 'reset' };
export const INITIAL_PRACTICE: PracticeState = {
  status: 'setup',
  scenarioId: '',
  index: 0,
  questions: [],
  answers: [],
};
export function practiceReducer(state: PracticeState, action: PracticeAction): PracticeState {
  if (action.type === 'reset') return { ...INITIAL_PRACTICE };
  if (action.type === 'start') {
    const scenario = SCENARIOS.find((s) => s.id === action.scenarioId);
    if (!scenario) throw new Error('Escenario desconocido.');
    const ordered =
      action.difficulty === 'profundizacion'
        ? [...scenario.questions.slice(2), ...scenario.questions.slice(0, 2)]
        : [...scenario.questions];
    return {
      status: 'answering',
      scenarioId: scenario.id,
      index: 0,
      questions: ordered.slice(0, Math.max(1, Math.min(6, action.count))),
      answers: [],
    };
  }
  if (state.status !== 'answering' || !action.text.trim()) return state;
  const answers = [...state.answers, action.text.trim()],
    next = state.index + 1;
  return {
    ...state,
    answers,
    index: next,
    status: next >= state.questions.length ? 'complete' : 'answering',
  };
}
