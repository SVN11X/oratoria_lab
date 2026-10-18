import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import type { OllamaModel, OllamaRunning, OllamaShow } from '@oratoria/model-manager';
import { ollama } from './llm';
import { useAi } from './settings';

/**
 * Inventario real de Ollama: modelos instalados (/api/tags), cargados en memoria (/api/ps) y
 * detalles de cada uno (/api/show). No se infieren datos que Ollama no informa.
 */
export type Inventory = {
  state: 'idle' | 'loading' | 'ok' | 'error';
  version: string;
  models: OllamaModel[];
  running: OllamaRunning[];
  shows: Map<string, OllamaShow>;
  error: string;
  checkedAt: string;
};
const EMPTY: Inventory = {
  state: 'idle',
  version: '',
  models: [],
  running: [],
  shows: new Map(),
  error: '',
  checkedAt: '',
};
export const useInventory = create<Inventory & { refresh: () => Promise<void> }>((set, get) => ({
  ...EMPTY,
  refresh: async () => {
    const client = ollama(useAi.getState());
    set({ state: get().models.length ? 'ok' : 'loading', error: '' });
    try {
      const [version, models, running] = await Promise.all([
        client.version(),
        client.list(),
        client.running(),
      ]);
      const shows = new Map(get().shows);
      await Promise.all(
        models
          .filter((m) => !shows.has(m.name) || shows.get(m.name)?.modified_at !== m.modified_at)
          .map(async (m) => {
            const s = await client.show(m.name).catch(() => null);
            if (s) shows.set(m.name, { ...s, modified_at: m.modified_at });
          }),
      );
      for (const name of [...shows.keys()]) if (!models.some((m) => m.name === name)) shows.delete(name);
      set({ state: 'ok', version, models, running, shows, error: '', checkedAt: new Date().toISOString() });
    } catch (e) {
      set({
        ...EMPTY,
        state: 'error',
        error: e instanceof Error ? e.message : 'No se pudo consultar Ollama.',
      });
    }
  },
}));

/** Refresca al montar y, opcionalmente, cada cierto tiempo (para ver qué está cargado). */
export function useInventoryAutoRefresh(enabled: boolean, everyMs = 0) {
  const refresh = useInventory((s) => s.refresh);
  const url = useAi((s) => s.ollamaUrl);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    if (!everyMs) return;
    const t = setInterval(() => void refresh(), everyMs);
    return () => clearInterval(t);
  }, [enabled, everyMs, refresh, url]);
}

/** Primera línea útil de la licencia que informa Ollama, sin inventar una si no la hay. */
export function licenseSummary(show: OllamaShow | undefined): string | null {
  const text = show?.license?.trim();
  if (!text) return null;
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 3);
  return line ? line.slice(0, 90) : null;
}

/** Ejecuta una acción asíncrona con estado de ocupado y error. */
export function useAction() {
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [done, setDone] = useState('');
  const run = useCallback(async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setError('');
    setDone('');
    try {
      const msg = await fn();
      if (msg) setDone(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'La acción falló.');
    } finally {
      setBusy('');
    }
  }, []);
  return { busy, error, done, run, setError, setDone };
}
