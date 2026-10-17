import { z } from 'zod';
import {
  COMMITTEE,
  DIFFICULTY_TEXT,
  type Difficulty,
  type MemberId,
  type PlannedQuestion,
} from './committee';
import { clip } from './text';

export type ChatMessage = { role: 'system' | 'user'; content: string };
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{'),
    end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('La respuesta del modelo no contiene JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}
function system(difficulty: Difficulty) {
  return [
    'Actúas como la comisión evaluadora de una defensa de título de ingeniería en una universidad chilena.',
    ...COMMITTEE.map((m) => `Integrante ${m.id}: ${m.name}, ${m.role}. Se enfoca en ${m.focus}.`),
    `Nivel de exigencia. ${DIFFICULTY_TEXT[difficulty]}`,
    'Trata al estudiante de usted. Escribe en español claro, con frases que se puedan decir en voz alta.',
    'No inventes datos. Basa cada pregunta y comentario en el resumen o en lo que el estudiante dijo.',
    'La transcripción viene de reconocimiento de voz y puede tener errores; no corrijas la ortografía del estudiante.',
    'Responde solo con un objeto JSON válido, sin texto antes ni después.',
  ].join('\n');
}
const context = (title: string, summary: string, exposition: string) =>
  [
    `Título de la tesis: ${title || 'sin título'}`,
    `Resumen entregado por el estudiante:\n"""${clip(summary, 6000) || 'No entregó resumen.'}"""`,
    `Transcripción aproximada de la exposición:\n"""${clip(exposition, 9000) || 'No hubo exposición transcrita.'}"""`,
  ].join('\n\n');
export function questionsPrompt(input: {
  title: string;
  summary: string;
  exposition: string;
  count: number;
  difficulty: Difficulty;
}): ChatMessage[] {
  return [
    { role: 'system', content: system(input.difficulty) },
    {
      role: 'user',
      content: `${context(input.title, input.summary, input.exposition)}

Genera ${input.count} preguntas para la ronda de preguntas, repartidas entre los tres integrantes según su enfoque.
Cada pregunta debe ser una sola, de máximo 35 palabras. Al menos una debe apuntar a un vacío, una afirmación sin evidencia o una decisión poco justificada de la exposición.
Formato exacto: {"preguntas":[{"integrante":0,"pregunta":"..."}]}`,
    },
  ];
}
const QuestionsSchema = z.object({
  preguntas: z
    .array(
      z.object({ integrante: z.coerce.number().int().min(0).max(2), pregunta: z.string().min(8).max(400) }),
    )
    .min(1),
});
export function parseQuestions(text: string, count: number): PlannedQuestion[] {
  const data = QuestionsSchema.parse(extractJson(text));
  return data.preguntas.slice(0, count).map((q) => ({
    member: q.integrante as MemberId,
    text: q.pregunta.trim(),
    kind: 'pregunta',
    source: 'ia',
  }));
}
export function answerPrompt(input: {
  title: string;
  summary: string;
  member: MemberId;
  question: string;
  answer: string;
  difficulty: Difficulty;
  allowFollowUp: boolean;
}): ChatMessage[] {
  const m = COMMITTEE[input.member];
  return [
    { role: 'system', content: system(input.difficulty) },
    {
      role: 'user',
      content: `Título de la tesis: ${input.title || 'sin título'}
Resumen: """${clip(input.summary, 2500) || 'No entregó resumen.'}"""

${m.name} (${m.role}) preguntó: "${input.question}"
Respuesta del estudiante (transcripción aproximada): """${clip(input.answer, 5000) || '(no se captó texto)'}"""

1) Escribe un comentario de una o dos frases para el estudiante: qué estuvo bien y qué faltó (precisión, evidencia, estructura o foco en la pregunta).
2) ${
        input.allowFollowUp
          ? `Decide si ${m.name} haría una repregunta. Con nivel amable solo si la respuesta quedó muy incompleta; con nivel estándar si faltó evidencia o precisión; con nivel exigente casi siempre, presionando un punto débil. La repregunta debe citar algo que el estudiante dijo.`
          : 'No hagas repregunta: usa null.'
      }
3) Califica la respuesta de 1 (no responde) a 4 (completa y con evidencia).
Formato exacto: {"comentario":"...","repregunta":"..." o null,"calidad":1}`,
    },
  ];
}
const AnswerSchema = z.object({
  comentario: z.string().min(1).max(800),
  repregunta: z.string().max(400).nullable().optional(),
  calidad: z.coerce.number().min(1).max(4).optional(),
});
export function parseAnswer(text: string): {
  feedback: string;
  followUp: string | null;
  quality: number | null;
} {
  const data = AnswerSchema.parse(extractJson(text));
  const follow = data.repregunta?.trim();
  return {
    feedback: data.comentario.trim(),
    followUp: follow && follow.length > 8 && !/^null$/i.test(follow) ? follow : null,
    quality: data.calidad ?? null,
  };
}
export function interruptionPrompt(input: {
  title: string;
  recent: string;
  member: MemberId;
  difficulty: Difficulty;
}): ChatMessage[] {
  const m = COMMITTEE[input.member];
  return [
    { role: 'system', content: system(input.difficulty) },
    {
      role: 'user',
      content: `Título de la tesis: ${input.title || 'sin título'}
Lo último que dijo el estudiante durante su exposición: """${clip(input.recent, 2500)}"""

${m.name} (${m.role}) lo interrumpe con una pregunta breve sobre algo que acaba de decir y que no quedó claro o no se justificó.
Empieza con una fórmula de cortesía como «Disculpe que lo interrumpa». Máximo 30 palabras.
Formato exacto: {"pregunta":"..."}`,
    },
  ];
}
export function parseInterruption(text: string): string {
  return z
    .object({ pregunta: z.string().min(8).max(400) })
    .parse(extractJson(text))
    .pregunta.trim();
}
export function contentPrompt(input: {
  title: string;
  summary: string;
  exposition: string;
  answers: { question: string; answer: string }[];
  difficulty: Difficulty;
}): ChatMessage[] {
  return [
    { role: 'system', content: system(input.difficulty) },
    {
      role: 'user',
      content: `${context(input.title, input.summary, input.exposition)}

Preguntas y respuestas:
${input.answers.map((a, i) => `${i + 1}. P: ${clip(a.question, 300)}\n   R: ${clip(a.answer, 1200) || '(sin texto)'}`).join('\n') || 'No hubo ronda de preguntas.'}

Evalúa solo el contenido y la claridad (no la voz ni el cuerpo, que se miden aparte). Sé específico y cita ideas concretas del estudiante.
Formato exacto: {"resumen":"dos o tres frases","fortalezas":["..."],"mejoras":["acción concreta..."],"estructura":{"introduccion":true,"problema_y_objetivos":true,"metodologia":true,"resultados":true,"conclusiones":true}}
En "estructura" marca true solo si la exposición desarrolló esa parte. Usa como máximo 4 fortalezas y 5 mejoras.`,
    },
  ];
}
const ContentSchema = z.object({
  resumen: z.string().min(1).max(1500),
  fortalezas: z.array(z.string().max(400)).max(6),
  mejoras: z.array(z.string().max(400)).max(8),
  estructura: z.record(z.string(), z.boolean()),
});
export function parseContent(text: string) {
  return ContentSchema.parse(extractJson(text));
}
