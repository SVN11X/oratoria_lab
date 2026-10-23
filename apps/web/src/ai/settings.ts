import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_OLLAMA_URL, type Hardware, type Profile } from '@oratoria/model-manager';

export type SttEngine =
  'navegador' | 'whisper-tiny' | 'whisper-base' | 'whisper-small' | 'servidor' | 'escrito';
export type TtsEngine = 'sistema' | 'piper' | 'servidor' | 'texto';
export type Bench = {
  at: string;
  totalSec: number;
  loadSec: number | null;
  tokensPerSec: number | null;
  jsonOk: boolean;
  spanishOk: boolean;
  note: string;
};
export type AiSettings = {
  /** Usar un modelo de lenguaje; si es false, todo funciona con reglas. */
  useLlm: boolean;
  provider: 'ollama' | 'openai';
  ollamaUrl: string;
  openai: { baseUrl: string; apiKey: string; model: string };
  profile: Profile;
  assign: { conversacion: string; evaluacion: string; embeddings: string };
  stt: SttEngine;
  tts: TtsEngine;
  /** Voces del navegador que se procesan en línea (Google, Microsoft). Desactivado por privacidad. */
  allowOnlineVoices: boolean;
  /** Voz Piper preferida por género. */
  piper: { f: string; m: string };
  ttsServer: { baseUrl: string; model: string; voices: string };
  sttServer: { baseUrl: string; model: string };
  vision: boolean;
  bench: Record<string, Bench>;
  lastUsed: Record<string, string>;
  hardware: Hardware | null;
};
export const DEFAULT_AI: AiSettings = {
  useLlm: false,
  provider: 'ollama',
  ollamaUrl: DEFAULT_OLLAMA_URL,
  openai: { baseUrl: 'http://localhost:1234/v1', apiKey: '', model: '' },
  profile: 'equilibrado',
  assign: { conversacion: '', evaluacion: '', embeddings: '' },
  stt: 'escrito',
  tts: 'sistema',
  allowOnlineVoices: false,
  piper: { f: 'piper-es_AR-daniela-high', m: 'piper-es_MX-claude-high' },
  ttsServer: { baseUrl: 'http://localhost:8880/v1', model: 'tts-1', voices: '' },
  sttServer: { baseUrl: 'http://localhost:8000/v1', model: 'whisper-1' },
  vision: true,
  bench: {},
  lastUsed: {},
  hardware: null,
};

/** Migra la configuración del antiguo simulador de defensa, si existe. */
function legacy(): Partial<AiSettings> {
  try {
    const raw = localStorage.getItem('oratoria-defense-v1');
    if (!raw) return {};
    const llm = (
      JSON.parse(raw) as {
        state?: { llm?: { enabled?: boolean; baseUrl?: string; model?: string; apiKey?: string } };
      }
    ).state?.llm;
    if (!llm?.baseUrl) return {};
    if (/11434/.test(llm.baseUrl))
      return {
        useLlm: !!llm.enabled,
        provider: 'ollama',
        ollamaUrl: llm.baseUrl.replace(/\/v1\/?$/, ''),
        assign: { conversacion: llm.model ?? '', evaluacion: llm.model ?? '', embeddings: '' },
      };
    return {
      useLlm: !!llm.enabled,
      provider: 'openai',
      openai: { baseUrl: llm.baseUrl, apiKey: llm.apiKey ?? '', model: llm.model ?? '' },
    };
  } catch {
    return {};
  }
}

export const useAi = create(
  persist<AiSettings & { update: (p: Partial<AiSettings>) => void; touch: (model: string) => void }>(
    (set) => ({
      ...DEFAULT_AI,
      update: (p) => set(p),
      touch: (model) => set((s) => ({ lastUsed: { ...s.lastUsed, [model]: new Date().toISOString() } })),
    }),
    {
      name: 'oratoria-ai-v1',
      merge: (persisted, current) => {
        const p = (persisted ?? legacy()) as Partial<AiSettings>;
        return {
          ...current,
          ...p,
          openai: { ...current.openai, ...p.openai },
          assign: { ...current.assign, ...p.assign },
          piper: { ...current.piper, ...p.piper },
          ttsServer: { ...current.ttsServer, ...p.ttsServer },
          sttServer: { ...current.sttServer, ...p.sttServer },
        };
      },
    },
  ),
);
