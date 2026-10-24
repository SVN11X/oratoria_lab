import manifest from './manifest.json';
import {
  MANAGED,
  installManaged,
  managedKey,
  managedStatus,
  removeManaged,
  sha256,
  verifyManaged,
  type ManagedProgress,
} from './managed';

export * from './managed';
export * from './ollama';
export * from './catalog';
export * from './inference';

/* Compatibilidad: API anterior centrada en Whisper Tiny. */
export const WHISPER = manifest;
const TINY = MANAGED[0]!;
export const MODEL_CACHE = TINY.cache;
export type DownloadProgress = ManagedProgress;
export const modelKey = (path: string, base: string) => managedKey(TINY, path, base);
export async function verifyBytes(bytes: ArrayBuffer, expected: string): Promise<boolean> {
  return (await sha256(bytes)) === expected;
}
export async function modelAvailable(base: string): Promise<boolean> {
  try {
    return (await managedStatus(TINY, base)).installed;
  } catch {
    return false;
  }
}
export const verifyModel = (base: string, onProgress?: (p: DownloadProgress) => void) =>
  verifyManaged(TINY, base, onProgress);
export const removeModel = async () => {
  await removeManaged(TINY, '/');
};
export const downloadModel = (base: string, signal: AbortSignal, onProgress: (p: DownloadProgress) => void) =>
  installManaged(TINY, base, signal, onProgress);
