import { type Transcript, TranscriptSchema, MAX_DURATION_SECONDS } from '@oratoria/core';
import { WHISPER } from '@oratoria/model-manager';
export type TranscriptionProgress = { phase: 'loading' | 'processing'; message: string };
export interface Transcriber {
  transcribe(
    pcm: Float32Array,
    language: string,
    signal: AbortSignal,
    progress: (p: TranscriptionProgress) => void,
  ): Promise<Transcript>;
}
export function parseWhisperResult(result: unknown, duration: number): Transcript {
  if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string')
    throw new Error('El modelo no devolvió una transcripción válida.');
  const chunks = 'chunks' in result && Array.isArray(result.chunks) ? result.chunks : [];
  const segments = chunks.flatMap((c: unknown) => {
    if (
      !c ||
      typeof c !== 'object' ||
      !('text' in c) ||
      typeof c.text !== 'string' ||
      !('timestamp' in c) ||
      !Array.isArray(c.timestamp)
    )
      return [];
    const [start, end] = c.timestamp as unknown[];
    if (
      typeof start !== 'number' ||
      start < 0 ||
      start > duration ||
      (end !== null && (typeof end !== 'number' || end < start || end > duration + 0.2))
    )
      return [];
    return [
      {
        id: crypto.randomUUID(),
        text: c.text.trim(),
        start: end === null ? null : start,
        end: typeof end === 'number' ? Math.min(end, duration) : null,
      },
    ];
  });
  // Timestamp-free output stays timestamp-free; no invented intervals.
  return TranscriptSchema.parse({
    source: 'whisper-local',
    model: `${WHISPER.repo}@${WHISPER.revision}`,
    language: 'es',
    revision: 1,
    updatedAt: new Date().toISOString(),
    segments:
      segments.length && segments.length === chunks.length
        ? segments
        : [{ id: crypto.randomUUID(), text: result.text.trim(), start: null, end: null }],
  });
}
export function validateTranscriptionInput(pcm: Float32Array) {
  if (!pcm.length || pcm.length / 16000 > MAX_DURATION_SECONDS + 0.1)
    throw new Error('La transcripción admite hasta 10 minutos de audio mono a 16 kHz.');
}
