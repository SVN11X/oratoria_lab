import { downmixAndResample, rms } from '@oratoria/audio';
import { basePath } from '../services';

/** Recibe el texto reconocido con el segundo de práctica en que comenzó. */
export type SttHandlers = {
  onFinal: (text: string, t: number) => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
  onBusy?: (busy: boolean) => void;
};
export interface Stt {
  readonly id: string;
  readonly label: string;
  /** El texto o el audio salen del equipo (reconocimiento del navegador). */
  readonly online: boolean;
  /** Muestra texto parcial mientras se habla. */
  readonly live: boolean;
  start(): void;
  /** Escucha solo durante los turnos de la persona. */
  setListening(on: boolean, t: number): void;
  /** Termina el turno actual y espera el texto pendiente. */
  flush(): Promise<void>;
  /** Alimenta audio PCM (solo motores locales). */
  feed?(frame: Float32Array, sampleRate: number, t: number): void;
  stop(): void;
}

/* --------------------------- Reconocimiento del navegador --------------------------- */
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: { length: number; [i: number]: RecognitionResult } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;
const ctor = (): RecognitionCtor | undefined => {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
export const browserSttSupported = () => typeof window !== 'undefined' && !!ctor();

/**
 * Reconocimiento del navegador. En Chrome y Edge el audio se procesa en servidores de Google o
 * Microsoft: por eso se informa y es una opción, no un requisito.
 */
export class BrowserStt implements Stt {
  readonly id = 'navegador';
  readonly label = 'Reconocimiento del navegador';
  readonly online = true;
  readonly live = true;
  private rec: Recognition | null = null;
  private wanted = false;
  private listening = false;
  private failures = 0;
  private now: () => number = () => 0;
  constructor(
    private h: SttHandlers,
    clock: () => number,
    private lang = 'es-CL',
  ) {
    this.now = clock;
  }
  private create() {
    const Ctor = ctor();
    if (!Ctor)
      throw new Error('Este navegador no tiene reconocimiento de voz. Usa Chrome o Edge, o instala Whisper.');
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      this.failures = 0;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        const text = r[0].transcript.trim();
        if (r.isFinal) {
          if (text) this.h.onFinal(text, this.now());
        } else interim += `${text} `;
      }
      this.h.onInterim?.(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wanted = false;
        this.h.onError?.(
          'El navegador no permitió el reconocimiento de voz. Revisa los permisos del micrófono.',
        );
      } else if (++this.failures >= 3) {
        this.wanted = false;
        this.h.onError?.(
          e.error === 'network'
            ? 'El reconocimiento de voz del navegador no responde. Revisa tu conexión o instala Whisper para transcribir sin internet.'
            : `El reconocimiento de voz se detuvo (${e.error}).`,
        );
      }
    };
    rec.onend = () => {
      this.rec = null;
      if (this.wanted && this.listening) setTimeout(() => this.begin(), 250);
    };
    return rec;
  }
  private begin() {
    if (!this.wanted || !this.listening || this.rec) return;
    try {
      this.rec = this.create();
      this.rec.start();
    } catch (error) {
      this.rec = null;
      this.wanted = false;
      this.h.onError?.(
        error instanceof Error ? error.message : 'No se pudo iniciar el reconocimiento de voz.',
      );
    }
  }
  start() {
    this.wanted = true;
  }
  setListening(on: boolean) {
    this.listening = on;
    if (on) this.begin();
    else this.rec?.stop();
  }
  async flush() {
    await new Promise((r) => setTimeout(r, 900));
  }
  stop() {
    this.wanted = false;
    this.listening = false;
    this.rec?.abort();
    this.rec = null;
  }
}

/* --------------------- Transcripción local por fragmentos (Whisper) --------------------- */
type Job = { pcm: Float32Array; t: number };
let whisper: Worker | null = null;
let whisperSeq = 0;
type WhisperReply = { ok: boolean; text?: string; result?: unknown; error?: string };
const whisperPending = new Map<number, (r: WhisperReply) => void>();
function whisperWorker() {
  if (!whisper) {
    whisper = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    whisper.onmessage = (e: MessageEvent<WhisperReply & { id: number }>) => {
      whisperPending.get(e.data.id)?.(e.data);
      whisperPending.delete(e.data.id);
    };
    whisper.onerror = () => {
      for (const done of whisperPending.values())
        done({ ok: false, error: 'No se pudo iniciar Whisper en este navegador.' });
      whisperPending.clear();
      whisper = null;
    };
  }
  return whisper;
}
/** Envía audio de 16 kHz al trabajador; sin audio, solo precarga el modelo. */
export function whisperCall(model: string, pcm?: Float32Array, timestamps = false) {
  const id = ++whisperSeq;
  return new Promise<WhisperReply>((resolve) => {
    whisperPending.set(id, resolve);
    const copy = pcm?.slice();
    whisperWorker().postMessage(
      { id, model, base: basePath, pcm: copy, timestamps },
      copy ? [copy.buffer] : [],
    );
  });
}
/** Detiene el trabajador (cancelación) y libera su memoria. */
export function releaseWhisper() {
  whisper?.terminate();
  whisper = null;
  for (const done of whisperPending.values()) done({ ok: false, error: 'Transcripción cancelada.' });
  whisperPending.clear();
}

/** Base común: acumula audio del turno y lo corta en pausas para transcribir por partes. */
abstract class ChunkedStt implements Stt {
  abstract readonly id: string;
  abstract readonly label: string;
  readonly online = false;
  readonly live = false;
  private frames: Float32Array[] = [];
  private rate = 48000;
  private samples = 0;
  private quiet = 0;
  private startedAt = 0;
  private listening = false;
  private queue: Promise<void> = Promise.resolve();
  private busy = 0;
  constructor(protected h: SttHandlers) {}
  protected abstract transcribe(pcm16k: Float32Array): Promise<string>;
  start() {}
  setListening(on: boolean, t: number) {
    if (on && !this.listening) this.startedAt = t;
    if (!on && this.listening) this.cut();
    this.listening = on;
  }
  feed(frame: Float32Array, sampleRate: number, t: number) {
    if (!this.listening) return;
    if (!this.samples) this.startedAt = t;
    this.rate = sampleRate;
    this.frames.push(frame);
    this.samples += frame.length;
    this.quiet = rms(frame) < 0.006 ? this.quiet + frame.length : 0;
    const sec = this.samples / this.rate;
    // Corta en una pausa tras 12 s, o a los 28 s como máximo.
    if ((sec >= 12 && this.quiet / this.rate >= 0.5) || sec >= 28) this.cut();
  }
  private cut() {
    if (!this.samples) return;
    const all = new Float32Array(this.samples);
    let o = 0;
    for (const f of this.frames) {
      all.set(f, o);
      o += f.length;
    }
    const job: Job = { pcm: all, t: this.startedAt };
    this.frames = [];
    this.samples = 0;
    this.quiet = 0;
    if (rms(all) < 0.004) return;
    this.busy++;
    this.h.onBusy?.(true);
    this.queue = this.queue.then(async () => {
      try {
        const pcm = downmixAndResample([job.pcm], this.rate, 16000);
        const text = (await this.transcribe(pcm)).replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim();
        if (text) this.h.onFinal(text, job.t);
      } catch (error) {
        this.h.onError?.(error instanceof Error ? error.message : 'Falló la transcripción.');
      } finally {
        if (--this.busy === 0) this.h.onBusy?.(false);
      }
    });
  }
  async flush() {
    this.cut();
    await this.queue;
  }
  stop() {
    this.listening = false;
    this.frames = [];
    this.samples = 0;
  }
}
export class WhisperStt extends ChunkedStt {
  readonly id: string;
  readonly label = 'Whisper en este equipo';
  constructor(
    private model: string,
    h: SttHandlers,
  ) {
    super(h);
    this.id = model;
  }
  start() {
    void whisperCall(this.model).then((r) => {
      if (!r.ok) this.h.onError?.(r.error ?? 'No se pudo cargar Whisper.');
    });
  }
  protected async transcribe(pcm: Float32Array) {
    const r = await whisperCall(this.model, pcm);
    if (!r.ok) throw new Error(r.error);
    return r.text ?? '';
  }
}
/** Codifica PCM mono de 16 kHz como WAV de 16 bits. */
export function wav16(pcm: Float32Array, rate = 16000): Blob {
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  w(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++)
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i]!)) * 0x7fff, true);
  return new Blob([view.buffer], { type: 'audio/wav' });
}
/**
 * Servidor local compatible con OpenAI (POST /v1/audio/transcriptions), por ejemplo whisper.cpp
 * en modo servidor o faster-whisper. Debe ejecutarse en tu equipo.
 */
export class ServerStt extends ChunkedStt {
  readonly id = 'servidor';
  readonly label = 'Servidor de transcripción local';
  constructor(
    private cfg: { baseUrl: string; model: string },
    h: SttHandlers,
  ) {
    super(h);
  }
  protected async transcribe(pcm: Float32Array) {
    const form = new FormData();
    form.append('file', wav16(pcm), 'turno.wav');
    form.append('model', this.cfg.model);
    form.append('language', 'es');
    form.append('response_format', 'json');
    const r = await fetch(`${this.cfg.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      body: form,
      credentials: 'omit',
    });
    if (!r.ok) throw new Error(`El servidor de transcripción respondió ${r.status}.`);
    return ((await r.json()) as { text?: string }).text ?? '';
  }
}
