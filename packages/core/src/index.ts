import { z } from 'zod';

export const METHODOLOGY = 'oratoria-dsp-1.0.0';
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 600;
export const SegmentSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().max(50000),
    prompt: z.string().max(1000).optional(),
    start: z.number().nonnegative().nullable(),
    end: z.number().nonnegative().nullable(),
  })
  .refine(
    (s) => (s.start === null && s.end === null) || (s.start !== null && s.end !== null && s.end >= s.start),
    'Intervalo no válido',
  );
export type Segment = z.infer<typeof SegmentSchema>;
export const TranscriptSchema = z.object({
  source: z.enum(['manual', 'whisper-local']),
  language: z.string(),
  model: z.string().nullable(),
  revision: z.number().int().positive(),
  segments: z.array(SegmentSchema).max(1000),
  updatedAt: z.string(),
});
export type Transcript = z.infer<typeof TranscriptSchema>;
export const AudioMetricsSchema = z.object({
  methodology: z.literal(METHODOLOGY),
  duration: z.number().positive(),
  activeSeconds: z.number().nonnegative(),
  silenceSeconds: z.number().nonnegative(),
  thresholdDbfs: z.number(),
  meanDbfs: z.number(),
  peakDbfs: z.number(),
  variation: z.number().nonnegative(),
  clippingFraction: z.number().min(0).max(1),
  pauses: z.array(z.object({ start: z.number(), end: z.number(), duration: z.number() })),
  meanPause: z.number().nonnegative(),
  pitchMedianHz: z.number().nullable(),
  pitchSamples: z.number().int().nonnegative(),
  noiseFloorDbfs: z.number(),
  frames: z.array(z.object({ time: z.number(), rms: z.number(), active: z.boolean() })),
  envelope: z.array(z.number()),
});
export type AudioMetrics = z.infer<typeof AudioMetricsSchema>;
export const CriterionSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  indicator: z.string().min(1).max(500),
  weight: z.number().min(1).max(100),
  descriptors: z.tuple([
    z.string().min(1).max(500),
    z.string().min(1).max(500),
    z.string().min(1).max(500),
    z.string().min(1).max(500),
  ]),
});
export const RubricSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  name: z.string().min(1).max(100),
  criteria: z.array(CriterionSchema).min(1).max(20),
});
export type Rubric = z.infer<typeof RubricSchema>;
export const RatingSchema = z.object({
  criterionId: z.string(),
  level: z.number().int().min(0).max(3).nullable(),
  segmentId: z.string().nullable(),
  quote: z.string().max(2000),
  note: z.string().max(2000),
});
export type Rating = z.infer<typeof RatingSchema>;
export const EvaluationSchema = z.object({
  method: z.literal('manual-evidence-1.0.0'),
  rubric: RubricSchema,
  ratings: z.array(RatingSchema),
  transcriptRevision: z.number().int().positive(),
  createdAt: z.string(),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;
export const SpeechFeedbackSchema = z.object({
  model: z.string().max(300),
  summary: z.string().max(2000),
  findings: z
    .array(
      z.object({
        quote: z.string().min(8).max(600),
        observed: z.string().max(600),
        improve: z.string().max(600),
        sources: z
          .array(
            z.object({
              docId: z.string().max(500),
              docName: z.string().max(500),
              chunkId: z.string().max(500),
              location: z.string().max(500),
              excerpt: z.string().max(2000),
            }),
          )
          .max(4),
      }),
    )
    .max(1000),
  notes: z.array(z.string().max(2000)).max(20),
});
export type SpeechFeedback = z.infer<typeof SpeechFeedbackSchema>;
export const SessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    title: z.string().min(1).max(120),
    createdAt: z.string().datetime(),
    source: z.enum(['microphone', 'import', 'guided']),
    goal: z.string().max(500),
    audioName: z.string().max(200).nullable(),
    audioMime: z.string().nullable(),
    audioBytes: z.number().int().min(0).max(MAX_AUDIO_BYTES),
    audio: AudioMetricsSchema.nullable(),
    transcript: TranscriptSchema.nullable(),
    evaluation: EvaluationSchema.nullable(),
    speechFeedback: SpeechFeedbackSchema.nullable().optional(),
    scenarioId: z.string().nullable(),
  })
  .superRefine((s, ctx) => {
    for (const segment of s.transcript?.segments ?? []) {
      if (s.audio && segment.end !== null && segment.end > s.audio.duration + 0.1)
        ctx.addIssue({ code: 'custom', message: 'El segmento excede el audio', path: ['transcript'] });
    }
  });
export type Session = z.infer<typeof SessionSchema>;
export function fullText(t: Transcript | null): string {
  return t?.segments.map((s) => s.text).join('\n') ?? '';
}
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return (
      error.issues.find((i) => i.code === 'custom')?.message ??
      'Revisa los campos obligatorios, los límites de longitud y los valores numéricos.'
    );
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return 'No hay espacio suficiente en el almacenamiento local. Exporta tus datos y libera espacio antes de intentarlo de nuevo.';
  if (error instanceof DOMException && error.name === 'AbortError') return 'La operación se canceló.';
  return error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Ocurrió un error inesperado.';
}
export function newSession(input: Partial<Session> = {}): Session {
  return SessionSchema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: 'Mi práctica',
    createdAt: new Date().toISOString(),
    source: 'microphone',
    goal: '',
    audioName: null,
    audioMime: null,
    audioBytes: 0,
    audio: null,
    transcript: null,
    evaluation: null,
    scenarioId: null,
    ...input,
  });
}
