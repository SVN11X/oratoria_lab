import { errorMessage } from '@oratoria/core';
import {
  BackupPasswordRequiredError,
  createSessionBackup,
  readSessionBackup,
  safeFilename,
} from '@oratoria/export';
import type { BackupRequest, BackupResponse } from '../backup-task';

const send = (message: BackupResponse) => self.postMessage(message);
self.onmessage = async ({ data }: MessageEvent<BackupRequest>) => {
  const progress = (phase: string) => send({ kind: 'progress', phase });
  try {
    if (data.kind === 'export') {
      const file = await createSessionBackup(data.session, data.audio, data.password, progress);
      send({
        kind: 'export',
        file,
        filename:
          data.password === undefined
            ? `${safeFilename(data.session.title)}.oratoria.json`
            : 'sesion-cifrada.oratoria',
      });
    } else {
      const result = await readSessionBackup(data.file, data.password, progress);
      send({ kind: 'import', ...result });
    }
  } catch (error) {
    send(
      error instanceof BackupPasswordRequiredError
        ? { kind: 'password-required' }
        : { kind: 'error', message: errorMessage(error) },
    );
  }
};
