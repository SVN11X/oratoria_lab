import { COMMITTEE, wordCount, type MemberId } from '@oratoria/defense';

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
export const recognitionSupported = () => typeof window !== 'undefined' && !!ctor();
/**
 * Transcripción en vivo del navegador. En Chrome y Edge el audio se procesa en servidores de
 * Google o Microsoft; por eso es opcional y se avisa antes de usarla.
 */
export class LiveTranscriber {
  private rec: Recognition | null = null;
  private wanted = false;
  private paused = false;
  private failures = 0;
  constructor(
    private lang: string,
    private onFinal: (text: string) => void,
    private onInterim: (text: string) => void,
    private onError: (message: string) => void,
  ) {}
  private create() {
    const Ctor = ctor();
    if (!Ctor) throw new Error('Este navegador no tiene reconocimiento de voz. Usa Chrome o Edge.');
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
          if (text) this.onFinal(text);
        } else interim += `${text} `;
      }
      this.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wanted = false;
        this.onError('El navegador no permitió el reconocimiento de voz. Revisa los permisos del micrófono.');
      } else if (++this.failures >= 3) {
        this.wanted = false;
        this.onError(
          e.error === 'network'
            ? 'El servicio de reconocimiento de voz no responde. Revisa tu conexión; la práctica sigue sin transcripción.'
            : `El reconocimiento de voz se detuvo (${e.error}). La práctica sigue sin transcripción.`,
        );
      }
    };
    rec.onend = () => {
      this.rec = null;
      if (this.wanted && !this.paused) setTimeout(() => this.begin(), 250);
    };
    return rec;
  }
  private begin() {
    if (!this.wanted || this.paused || this.rec) return;
    try {
      this.rec = this.create();
      this.rec.start();
    } catch (error) {
      this.rec = null;
      this.wanted = false;
      this.onError(error instanceof Error ? error.message : 'No se pudo iniciar el reconocimiento de voz.');
    }
  }
  start() {
    this.wanted = true;
    this.paused = false;
    this.begin();
  }
  pause() {
    this.paused = true;
    this.rec?.stop();
  }
  resume() {
    if (!this.wanted) return;
    this.paused = false;
    this.begin();
  }
  stop() {
    this.wanted = false;
    this.rec?.abort();
    this.rec = null;
  }
}
const VOICE_ORDER = ['es-CL', 'es-419', 'es-US', 'es-MX', 'es-AR', 'es-CO', 'es-ES'];
export function spanishVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('es'))
    .sort((a, b) => {
      const rank = (v: SpeechSynthesisVoice) => {
        const i = VOICE_ORDER.findIndex((l) => v.lang.toLowerCase() === l.toLowerCase());
        return (i < 0 ? 9 : i) - (v.localService ? 0.5 : 0);
      };
      return rank(a) - rank(b);
    });
}
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([]);
  const now = spanishVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener('voiceschanged', done);
      clearTimeout(timer);
      resolve(spanishVoices());
    };
    const timer = setTimeout(done, 1500);
    speechSynthesis.addEventListener('voiceschanged', done);
  });
}
/** Cada integrante usa una voz distinta si hay varias en español; si no, cambia el tono. */
export function speak(text: string, member: MemberId, voices: SpeechSynthesisVoice[]): Promise<void> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text),
      m = COMMITTEE[member];
    const voice = voices.length ? voices[member % voices.length] : undefined;
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'es-CL';
    u.pitch = voices.length >= 3 ? 1 : m.pitch;
    u.rate = m.rate;
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      resolve();
    };
    // Algunos navegadores no emiten «end»; se usa un tiempo máximo según el largo del texto.
    const guard = setTimeout(end, 4000 + wordCount(text) * 600);
    u.onend = end;
    u.onerror = end;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}
export function stopSpeaking() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
