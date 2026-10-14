import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { store } from '@oratoria/storage';
import { errorMessage, type Session } from '@oratoria/core';
import { DEFAULT_FILLERS } from '@oratoria/evaluation';
export const useSessions = create<{
  sessions: Session[];
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}>((set) => ({
  sessions: [],
  loading: true,
  error: '',
  reload: async () => {
    set({ loading: true, error: '' });
    try {
      set({ sessions: await store.list(), loading: false });
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
    }
  },
}));
export const usePreferences = create(
  persist<{
    theme: 'light' | 'dark';
    threshold: number;
    fillers: string[];
    goal: string;
    update: (
      data: Partial<{ theme: 'light' | 'dark'; threshold: number; fillers: string[]; goal: string }>,
    ) => void;
  }>(
    (set) => ({
      theme: 'light',
      threshold: -38,
      fillers: DEFAULT_FILLERS,
      goal: '',
      update: (data) => set(data),
    }),
    { name: 'oratoria-preferences-v1' },
  ),
);
