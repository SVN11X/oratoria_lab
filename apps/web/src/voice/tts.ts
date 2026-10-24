import { managed } from '@oratoria/model-manager';
import { basePath } from '../services';
import { estimateSeconds, progressAtChar, sample, visemeTrack, type Mouth } from './visemes';

/** Cómo debe sonar un interlocutor: viene de su género, su voz base y su temperamento. */
export type VoiceSpec = {
  gender: 'f' | 'm';
  pitch: number;
  rate: number;
  /** Pausa entre frases, en milisegundos. */
  pause: number;
  /** 0–1: cuánto se marca la pregunta u objeción final. */
  emphasis: number;
  voiceKey: string;
  /** Índice del interlocutor, para repartir voces distintas. */
  seed: number;
};
export type SpeakEvents = {
  onMouth?: (m: Mouth, level: number) => void;
  onEnd?: () => void;
  /** Inicio real de reproducción, no el instante en que se solicita sintetizar. */
  onStart?: () => void;
  onSynthesis?: (ms: number, timings?: VoiceTimings) => void;
};
export type VoiceTimings = Partial<
  Record<'voiceQueueMs' | 'voiceLoadMs' | 'voicePhonemeMs' | 'voiceInferenceMs' | 'voiceAudioMs', number>
>;
export type SpeakHandle = { done: Promise<void>; cancel: () => void };
export interface Tts {
  readonly id: string;
  readonly label: string;
  speak(text: string, voice: VoiceSpec, events?: SpeakEvents): SpeakHandle;
}

/** Divide en frases para hablar con pausas naturales y evitar cortes de voces largas. */
export function phrases(text: string): { text: string; pause: number }[] {
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?;:])\s+/)
    .flatMap((p) => (p.length > 160 ? p.split(/(?<=,)\s+/) : [p]))
    .filter(Boolean);
  return parts.map((p) => ({ text: p, pause: /[?]$/.test(p) ? 1.25 : /[.!:;]$/.test(p) ? 1 : 0.45 }));
}
/** Piper puede empezar con una cláusula corta sin esperar a sintetizar toda la pregunta. */
export function piperPhrases(text: string): { text: string; pause: number }[] {
  const result: { text: string; pause: number }[] = [];
  for (const phrase of phrases(text)) {
    let rest = phrase.text;
    while (rest) {
      const max = result.length ? 160 : 96;
      if (rest.length <= max) {
        result.push({ text: rest, pause: phrase.pause });
        break;
      }
      const punctuation = [...rest.slice(0, max + 1).matchAll(/[,;:!?]\s+/g)].at(-1);
      let split =
        punctuation && punctuation.index >= max * 0.45 ? punctuation.index + 1 : rest.lastIndexOf(' ', max);
      if (split < 1) split = rest.indexOf(' ', max);
      if (split < 1) split = rest.length; // Una palabra larga no se mutila.
      const part = rest.slice(0, split).trim();
      result.push({ text: part, pause: /[,;:!?]$/.test(part) ? 0.45 : 0 });
      rest = rest.slice(split).trim();
    }
  }
  return result;
}
const sleep = (ms: number, cancelled: () => boolean) =>
  new Promise<void>((r) => {
    const t0 = performance.now();
    const tick = () => (cancelled() || performance.now() - t0 >= ms ? r() : setTimeout(tick, 30));
    tick();
  });

/* ----------------------------- Voces del sistema (Web Speech) ----------------------------- */
const FEMALE =
  /(helena|laura|sabina|paulina|m[oó]nica|elvira|dalia|luc[ií]a|elena|catalina|francisca|paloma|marisol|esperanza|sof[ií]a|isabel|camila|valentina|ximena|elsa|irene|carmen|google espa)/i;
const MALE =
  /(pablo|ra[uú]l|jorge|diego|[aá]lvaro|tom[aá]s|lorenzo|gonzalo|juan|carlos|enrique|alonso|dario|dar[ií]o|emilio|gerardo|liam|federico|arnau|hugo|mateo|andr[eé]s)/i;
export function voiceGender(v: SpeechSynthesisVoice): 'f' | 'm' | null {
  return FEMALE.test(v.name) ? 'f' : MALE.test(v.name) ? 'm' : null;
}
const REGION = ['es-cl', 'es-419', 'es-us', 'es-mx', 'es-ar', 'es-co', 'es-es'];
/** Voces en español ordenadas por calidad probable y cercanía regional. */
export function systemVoices(allowOnline: boolean): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const rank = (v: SpeechSynthesisVoice) => {
    const region = REGION.indexOf(v.lang.toLowerCase());
    const natural = /natural|neural|online/i.test(v.name) ? -10 : 0;
    return natural + (region < 0 ? 8 : region);
  };
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('es') && (allowOnline || v.localService))
    .sort((a, b) => rank(a) - rank(b));
}
export function loadSystemVoices(allowOnline: boolean): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([]);
  const now = systemVoices(allowOnline);
  if (speechSynthesis.getVoices().length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener('voiceschanged', done);
      clearTimeout(timer);
      resolve(systemVoices(allowOnline));
    };
    const timer = setTimeout(done, 1500);
    speechSynthesis.addEventListener('voiceschanged', done);
  });
}
export class SystemTts implements Tts {
  readonly id = 'sistema';
  readonly label = 'Voces del sistema';
  constructor(private voices: SpeechSynthesisVoice[]) {}
  pick(v: VoiceSpec): SpeechSynthesisVoice | undefined {
    const explicit = this.voices.find((x) => x.voiceURI === v.voiceKey);
    if (explicit) return explicit;
    const same = this.voices.filter((x) => voiceGender(x) === v.gender);
    const pool = same.length
      ? same
      : this.voices.filter((x) => voiceGender(x) === null).concat(same.length ? [] : this.voices);
    return pool.length ? pool[v.seed % pool.length] : undefined;
  }
  speak(text: string, v: VoiceSpec, ev: SpeakEvents = {}): SpeakHandle {
    let cancelled = false;
    let endCurrent = () => {};
    const voice = this.pick(v);
    // Con pocas voces, el tono distingue a los interlocutores.
    const distinctVoice = voice && this.voices.filter((x) => voiceGender(x) === v.gender).length > v.seed;
    const done = (async () => {
      if (typeof speechSynthesis === 'undefined') return;
      speechSynthesis.cancel();
      const list = phrases(text);
      for (let i = 0; i < list.length && !cancelled; i++) {
        const p = list[i]!;
        const last = i === list.length - 1;
        const track = visemeTrack(p.text);
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(p.text);
          if (voice) u.voice = voice;
          u.lang = voice?.lang ?? 'es-CL';
          const jitter = 1 + (((i * 37 + v.seed * 11) % 7) - 3) / 100;
          u.rate = Math.max(
            0.6,
            Math.min(1.6, v.rate * jitter * (last && /\?$/.test(p.text) ? 1 - v.emphasis * 0.06 : 1)),
          );
          u.pitch = Math.max(
            0.3,
            Math.min(
              1.8,
              (distinctVoice ? 1 : v.pitch) + (last && /\?$/.test(p.text) ? v.emphasis * 0.06 : 0),
            ),
          );
          const expected = estimateSeconds(p.text, u.rate) * 1000;
          let start = performance.now(),
            anchor = 0,
            anchorAt = start,
            finished = false,
            raf = 0;
          const loop = () => {
            if (finished || cancelled) return;
            const elapsed = performance.now() - anchorAt;
            const progress = Math.min(0.995, anchor + elapsed / expected);
            const m = sample(track, progress);
            ev.onMouth?.(m, m.open);
            raf = requestAnimationFrame(loop);
          };
          u.onstart = () => {
            if (cancelled || finished) return;
            start = performance.now();
            anchorAt = start;
            loop();
            ev.onStart?.();
          };
          u.onboundary = (e) => {
            anchor = progressAtChar(track, e.charIndex);
            anchorAt = performance.now();
          };
          const end = () => {
            if (finished) return;
            finished = true;
            cancelAnimationFrame(raf);
            clearTimeout(guard);
            ev.onMouth?.({ open: 0, wide: 0.5, round: 0 }, 0);
            resolve();
          };
          endCurrent = end;
          // Algunos navegadores no emiten «end»; se usa un tiempo máximo.
          const guard = setTimeout(end, expected * 2.5 + 3000);
          u.onend = end;
          u.onerror = end;
          speechSynthesis.speak(u);
        });
        if (!last) await sleep(v.pause * p.pause, () => cancelled);
      }
    })().finally(() => ev.onEnd?.());
    return {
      done,
      cancel: () => {
        cancelled = true;
        endCurrent(); // Cancelar no siempre emite onend en Web Speech.
        if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      },
    };
  }
}

/* --------------------------- Reproducción de audio con análisis --------------------------- */
let sharedContext: AudioContext | null = null;
const audioContext = () => (sharedContext ??= new AudioContext());
/** Reproduce PCM con un analizador para mover la boca según la energía real del audio. */
function playPcm(
  pcm: Float32Array,
  rate: number,
  playbackRate: number,
  text: string,
  ev: SpeakEvents,
  cancelled: () => boolean,
  signal?: AbortSignal,
) {
  const ctx = audioContext();
  const buffer = ctx.createBuffer(1, pcm.length, rate);
  buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = playbackRate;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser).connect(ctx.destination);
  const data = new Float32Array(analyser.fftSize);
  const track = visemeTrack(text);
  const duration = buffer.duration / playbackRate;
  return new Promise<void>((resolve) => {
    let raf = 0,
      ended = false,
      started = false;
    const t0 = ctx.currentTime;
    const end = () => {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      signal?.removeEventListener('abort', stop);
      src.disconnect();
      analyser.disconnect();
      ev.onMouth?.({ open: 0, wide: 0.5, round: 0 }, 0);
      resolve();
    };
    const stop = () => {
      if (started) {
        try {
          src.stop();
        } catch {
          /* ya detenido */
        }
      }
      end();
    };
    const loop = () => {
      if (cancelled()) {
        stop();
        return;
      }
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const x of data) sum += x * x;
      const level = Math.min(1, Math.sqrt(sum / data.length) * 5);
      const m = sample(track, (ctx.currentTime - t0) / duration);
      ev.onMouth?.({ ...m, open: Math.min(1, m.open * 0.55 + level * 0.75) }, level);
      raf = requestAnimationFrame(loop);
    };
    src.onended = end;
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted || cancelled()) return stop();
    void ctx
      .resume()
      .then(() => {
        if (ended || cancelled()) return stop();
        src.start();
        started = true;
        ev.onStart?.();
        loop();
      })
      .catch(end);
  });
}

/* ----------------------------------- Piper (local) ----------------------------------- */
let piperWorker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (v: PiperResult) => void>();
type PiperResult = {
  ok: boolean;
  pcm?: Float32Array;
  sampleRate?: number;
  error?: string;
  speakers?: number;
  synthesisMs?: number;
  timings?: VoiceTimings;
};
function piper() {
  if (!piperWorker) {
    piperWorker = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' });
    piperWorker.onmessage = (e: MessageEvent<{ id: number }>) => {
      pending.get(e.data.id)?.(e.data as never);
      pending.delete(e.data.id);
    };
    piperWorker.onerror = () => {
      for (const resolve of pending.values()) resolve({ ok: false, error: 'El motor Piper se detuvo.' });
      pending.clear();
      piperWorker?.terminate();
      piperWorker = null;
    };
  }
  return piperWorker;
}
function callPiper(msg: Record<string, unknown>, signal?: AbortSignal) {
  const id = ++seq;
  return new Promise<PiperResult>((resolve) => {
    const abort = () => {
      piperWorker?.postMessage({ type: 'cancel', target: id });
      finish({ ok: false, error: 'Síntesis cancelada.' });
    };
    const finish = (value: PiperResult) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      pending.delete(id);
      resolve(value);
    };
    const timeout = setTimeout(
      () => finish({ ok: false, error: 'Piper tardó demasiado en responder.' }),
      120000,
    );
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    pending.set(id, finish);
    piper().postMessage({ ...msg, id, base: basePath });
  });
}
export async function loadPiperVoice(voice: string) {
  const r = await callPiper({ type: 'load', voice });
  if (!r.ok) throw new Error(r.error);
  return r;
}
export function releasePiper() {
  piperWorker?.terminate();
  piperWorker = null;
  for (const resolve of pending.values()) resolve({ ok: false, error: 'Motor de voz reiniciado.' });
  pending.clear();
}
/** Voz neuronal Piper ejecutada en este equipo. */
export class PiperTts implements Tts {
  readonly id = 'piper';
  readonly label = 'Voces neuronales locales (Piper)';
  constructor(private voices: { f: string; m: string }) {}
  voiceFor(v: VoiceSpec): { id: string; speaker: number } {
    const id = v.voiceKey.startsWith('piper-')
      ? v.voiceKey
      : v.gender === 'f'
        ? this.voices.f
        : this.voices.m;
    const m = managed(id);
    // El modelo con dos hablantes (España) usa 1 para la voz femenina.
    const speaker = m?.meta?.gender === 'fm' ? (v.gender === 'f' ? 1 : 0) : 0;
    return { id, speaker };
  }
  speak(text: string, v: VoiceSpec, ev: SpeakEvents = {}): SpeakHandle {
    let cancelled = false;
    const controller = new AbortController();
    const { id, speaker } = this.voiceFor(v);
    // La altura se ajusta con la velocidad de reproducción; la duración se compensa al sintetizar.
    const playbackRate = Math.max(0.85, Math.min(1.18, v.pitch));
    const lengthScale = playbackRate / Math.max(0.6, Math.min(1.5, v.rate));
    const done = (async () => {
      const list = piperPhrases(text);
      if (!list.length) return;
      let next = callPiper(
        { type: 'speak', voice: id, text: list[0]!.text, speaker, lengthScale },
        controller.signal,
      );
      for (let i = 0; i < list.length && !cancelled; i++) {
        const r = await next;
        if (cancelled) return; // Un PCM de una intervención antigua nunca debe reproducirse.
        if (!r.ok || !r.pcm) throw new Error(r.error ?? 'No se pudo sintetizar la voz.');
        if (r.synthesisMs !== undefined)
          ev.onSynthesis?.(r.synthesisMs, {
            ...r.timings,
            ...(r.timings?.voiceAudioMs !== undefined
              ? { voiceAudioMs: r.timings.voiceAudioMs / playbackRate }
              : {}),
          });
        if (i + 1 < list.length)
          next = callPiper(
            {
              type: 'speak',
              voice: id,
              text: list[i + 1]!.text,
              speaker,
              lengthScale:
                lengthScale *
                (i + 1 === list.length - 1 && /\?$/.test(list[i + 1]!.text) ? 1 + v.emphasis * 0.05 : 1),
            },
            controller.signal,
          );
        await playPcm(
          r.pcm,
          r.sampleRate!,
          playbackRate,
          list[i]!.text,
          ev,
          () => cancelled,
          controller.signal,
        );
        if (i + 1 < list.length) await sleep(v.pause * list[i]!.pause, () => cancelled);
      }
    })().finally(() => ev.onEnd?.());
    return {
      done,
      cancel: () => {
        cancelled = true;
        controller.abort();
      },
    };
  }
}

/* ------------------------------ Servidor local compatible ------------------------------ */
/**
 * Servidor de voz compatible con OpenAI (POST /v1/audio/speech), por ejemplo Kokoro-FastAPI,
 * LocalAI u otros que expongan modelos como Qwen3-TTS. Debe ejecutarse en tu equipo.
 */
export class ServerTts implements Tts {
  readonly id = 'servidor';
  readonly label = 'Servidor de voz local';
  constructor(private cfg: { baseUrl: string; model: string; voices: string }) {}
  voiceFor(v: VoiceSpec): string {
    if (v.voiceKey && !v.voiceKey.startsWith('piper-')) return v.voiceKey;
    const map = Object.fromEntries(
      this.cfg.voices
        .split(',')
        .map((x) => x.trim().split(':'))
        .filter((x) => x.length === 2) as [string, string][],
    );
    const list = this.cfg.voices
      .split(',')
      .map((x) => x.trim().split(':').pop()!)
      .filter(Boolean);
    return map[v.gender] ?? list[v.seed % Math.max(1, list.length)] ?? 'alloy';
  }
  speak(text: string, v: VoiceSpec, ev: SpeakEvents = {}): SpeakHandle {
    let cancelled = false;
    const controller = new AbortController();
    const done = (async () => {
      const started = performance.now();
      const r = await fetch(`${this.cfg.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
        method: 'POST',
        signal: controller.signal,
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.cfg.model,
          input: text,
          voice: this.voiceFor(v),
          response_format: 'wav',
          speed: v.rate,
        }),
      });
      if (!r.ok) throw new Error(`El servidor de voz respondió ${r.status}.`);
      if (cancelled) return;
      const decoded = await audioContext().decodeAudioData(await r.arrayBuffer());
      if (cancelled) return;
      ev.onSynthesis?.(performance.now() - started);
      await playPcm(
        decoded.getChannelData(0),
        decoded.sampleRate,
        1,
        text,
        ev,
        () => cancelled,
        controller.signal,
      );
    })()
      .catch((error: unknown) => {
        if (!cancelled) throw error;
      })
      .finally(() => ev.onEnd?.());
    return {
      done,
      cancel: () => {
        cancelled = true;
        controller.abort();
      },
    };
  }
}

/** Sin voz: el texto aparece en pantalla y se espera un tiempo proporcional a su largo. */
export class SilentTts implements Tts {
  readonly id = 'texto';
  readonly label = 'Solo texto';
  speak(text: string, v: VoiceSpec, ev: SpeakEvents = {}): SpeakHandle {
    let cancelled = false;
    const ms = Math.min(6000, 900 + estimateSeconds(text, v.rate) * 450);
    const done = sleep(ms, () => cancelled).finally(() => ev.onEnd?.());
    return { done, cancel: () => (cancelled = true) };
  }
}
