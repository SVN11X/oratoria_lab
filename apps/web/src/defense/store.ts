import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DefenseReport, Difficulty } from '@oratoria/defense';
import type { LlmConfig } from './llm';

export type DefenseSetup = {
  title: string;
  summary: string;
  minutes: number;
  questions: number;
  difficulty: Difficulty;
  mode: DefenseReport['mode'];
  interruptions: boolean;
  followUps: boolean;
  audience: 0 | 6 | 12;
  distractions: boolean;
  camera: boolean;
  liveText: boolean;
  voice: boolean;
  indicators: boolean;
  record: boolean;
};
export const DEFAULT_SETUP: DefenseSetup = {
  title: '',
  summary: '',
  minutes: 20,
  questions: 6,
  difficulty: 'estandar',
  mode: 'completa',
  interruptions: true,
  followUps: true,
  audience: 6,
  distractions: false,
  camera: true,
  liveText: true,
  voice: true,
  indicators: true,
  record: true,
};
const MAX_REPORTS = 10;
/** Configuración y resultados del simulador. Se guardan solo en este navegador. */
export const useDefense = create(
  persist<{
    setup: DefenseSetup;
    llm: LlmConfig;
    reports: DefenseReport[];
    updateSetup: (s: Partial<DefenseSetup>) => void;
    updateLlm: (c: Partial<LlmConfig>) => void;
    addReport: (r: DefenseReport) => void;
    removeReport: (id: string) => void;
  }>(
    (set) => ({
      setup: DEFAULT_SETUP,
      llm: { enabled: false, baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', apiKey: '' },
      reports: [],
      updateSetup: (s) => set((state) => ({ setup: { ...state.setup, ...s } })),
      updateLlm: (c) => set((state) => ({ llm: { ...state.llm, ...c } })),
      addReport: (r) =>
        set((state) => ({
          reports: [{ ...r, expositionText: r.expositionText.slice(0, 20000) }, ...state.reports].slice(
            0,
            MAX_REPORTS,
          ),
        })),
      removeReport: (id) => set((state) => ({ reports: state.reports.filter((r) => r.id !== id) })),
    }),
    {
      name: 'oratoria-defense-v1',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<typeof current>;
        return {
          ...current,
          ...p,
          setup: { ...DEFAULT_SETUP, ...p.setup },
          llm: { ...current.llm, ...p.llm },
        };
      },
    },
  ),
);
