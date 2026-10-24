import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RenderQuality } from './render-profile';
import {
  SCENARIOS,
  SCENARIO_ORDER,
  createParticipants,
  type Difficulty,
  type Participant,
  type ScenarioId,
  type SessionConfig,
  type Temperament,
} from '@oratoria/conversation';

export type PracticeSetup = {
  scenario: ScenarioId;
  topic: string;
  context: Record<string, string>;
  participants: Participant[];
  questions: number;
  progressive: boolean;
  followUps: boolean;
  interruptions: boolean;
  openingMinutes: number;
  docIds: string[];
  focus: { docId: string; slide: number } | null;
  camera: boolean;
  inputMode: 'voz' | 'texto';
  avatars: '3d' | 'ilustrados';
  renderQuality: RenderQuality;
  record: boolean;
  indicators: boolean;
  captions: boolean;
  /** Con audífonos se puede interrumpir a los interlocutores hablando. */
  headphones: boolean;
  audience: 0 | 6 | 12;
  /** Fin de turno automático tras este silencio (s). 0 = solo con el botón. */
  autoEnd: number;
  criteria: Record<string, { on: boolean; weight: number }>;
  goal: string;
  advanced: boolean;
};

export function defaultSetup(id: ScenarioId): PracticeSetup {
  const s = SCENARIOS[id];
  const roles = s.defaultRoles.map((r) => s.roles.find((x) => x.id === r)!);
  return {
    scenario: id,
    topic: '',
    context: {},
    participants: createParticipants(roles, s.defaults.difficulty, { academic: id === 'tesis', seed: 7 }),
    questions: s.defaults.questions,
    progressive: s.defaults.progressive,
    followUps: s.defaults.followUps,
    interruptions: s.defaults.interruptions,
    openingMinutes: s.opening.kind === 'ninguna' ? 0 : s.opening.minutes,
    docIds: [],
    focus: null,
    camera: false,
    inputMode: 'voz',
    avatars: '3d',
    renderQuality: 'equilibrado',
    record: true,
    indicators: true,
    captions: true,
    headphones: false,
    audience: id === 'tesis' || id === 'presentacion' || id === 'educativa' ? 6 : 0,
    autoEnd: id === 'dificil' || id === 'entrevista' ? 4 : 6,
    criteria: {},
    goal: '',
    advanced: false,
  };
}

/** Comisiones listas para usar en la configuración rápida. */
export const PRESETS: {
  id: string;
  name: string;
  text: string;
  temperaments: Temperament[];
  difficulty: Difficulty;
}[] = [
  {
    id: 'estandar',
    name: 'Comisión estándar',
    text: 'Cordial, escéptica y exigente. Como una defensa real.',
    temperaments: ['cordial', 'esceptico', 'exigente'],
    difficulty: 'avanzada',
  },
  {
    id: 'amable',
    name: 'Primer ensayo',
    text: 'Amable y cordial, con preguntas de comprensión.',
    temperaments: ['amable', 'cordial', 'amable'],
    difficulty: 'intermedia',
  },
  {
    id: 'dura',
    name: 'Comisión exigente',
    text: 'Seria, muy exigente y desafiante.',
    temperaments: ['serio', 'exigente', 'desafiante'],
    difficulty: 'experta',
  },
  {
    id: 'extrema',
    name: 'Defensa extrema',
    text: 'Objeciones encadenadas y síntesis bajo presión.',
    temperaments: ['esceptico', 'desafiante', 'exigente'],
    difficulty: 'extrema',
  },
];
export function applyPreset(setup: PracticeSetup, presetId: string): PracticeSetup {
  const p = PRESETS.find((x) => x.id === presetId);
  if (!p) return setup;
  return {
    ...setup,
    participants: setup.participants.map((x, i) => ({
      ...x,
      temperament: p.temperaments[i % p.temperaments.length]!,
      difficulty: p.difficulty,
    })),
    progressive: true,
    interruptions: p.id !== 'amable',
  };
}
export function toConfig(setup: PracticeSetup): SessionConfig {
  return {
    scenario: setup.scenario,
    topic: setup.topic.trim(),
    context: Object.fromEntries(Object.entries(setup.context).map(([k, v]) => [k, v.trim()])),
    participants: setup.participants,
    questions: Math.max(1, Math.min(15, setup.questions)),
    progressive: setup.progressive,
    followUps: setup.followUps,
    interruptions: setup.interruptions,
    openingMinutes: Math.max(0, Math.min(60, setup.openingMinutes)),
    focus: setup.focus && setup.docIds.includes(setup.focus.docId) ? setup.focus : null,
  };
}

export const usePractice = create(
  persist<{
    setups: Partial<Record<ScenarioId, PracticeSetup>>;
    update: (id: ScenarioId, patch: Partial<PracticeSetup>) => void;
    reset: (id: ScenarioId) => void;
  }>(
    (set) => ({
      setups: {},
      update: (id, patch) =>
        set((s) => ({ setups: { ...s.setups, [id]: { ...(s.setups[id] ?? defaultSetup(id)), ...patch } } })),
      reset: (id) => set((s) => ({ setups: { ...s.setups, [id]: defaultSetup(id) } })),
    }),
    {
      name: 'oratoria-practice-v1',
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { setups?: Partial<Record<ScenarioId, PracticeSetup>> };
        const setups: Partial<Record<ScenarioId, PracticeSetup>> = {};
        for (const id of SCENARIO_ORDER)
          if (p.setups?.[id]) setups[id] = { ...defaultSetup(id), ...p.setups[id] };
        return { ...current, setups };
      },
    },
  ),
);
export const setupFor = (id: ScenarioId) => usePractice.getState().setups[id] ?? defaultSetup(id);
