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
type Prefs = {
  theme: 'light' | 'dark' | 'system';
  threshold: number;
  fillers: string[];
  goal: string;
  /** Micrófono elegido (id del dispositivo); vacío = predeterminado. */
  micId: string;
  /** Cámara elegida; vacío = predeterminada. */
  cameraId: string;
  /** Tamaño base del texto, en píxeles. */
  fontSize: 15 | 16 | 18;
  reducedMotion: boolean;
};
export const usePreferences = create(
  persist<Prefs & { update: (data: Partial<Prefs>) => void }>(
    (set) => ({
      theme: 'system',
      threshold: -38,
      fillers: DEFAULT_FILLERS,
      goal: '',
      micId: '',
      cameraId: '',
      fontSize: 15,
      reducedMotion: false,
      update: (data) => set(data),
    }),
    { name: 'oratoria-preferences-v1' },
  ),
);
/** Tema efectivo: el elegido o el del sistema operativo. */
export function effectiveTheme(theme: Prefs['theme']): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
