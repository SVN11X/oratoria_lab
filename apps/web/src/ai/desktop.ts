import { isDesktop } from '@oratoria/storage';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}
export type SystemInfo = {
  totalMemoryBytes: number;
  availableMemoryBytes: number;
  cpuBrand: string;
  cpuCores: number;
  os: string;
  gpus?: { name: string; totalMemoryBytes: number; availableMemoryBytes: number; source: 'nvidia-smi' }[];
};
export type OllamaStorage = {
  /** Carpeta de modelos de Ollama analizada (solo lectura). */
  root: string;
  totalBytes: number;
  models: {
    name: string;
    layers: { digest: string; bytes: number; shared: boolean }[];
    exclusiveBytes: number;
    sharedBytes: number;
  }[];
};
/** Información del sistema operativo, disponible solo en la app de escritorio. */
export async function systemInfo(): Promise<SystemInfo | null> {
  if (!isDesktop()) return null;
  return invoke<SystemInfo>('system_info').catch(() => null);
}
/**
 * Lee (sin modificar) los manifiestos de Ollama para saber qué capas comparte cada modelo y cuánto
 * espacio se liberaría realmente. Solo en escritorio.
 */
export async function ollamaStorage(): Promise<OllamaStorage | null> {
  if (!isDesktop()) return null;
  return invoke<OllamaStorage>('ollama_storage').catch(() => null);
}
