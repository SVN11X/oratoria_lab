import { managed, managedStatus } from '@oratoria/model-manager';
import { voiceFor, type Participant } from '@oratoria/conversation';
import { useAi } from '../ai/settings';
import { basePath } from '../services';
import {
  BrowserStt,
  ServerStt,
  WhisperStt,
  browserSttSupported,
  type Stt,
  type SttHandlers,
} from '../voice/stt';
import {
  PiperTts,
  ServerTts,
  SilentTts,
  SystemTts,
  loadSystemVoices,
  type Tts,
  type VoiceSpec,
} from '../voice/tts';

export const STT_TEXT: Record<string, string> = {
  navegador: 'Reconocimiento del navegador (en línea)',
  'whisper-tiny': 'Whisper Tiny en este equipo',
  'whisper-base': 'Whisper Base en este equipo',
  'whisper-small': 'Whisper Small en este equipo',
  servidor: 'Servidor de transcripción local',
  escrito: 'Respuestas escritas',
};
export const TTS_TEXT: Record<string, string> = {
  sistema: 'Voces del sistema',
  piper: 'Voces neuronales Piper (locales)',
  servidor: 'Servidor de voz local',
  texto: 'Solo texto en pantalla',
};

/** Crea el motor de voz elegido o el mejor disponible, informando por qué si hubo que cambiarlo. */
export async function makeTts(): Promise<{ tts: Tts; warning: string }> {
  const s = useAi.getState();
  if (s.tts === 'texto') return { tts: new SilentTts(), warning: '' };
  if (s.tts === 'servidor') return { tts: new ServerTts(s.ttsServer), warning: '' };
  if (s.tts === 'piper') {
    const ok = await Promise.all(
      [s.piper.f, s.piper.m].map(
        async (id) => !!managed(id) && (await managedStatus(managed(id)!, basePath)).installed,
      ),
    );
    if (ok.some(Boolean)) {
      const voices = { f: ok[0] ? s.piper.f : s.piper.m, m: ok[1] ? s.piper.m : s.piper.f };
      return {
        tts: new PiperTts(voices),
        warning: ok.every(Boolean)
          ? ''
          : 'Solo hay una voz Piper instalada: todos los interlocutores usarán esa voz con distinta altura.',
      };
    }
  }
  const voices = await loadSystemVoices(s.allowOnlineVoices);
  if (voices.length)
    return {
      tts: new SystemTts(voices),
      warning: s.tts === 'piper' ? 'No hay voces Piper instaladas. Se usan las voces del sistema.' : '',
    };
  return {
    tts: new SilentTts(),
    warning: 'No hay voces en español disponibles. Los interlocutores se mostrarán por escrito.',
  };
}
export async function makeStt(
  h: SttHandlers,
  clock: () => number,
): Promise<{ stt: Stt | null; warning: string }> {
  const s = useAi.getState();
  if (s.stt === 'escrito') return { stt: null, warning: '' };
  if (s.stt === 'servidor') return { stt: new ServerStt(s.sttServer, h), warning: '' };
  if (s.stt.startsWith('whisper')) {
    const m = managed(s.stt);
    if (m && (await managedStatus(m, basePath)).installed)
      return { stt: new WhisperStt(s.stt, h), warning: '' };
    if (browserSttSupported())
      return {
        stt: new BrowserStt(h, clock),
        warning: `${m?.name ?? 'Whisper'} no está instalado. Se usa el reconocimiento del navegador (en línea).`,
      };
    return {
      stt: null,
      warning: `${m?.name ?? 'Whisper'} no está instalado. Escribe lo esencial de tus respuestas o instálalo en Configuración → Modelos de IA.`,
    };
  }
  if (browserSttSupported()) return { stt: new BrowserStt(h, clock), warning: '' };
  return {
    stt: null,
    warning:
      'Este navegador no tiene reconocimiento de voz. Instala Whisper en Modelos de IA o escribe lo esencial de tus respuestas.',
  };
}
export function voiceSpec(p: Participant, index: number): VoiceSpec {
  const v = voiceFor(p);
  return {
    gender: p.voice.gender,
    pitch: v.pitch,
    rate: v.rate,
    pause: v.pause,
    emphasis: v.emphasis,
    voiceKey: p.voice.voiceKey,
    seed: index,
  };
}
/** Mejor modelo Whisper instalado, empezando por el elegido en Configuración. */
export async function bestWhisper(preferred: string = useAi.getState().stt): Promise<string | null> {
  for (const id of [preferred, 'whisper-small', 'whisper-base', 'whisper-tiny']) {
    const m = managed(id);
    if (m?.kind === 'stt' && (await managedStatus(m, basePath)).installed) return id;
  }
  return null;
}
