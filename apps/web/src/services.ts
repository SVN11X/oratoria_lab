import { MAX_DURATION_SECONDS, type AudioMetrics } from '@oratoria/core';
import { checkAudioFile } from '@oratoria/audio';
export { checkAudioFile } from '@oratoria/audio';
import {
  parseWhisperResult,
  validateTranscriptionInput,
  type Transcriber,
  type TranscriptionProgress,
} from '@oratoria/transcription';

export const basePath = new URL(import.meta.env.BASE_URL, location.href).pathname;
async function metadataDuration(blob: Blob): Promise<number | null> {
  const url = URL.createObjectURL(blob),
    audio = new Audio();
  audio.preload = 'metadata';
  try {
    return await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No se pudo leer la duración del archivo.')), 8000);
      audio.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(Number.isFinite(audio.duration) ? audio.duration : null);
      };
      audio.onerror = () => {
        clearTimeout(timer);
        reject(new Error('El navegador no reconoce este formato de audio.'));
      };
      audio.src = url;
    });
  } finally {
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
  }
}
export async function processAudio(
  blob: Blob,
  threshold: number,
  trustedRecording = false,
  signal?: AbortSignal,
): Promise<{ metrics: AudioMetrics; pcm: Float32Array }> {
  await checkAudioFile(blob);
  signal?.throwIfAborted();
  const duration = await metadataDuration(blob);
  if ((duration === null && !trustedRecording) || (duration !== null && duration > MAX_DURATION_SECONDS))
    throw new Error('El audio debe tener duración verificable y no superar 10 minutos.');
  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error('No se pudo decodificar el audio. Prueba WAV o MP3.');
  } finally {
    await context.close();
  }
  signal?.throwIfAborted();
  if (!decoded.length || decoded.duration > MAX_DURATION_SECONDS + 0.1)
    throw new Error('El audio está vacío o supera 10 minutos.');
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
    decoded.getChannelData(i).slice(),
  );
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/audio.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Procesamiento cancelado.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (e: MessageEvent<{ metrics: AudioMetrics; pcm: Float32Array; error?: string }>) => {
      cleanup();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error('Falló el trabajador de análisis de audio.'));
    };
    worker.postMessage(
      { channels, sampleRate: decoded.sampleRate, threshold },
      channels.map((c) => c.buffer),
    );
  });
}
export class WhisperTranscriber implements Transcriber {
  async transcribe(
    pcm: Float32Array,
    language: string,
    signal: AbortSignal,
    progress: (p: TranscriptionProgress) => void,
  ) {
    validateTranscriptionInput(pcm);
    signal.throwIfAborted();
    return new Promise<ReturnType<typeof parseWhisperResult>>((resolve, reject) => {
      const worker = new Worker(new URL('./workers/transcription.ts', import.meta.url), { type: 'module' });
      const cleanup = () => {
        worker.terminate();
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('Transcripción cancelada.', 'AbortError'));
      };
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = (
        e: MessageEvent<{
          phase?: TranscriptionProgress['phase'];
          message: string;
          error?: string;
          result?: unknown;
        }>,
      ) => {
        if (e.data.error) {
          cleanup();
          reject(new Error(e.data.error));
        } else if (e.data.result) {
          cleanup();
          try {
            resolve(parseWhisperResult(e.data.result, pcm.length / 16000));
          } catch (err) {
            reject(err);
          }
        } else if (e.data.phase) progress({ phase: e.data.phase, message: e.data.message });
      };
      worker.onerror = () => {
        cleanup();
        reject(new Error('No se pudo iniciar Whisper en este navegador.'));
      };
      const copy = pcm.slice();
      worker.postMessage({ pcm: copy, language, base: basePath }, [copy.buffer]);
    });
  }
}
