import { create } from 'zustand';
import { installManaged, managed, type ManagedProgress } from '@oratoria/model-manager';
import { basePath } from '../services';
import { ollama } from './llm';

/**
 * Descargas en curso. Viven fuera de los componentes para que el progreso siga visible al cambiar
 * de sección. Nada se descarga sin una acción explícita.
 */
export type Job = {
  key: string;
  label: string;
  phase: 'descargando' | 'verificando' | 'listo' | 'error' | 'cancelado';
  status: string;
  completed: number;
  total: number;
  error?: string;
};
type Jobs = { jobs: Record<string, Job> };
export const useJobs = create<Jobs>(() => ({ jobs: {} }));
const controllers = new Map<string, AbortController>();
const set = (key: string, patch: Partial<Job>) =>
  useJobs.setState((s) => ({
    jobs: {
      ...s.jobs,
      [key]: {
        ...(s.jobs[key] ?? { key, label: key, phase: 'descargando', status: '', completed: 0, total: 0 }),
        ...patch,
      },
    },
  }));

export const pullKey = (tag: string) => `ollama:${tag}`;
export const managedJobKey = (id: string) => `managed:${id}`;
export const running = (key: string) => controllers.has(key);
export function cancelJob(key: string) {
  controllers.get(key)?.abort();
}
export function clearJob(key: string) {
  useJobs.setState((s) => {
    const jobs = { ...s.jobs };
    delete jobs[key];
    return { jobs };
  });
}

/** Nombres válidos de Ollama: evita enviar texto arbitrario a la API. */
export const OLLAMA_NAME =
  /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*){0,2}(:[a-z0-9][a-z0-9._-]{0,127})?$/i;

/**
 * Descarga con la API oficial de Ollama (POST /api/pull). Ollama comprueba el SHA-256 de cada
 * capa antes de confirmar «success». Cancelar conserva lo descargado para reanudar.
 */
export async function pullModel(tag: string): Promise<boolean> {
  const key = pullKey(tag);
  if (controllers.has(key)) return false;
  if (!OLLAMA_NAME.test(tag)) {
    set(key, { label: tag, phase: 'error', error: 'El nombre del modelo no es válido.' });
    return false;
  }
  const controller = new AbortController();
  controllers.set(key, controller);
  const layers = new Map<string, { total: number; completed: number }>();
  set(key, {
    label: tag,
    phase: 'descargando',
    status: 'Preparando',
    completed: 0,
    total: 0,
    error: undefined,
  });
  try {
    await ollama().pull(
      tag,
      (p) => {
        if (p.digest && p.total) layers.set(p.digest, { total: p.total, completed: p.completed ?? 0 });
        const total = [...layers.values()].reduce((n, l) => n + l.total, 0),
          completed = [...layers.values()].reduce((n, l) => n + l.completed, 0);
        const verifying = /verif|sha256|writing|manifest/i.test(p.status);
        set(key, {
          phase: verifying ? 'verificando' : 'descargando',
          status: statusText(p.status),
          total,
          completed,
        });
      },
      controller.signal,
    );
    set(key, { phase: 'listo', status: 'Instalado y verificado por Ollama' });
    return true;
  } catch (e) {
    if (controller.signal.aborted)
      set(key, {
        phase: 'cancelado',
        status: 'Descarga cancelada. Si la reanudas, Ollama continúa desde lo ya descargado.',
      });
    else set(key, { phase: 'error', error: e instanceof Error ? e.message : 'La descarga falló.' });
    return false;
  } finally {
    controllers.delete(key);
  }
}
function statusText(s: string) {
  if (/pulling manifest/i.test(s)) return 'Leyendo el manifiesto';
  if (/^pulling/i.test(s)) return 'Descargando capas';
  if (/verifying/i.test(s)) return 'Verificando SHA-256';
  if (/writing manifest/i.test(s)) return 'Registrando el modelo';
  if (/success/i.test(s)) return 'Listo';
  return s;
}

/** Instala un modelo administrado por Oratoria Lab (Whisper, Piper, MediaPipe) en su caché exclusivo. */
export async function installManagedModel(id: string): Promise<boolean> {
  const key = managedJobKey(id);
  const m = managed(id);
  if (!m || controllers.has(key)) return false;
  const controller = new AbortController();
  controllers.set(key, controller);
  set(key, {
    label: m.name,
    phase: 'descargando',
    status: 'Iniciando',
    completed: 0,
    total: m.approxBytes,
    error: undefined,
  });
  try {
    await installManaged(m, basePath, controller.signal, (p: ManagedProgress) =>
      set(key, {
        phase: p.phase === 'verify' ? 'verificando' : 'descargando',
        status: p.file,
        completed: p.received,
        total: Math.max(p.total, p.received),
      }),
    );
    set(key, {
      phase: 'listo',
      status: m.pinned
        ? 'Instalado. Huellas SHA-256 verificadas con la versión fijada.'
        : 'Instalado. Huella SHA-256 registrada; se comprobará en cada uso.',
    });
    return true;
  } catch (e) {
    if (controller.signal.aborted) set(key, { phase: 'cancelado', status: 'Descarga cancelada.' });
    else set(key, { phase: 'error', error: e instanceof Error ? e.message : 'La instalación falló.' });
    return false;
  } finally {
    controllers.delete(key);
  }
}
