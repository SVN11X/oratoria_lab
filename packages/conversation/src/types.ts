/**
 * Contratos del motor conversacional. Son datos simples y serializables: el motor no depende de
 * React, del navegador ni de un proveedor de IA concreto.
 */
export type ScenarioId = 'tesis' | 'entrevista' | 'presentacion' | 'debate' | 'educativa' | 'dificil';

/** Dificultad académica o técnica de las preguntas. Es independiente del temperamento. */
export type Difficulty = 'basica' | 'intermedia' | 'avanzada' | 'experta' | 'extrema';

/** Estilo interpersonal del interlocutor. No cambia la calificación, solo la forma de interactuar. */
export type Temperament = 'amable' | 'cordial' | 'serio' | 'esceptico' | 'exigente' | 'desafiante';

/** Etapas de la presión progresiva. */
export type Stage =
  'introduccion' | 'fundamentos' | 'inconsistencias' | 'objeciones' | 'sintesis' | 'integracion';

/** Cómo respondió la persona, según reglas explícitas o el modelo evaluador. */
export type AnswerType =
  | 'correcta'
  | 'parcial'
  | 'no_comprende'
  | 'contradice_documento'
  | 'sin_sustento'
  | 'reconoce_limitacion'
  | 'pide_reformulacion'
  | 'evade'
  | 'sin_respuesta';

export type MoveKind =
  'saludo' | 'pregunta' | 'repregunta' | 'interrupcion' | 'reaccion' | 'reformulacion' | 'aviso' | 'cierre';

/** Quién produjo el texto: un modelo de lenguaje o las reglas del motor. */
export type Generator = 'ia' | 'reglas';

export type Citation = {
  docId: string;
  docName: string;
  chunkId: string;
  /** Página, diapositiva o sección legible, por ejemplo «pág. 41 · 3.2 Metodología». */
  location: string;
  excerpt: string;
};

/** Fragmento recuperado del material del usuario. */
export type RetrievedChunk = Citation & { text: string; score: number };

export type AvatarLook = {
  gender: 'f' | 'm';
  age: 'joven' | 'media' | 'mayor';
  skin: number;
  hair: number;
  hairStyle: 'corto' | 'largo' | 'recogido' | 'calvo' | 'rizado' | 'canoso';
  outfit: 'traje' | 'camisa' | 'blusa' | 'sweater' | 'chaqueta';
  accent: number;
  glasses: boolean;
  beard: boolean;
};

export type VoiceProfile = {
  gender: 'f' | 'm';
  /** Ajustes base; el temperamento los modula al hablar. */
  pitch: number;
  rate: number;
  /** Voz concreta elegida por el usuario (id del motor de voz). Vacío = automática. */
  voiceKey: string;
};

export type Participant = {
  id: string;
  name: string;
  roleId: string;
  role: string;
  specialty: string;
  temperament: Temperament;
  difficulty: Difficulty;
  /** Qué busca evaluar o conseguir este interlocutor. */
  goals: string[];
  /** Áreas temáticas que pregunta (ids de AreaDef). */
  areas: string[];
  look: AvatarLook;
  voice: VoiceProfile;
};

export type FieldDef = {
  id: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
  required?: boolean;
};

export type AreaDef = {
  id: string;
  name: string;
  /** Palabras para recuperar material relacionado. */
  query: string;
  /** Plantillas por nivel de profundidad. {tema} = tema de la práctica. */
  base: string[];
  deep: string[];
  extreme: string[];
  /** Plantillas que usan una afirmación concreta del material: {cita} y {ubicacion}. */
  grounded: string[];
  /** Momento en que tiene sentido: «final» solo en la última pregunta, «tarde» desde la mitad. */
  when?: 'final' | 'tarde';
};

export type Dimension = 'contenido' | 'verbal' | 'vocal' | 'no_verbal' | 'interpersonal';

export type CriterionDef = {
  id: string;
  name: string;
  dimension: Dimension;
  /** Conducta observable. */
  indicator: string;
  whyItMatters: string;
  /** Descriptores 0 a 3: inicial, en desarrollo, logrado, destacado. */
  levels: [string, string, string, string];
  weight: number;
  /** Fuentes que pueden evaluar el criterio, en orden de preferencia. */
  methods: ('medicion' | 'reglas' | 'ia')[];
  /** Hallazgo medido que lo alimenta (ids de @oratoria/defense). */
  metric?: string;
  improve: string;
};

export type RoleTemplate = {
  id: string;
  role: string;
  specialty: string;
  areas: string[];
  goals: string[];
  temperament: Temperament;
  /** Rol que abre y cierra la sesión. */
  chair?: boolean;
};

export type ScenarioDef = {
  id: ScenarioId;
  name: string;
  short: string;
  description: string;
  /** Primera parte de la práctica: exposición, declaración inicial o ninguna. */
  opening: { kind: 'exposicion' | 'apertura' | 'ninguna'; label: string; minutes: number };
  /** Qué representa a la persona: «estudiante», «candidata o candidato», etc. */
  userRole: string;
  topicLabel: string;
  topicPlaceholder: string;
  fields: FieldDef[];
  materialHint: string;
  roles: RoleTemplate[];
  defaultRoles: string[];
  areas: AreaDef[];
  criteria: CriterionDef[];
  /** Qué distingue una buena respuesta en este escenario (para el evaluador). */
  answerFocus: string;
  greeting: string[];
  closing: string[];
  defaults: {
    questions: number;
    difficulty: Difficulty;
    progressive: boolean;
    interruptions: boolean;
    followUps: boolean;
  };
  maxParticipants: number;
};

export type SessionConfig = {
  scenario: ScenarioId;
  topic: string;
  context: Record<string, string>;
  participants: Participant[];
  /** Preguntas principales; las repreguntas se suman aparte. */
  questions: number;
  progressive: boolean;
  followUps: boolean;
  interruptions: boolean;
  /** Si hay exposición inicial, en minutos; 0 = sin exposición. */
  openingMinutes: number;
  /** Ensayo centrado en una diapositiva; otros documentos sirven como respaldo. */
  focus?: { docId: string; slide: number } | null;
};

export type Move = {
  id: string;
  kind: MoveKind;
  speakerId: string;
  text: string;
  area: string | null;
  stage: Stage;
  sources: Citation[];
  /** Por qué el motor eligió esta intervención, en lenguaje simple. */
  reason: string;
  generator: Generator;
  /** Clasificación de la respuesta que provocó esta intervención. */
  answerType?: AnswerType;
  /** Reacción breve dicha antes de la pregunta (ya incluida al inicio de `text`). */
  reaction?: string;
  /** Pregunta sin frases de estilo, para reformular o citarla después. */
  core?: string;
};

export type AnswerAnalysis = {
  type: AnswerType;
  words: number;
  /** Proporción de términos clave de la pregunta presentes en la respuesta (0–1). */
  overlap: number;
  justification: boolean;
  evidence: boolean;
  example: boolean;
  hedges: number;
  absolutes: string[];
  limitation: boolean;
  /** Cifras de la respuesta que no coinciden con el material. */
  contradictions: { said: string; source: string; location: string }[];
  /** Marcas propias del escenario (STAR, refutación, mensajes «yo», etc.). */
  markers: string[];
  notes: string[];
  generator: Generator;
};

export type TurnRecord = {
  question: Move;
  answer: {
    text: string;
    durationSec: number;
    latencySec: number | null;
    interrupted: boolean;
    analysis: AnswerAnalysis;
    feedback: string | null;
  } | null;
};

export type EngineStatus = 'idle' | 'opening' | 'exposition' | 'questions' | 'closing' | 'finished';

/** Puerto hacia un modelo de lenguaje. El motor no sabe si es Ollama, LM Studio u otro servicio. */
export interface LlmPort {
  readonly model: string;
  complete(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    options: {
      json: boolean;
      /** Esquema JSON opcional para salidas estructuradas (Ollama `format`). */
      schema?: Record<string, unknown>;
      signal?: AbortSignal;
      timeoutMs?: number;
      temperature?: number;
    },
  ): Promise<string>;
}

export type Retriever = (query: string, k: number) => Promise<RetrievedChunk[]>;
