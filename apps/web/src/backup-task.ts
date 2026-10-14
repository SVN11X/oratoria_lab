import type { Session } from '@oratoria/core';
import type { RestoredSession } from '@oratoria/export';

export type BackupRequest =
  | { kind: 'export'; session: Session; audio: Blob | null; password?: string }
  | { kind: 'import'; file: Blob; password?: string };
export type BackupOutcome =
  | { kind: 'export'; file: Blob; filename: string }
  | ({ kind: 'import' } & RestoredSession)
  | { kind: 'password-required' };
export type BackupResponse =
  BackupOutcome | { kind: 'error'; message: string } | { kind: 'progress'; phase: string };

export function runBackupTask(
  request: BackupRequest,
  signal: AbortSignal,
  onProgress: (phase: string) => void,
): Promise<BackupOutcome> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./workers/backup.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      cleanup();
      reject(new DOMException('Operación cancelada', 'AbortError'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }: MessageEvent<BackupResponse>) => {
      if (data.kind === 'progress') {
        onProgress(data.phase);
        return;
      }
      cleanup();
      if (data.kind === 'error') reject(new Error(data.message));
      else resolve(data);
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error('No se pudo procesar la copia en este dispositivo.'));
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
