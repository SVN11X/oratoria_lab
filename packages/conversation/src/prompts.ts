import { z } from 'zod';
import { DIFFICULTIES, STAGE_TEXT, TEMPERAMENTS } from './personas';
import type {
  AnswerAnalysis,
  CriterionDef,
  Participant,
  RetrievedChunk,
  ScenarioDef,
  SessionConfig,
  Stage,
  TurnRecord,
} from './types';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = cleaned.indexOf('{'),
    end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('La respuesta del modelo no contiene JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Recorta un texto y lo declara: nunca se recorta en silencio. */
export function clipMarked(text: string, max: number): { text: string; clipped: number } {
  const t = text.trim();
  if (t.length <= max) return { text: t, clipped: 0 };
  return {
    text: `${t.slice(0, max)} […recortado: ${t.length - max} caracteres más]`,
    clipped: t.length - max,
  };
}

const treatment = (s: ScenarioDef) => (s.id === 'dificil' || s.id === 'educativa' ? 'tú' : 'usted');

export function personaSystem(p: Participant, s: ScenarioDef, stage: Stage, others: Participant[]): string {
  const t = TEMPERAMENTS[p.temperament],
    d = DIFFICULTIES[p.difficulty];
  return [
    `Eres ${p.name}, ${p.role}, en una simulación de «${s.name}». Especialidad: ${p.specialty}.`,
    `Tu objetivo: ${p.goals.join('; ')}.`,
    `Temperamento: ${t.name}. ${t.style}`,
    `Dificultad de tus preguntas: ${d.name}. ${d.style}`,
    `Etapa actual de la sesión: ${STAGE_TEXT[stage].name}. ${STAGE_TEXT[stage].goal}`,
    others.length ? `Tus colegas: ${others.map((o) => `${o.name} (${o.role})`).join(', ')}.` : '',
    `La otra persona es ${s.userRole}. Trátala de ${treatment(s)}.`,
    'Reglas:',
    '- Escribe en español claro, con frases naturales que se puedan decir en voz alta.',
    `- Formula una sola pregunta de máximo ${d.words} palabras.`,
    '- Basa tus preguntas en el material entregado y en lo que la persona dijo. No inventes datos, cifras, autores ni referencias bibliográficas.',
    '- Si te apoyas en un fragmento del material, indica su identificador en "fuentes".',
    '- No repitas preguntas ya hechas por ti ni por tus colegas. No contradigas a tus colegas; si discrepas, plantea tu duda como pregunta.',
    '- La presión viene de la exigencia y la calidad de tus preguntas. Nunca insultes, humilles, descalifiques ni comentes características personales de nadie.',
    '- Responde solo con un objeto JSON válido, sin texto antes ni después.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function materialBlock(chunks: RetrievedChunk[], max = 900): string {
  if (!chunks.length) return 'No hay material cargado relacionado con este punto.';
  return chunks
    .map((c, i) => `[S${i + 1}] (${c.docName}, ${c.location}) «${clipMarked(c.text, max).text}»`)
    .join('\n');
}

export function historyBlock(turns: TurnRecord[], names: Map<string, string>, limit = 6): string {
  const recent = turns.slice(-limit);
  if (!recent.length) return 'Todavía no hay preguntas.';
  return recent
    .map((t) => {
      const who = names.get(t.question.speakerId) ?? 'Interlocutor';
      const a = t.answer ? clipMarked(t.answer.text, 600).text || '(sin texto)' : '(sin responder)';
      return `- ${who}: «${t.question.text}»\n  Respuesta: «${a}»`;
    })
    .join('\n');
}

export function contextBlock(config: SessionConfig, s: ScenarioDef): string {
  const fields = s.fields
    .map((f) =>
      config.context[f.id]?.trim() ? `${f.label}: ${clipMarked(config.context[f.id]!, 1500).text}` : '',
    )
    .filter(Boolean);
  return [`${s.topicLabel}: ${config.topic || 'sin indicar'}`, ...fields].join('\n');
}

export const QuestionSchema = z.object({
  pregunta: z.string().min(8).max(500),
  fuentes: z.array(z.string()).max(5).optional().default([]),
  motivo: z.string().max(400).optional().default(''),
});
export const QUESTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    pregunta: { type: 'string' },
    fuentes: { type: 'array', items: { type: 'string' } },
    motivo: { type: 'string' },
  },
  required: ['pregunta'],
};

export function questionPrompt(input: {
  participant: Participant;
  others: Participant[];
  scenario: ScenarioDef;
  config: SessionConfig;
  stage: Stage;
  areaName: string;
  areaQuery: string;
  chunks: RetrievedChunk[];
  exposition: string;
  turns: TurnRecord[];
  asked: string[];
  names: Map<string, string>;
}): ChatMessage[] {
  return [
    { role: 'system', content: personaSystem(input.participant, input.scenario, input.stage, input.others) },
    {
      role: 'user',
      content: [
        `Contexto de la práctica:\n${contextBlock(input.config, input.scenario)}`,
        `Material relevante:\n${materialBlock(input.chunks)}`,
        input.exposition
          ? `Extracto de lo que expuso la persona:\n«${clipMarked(input.exposition, 2500).text}»`
          : '',
        `Conversación reciente:\n${historyBlock(input.turns, input.names)}`,
        input.asked.length
          ? `Preguntas ya hechas (no repetir):\n${input.asked.map((q) => `- ${q}`).join('\n')}`
          : '',
        `Área que te toca explorar ahora: ${input.areaName} (${input.areaQuery}).`,
        'Formula tu siguiente pregunta principal sobre esa área. Si el material tiene una afirmación concreta pertinente, úsala.',
        'Formato exacto: {"pregunta":"...","fuentes":["S1"],"motivo":"por qué esta pregunta, en una frase"}',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

export const DecisionSchema = z.object({
  tipo: z.enum([
    'correcta',
    'parcial',
    'no_comprende',
    'contradice_documento',
    'sin_sustento',
    'reconoce_limitacion',
    'pide_reformulacion',
    'evade',
    'sin_respuesta',
  ]),
  reaccion: z.string().max(300).optional().default(''),
  repregunta: z.string().max(500).nullable().optional(),
  motivo: z.string().max(400).optional().default(''),
  fuentes: z.array(z.string()).max(5).optional().default([]),
});
export const DECISION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: DecisionSchema.shape.tipo.options },
    reaccion: { type: 'string' },
    repregunta: { type: ['string', 'null'] },
    motivo: { type: 'string' },
    fuentes: { type: 'array', items: { type: 'string' } },
  },
  required: ['tipo', 'reaccion'],
};

export function decisionPrompt(input: {
  participant: Participant;
  others: Participant[];
  scenario: ScenarioDef;
  config: SessionConfig;
  stage: Stage;
  question: string;
  answer: string;
  analysis: AnswerAnalysis;
  chunks: RetrievedChunk[];
  allowFollowUp: boolean;
  turns: TurnRecord[];
  names: Map<string, string>;
}): ChatMessage[] {
  const p = input.participant;
  return [
    { role: 'system', content: personaSystem(p, input.scenario, input.stage, input.others) },
    {
      role: 'user',
      content: [
        `Contexto de la práctica:\n${contextBlock(input.config, input.scenario)}`,
        `Material relevante:\n${materialBlock(input.chunks, 700)}`,
        `Conversación previa:\n${historyBlock(input.turns, input.names, 4)}`,
        `Tu pregunta fue: «${input.question}»`,
        `Respuesta de la persona (transcripción automática, puede tener errores de reconocimiento): «${clipMarked(input.answer, 4000).text || '(no se captó texto)'}»`,
        `Análisis automático preliminar (puede equivocarse): tipo sugerido «${input.analysis.type}». ${input.analysis.notes.join(' ')}${
          input.analysis.contradictions.length
            ? ` Posibles contradicciones con el material: ${input.analysis.contradictions.map((c) => `dijo ${c.said}, el material dice ${c.source} (${c.location})`).join('; ')}.`
            : ''
        }`,
        `Criterio de una buena respuesta en este escenario: ${input.scenario.answerFocus}`,
        'Decide como el personaje que eres:',
        '1) "tipo": clasifica la respuesta con uno de: correcta, parcial, no_comprende, contradice_documento, sin_sustento, reconoce_limitacion, pide_reformulacion, evade, sin_respuesta.',
        '2) "reaccion": una frase breve (máximo 20 palabras) coherente con tu temperamento. Sin insultos ni juicios personales.',
        input.allowFollowUp
          ? '3) "repregunta": si la respuesta quedó débil, incompleta, sin evidencia o contradictoria, formula una repregunta que retome algo concreto que dijo la persona. Si pidió reformular o no entendió, reformula tu pregunta con otras palabras. Si fue completa, repregunta solo para profundizar cuando tu temperamento y dificultad lo justifiquen; si no, usa null.'
          : '3) "repregunta": null (no corresponde repreguntar ahora).',
        'Formato exacto: {"tipo":"parcial","reaccion":"...","repregunta":"..." o null,"motivo":"por qué, en una frase","fuentes":["S1"]}',
      ].join('\n\n'),
    },
  ];
}

export const InterruptSchema = z.object({ pregunta: z.string().min(8).max(400) });
export function interruptionPrompt(input: {
  participant: Participant;
  others: Participant[];
  scenario: ScenarioDef;
  config: SessionConfig;
  stage: Stage;
  recent: string;
  chunks: RetrievedChunk[];
}): ChatMessage[] {
  return [
    { role: 'system', content: personaSystem(input.participant, input.scenario, input.stage, input.others) },
    {
      role: 'user',
      content: [
        `Contexto:\n${contextBlock(input.config, input.scenario)}`,
        `Material relevante:\n${materialBlock(input.chunks, 500)}`,
        `Lo último que dijo la persona mientras exponía: «${clipMarked(input.recent, 2000).text}»`,
        'Interrumpe con una pregunta breve sobre algo que acaba de decir y que no quedó claro, no se justificó o no coincide con el material. Empieza con una fórmula de cortesía acorde a tu temperamento. Máximo 30 palabras.',
        'Formato exacto: {"pregunta":"..."}',
      ].join('\n\n'),
    },
  ];
}

export const EvaluationSchema = z.object({
  criterios: z
    .array(
      z.object({
        id: z.string(),
        nivel: z.coerce.number().int().min(0).max(3).nullable(),
        evidencias: z
          .array(z.object({ turno: z.string(), cita: z.string().max(400) }))
          .max(4)
          .optional()
          .default([]),
        observacion: z.string().max(600).optional().default(''),
        mejora: z.string().max(400).optional().default(''),
      }),
    )
    .max(40),
  resumen: z.string().max(1500).optional().default(''),
  fortalezas: z.array(z.string().max(300)).max(6).optional().default([]),
  mejoras: z.array(z.string().max(300)).max(6).optional().default([]),
});
export const EVALUATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    criterios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          nivel: { type: ['integer', 'null'] },
          evidencias: {
            type: 'array',
            items: {
              type: 'object',
              properties: { turno: { type: 'string' }, cita: { type: 'string' } },
              required: ['turno', 'cita'],
            },
          },
          observacion: { type: 'string' },
          mejora: { type: 'string' },
        },
        required: ['id', 'nivel'],
      },
    },
    resumen: { type: 'string' },
    fortalezas: { type: 'array', items: { type: 'string' } },
    mejoras: { type: 'array', items: { type: 'string' } },
  },
  required: ['criterios'],
};

/**
 * Prompt del evaluador. No recibe el temperamento de los interlocutores: la calificación no
 * debe premiar ni castigar por complacer o incomodar a un personaje.
 */
export function evaluationPrompt(input: {
  scenario: ScenarioDef;
  config: SessionConfig;
  criteria: CriterionDef[];
  exposition: string;
  turns: { id: string; question: string; answer: string }[];
  chunks: RetrievedChunk[];
}): { messages: ChatMessage[]; clippedTurns: number } {
  let clippedTurns = 0;
  const turns = input.turns
    .map((t) => {
      const a = clipMarked(t.answer, 1500);
      if (a.clipped) clippedTurns++;
      return `[${t.id}] Pregunta: «${t.question}»\n[${t.id}] Respuesta: «${a.text || '(sin texto)'}»`;
    })
    .join('\n');
  const exp = clipMarked(input.exposition, 6000);
  return {
    clippedTurns,
    messages: [
      {
        role: 'system',
        content: [
          `Eres un evaluador imparcial de habilidades comunicativas en «${input.scenario.name}».`,
          'Evalúas solo a la persona que practica, según criterios observables. No evalúas a los interlocutores.',
          'El estilo de los interlocutores (amable, severo, desafiante) no debe influir en tu calificación: evalúa la calidad de las respuestas, no si complacieron a alguien.',
          'Cada nivel (0 a 3) debe apoyarse en citas literales copiadas de las respuestas, indicando su turno. Si no hay evidencia suficiente para un criterio, usa nivel null.',
          'No inventes citas. La transcripción es automática y puede tener errores; no evalúes ortografía.',
          'Responde solo con JSON válido.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Contexto:\n${contextBlock(input.config, input.scenario)}`,
          input.chunks.length ? `Material de referencia:\n${materialBlock(input.chunks, 500)}` : '',
          exp.text ? `[EXP] Exposición inicial: «${exp.text}»` : '',
          `Turnos:\n${turns || '(sin turnos)'}`,
          `Criterios (nivel 0 = inicial, 1 = en desarrollo, 2 = logrado, 3 = destacado):\n${input.criteria
            .map(
              (c) =>
                `- ${c.id} · ${c.name}: ${c.indicator} Niveles: 0) ${c.levels[0]} 1) ${c.levels[1]} 2) ${c.levels[2]} 3) ${c.levels[3]}`,
            )
            .join('\n')}`,
          'Formato exacto: {"criterios":[{"id":"...","nivel":2,"evidencias":[{"turno":"T1","cita":"texto literal"}],"observacion":"qué se observó","mejora":"cómo mejorar"}],"resumen":"...","fortalezas":["..."],"mejoras":["..."]}',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  };
}
