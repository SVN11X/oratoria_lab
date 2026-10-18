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
export type SpeakEvents = { onMouth?: (m: Mouth, level: number) => void; onEnd?: () => void };
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
            start = performance.now();
            anchorAt = start;
            loop();
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
    let raf = 0;
    const t0 = ctx.currentTime;
    const loop = () => {
      if (cancelled()) {
        try {
          src.stop();
        } catch {
          /* ya detenido */
        }
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
    src.onended = () => {
      cancelAnimationFrame(raf);
      ev.onMouth?.({ open: 0, wide: 0.5, round: 0 }, 0);
      resolve();
    };
    void ctx.resume().then(() => {
      src.start();
      loop();
    });
  });
}

/* ----------------------------------- Piper (local) ----------------------------------- */
let piperWorker: Worker | null = null;
let seq = 0;
const pending = new Map<
  number,
  (v: { ok: boolean; pcm?: Float32Array; sampleRate?: number; error?: string; speakers?: number }) => void
>();
function piper() {
  if (!piperWorker) {
    piperWorker = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' });
    piperWorker.onmessage = (e: MessageEvent<{ id: number }>) => {
      pending.get(e.data.id)?.(e.data as never);
      pending.delete(e.data.id);
    };
  }
  return piperWorker;
}
function callPiper(msg: Record<string, unknown>) {
  const id = ++seq;
  return new Promise<{
    ok: boolean;
    pcm?: Float32Array;
    sampleRate?: number;
    error?: string;
    speakers?: number;
  }>((resolve) => {
    pending.set(id, resolve);
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
    const { id, speaker } = this.voiceFor(v);
    // La altura se ajusta con la velocidad de reproducción; la duración se compensa al sintetizar.
    const playbackRate = Math.max(0.85, Math.min(1.18, v.pitch));
    const lengthScale = playbackRate / Math.max(0.6, Math.min(1.5, v.rate));
    const done = (async () => {
      const list = phrases(text);
      let next = callPiper({ type: 'speak', voice: id, text: list[0]!.text, speaker, lengthScale });
      for (let i = 0; i < list.length && !cancelled; i++) {
        const r = await next;
        if (!r.ok || !r.pcm) throw new Error(r.error ?? 'No se pudo sintetizar la voz.');
        if (i + 1 < list.length)
          next = callPiper({
            type: 'speak',
            voice: id,
            text: list[i + 1]!.text,
            speaker,
            lengthScale:
              lengthScale *
              (i + 1 === list.length - 1 && /\?$/.test(list[i + 1]!.text) ? 1 + v.emphasis * 0.05 : 1),
          });
        await playPcm(r.pcm, r.sampleRate!, playbackRate, list[i]!.text, ev, () => cancelled);
        if (i + 1 < list.length) await sleep(v.pause * list[i]!.pause, () => cancelled);
      }
    })().finally(() => ev.onEnd?.());
    return { done, cancel: () => (cancelled = true) };
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
      const decoded = await audioContext().decodeAudioData(await r.arrayBuffer());
      if (cancelled) return;
      await playPcm(decoded.getChannelData(0), decoded.sampleRate, 1, text, ev, () => cancelled);
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
