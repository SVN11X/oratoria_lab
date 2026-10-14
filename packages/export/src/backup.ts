import { z } from 'zod';
import { SessionSchema, MAX_AUDIO_BYTES, MAX_DURATION_SECONDS, type Session } from '@oratoria/core';
import { checkAudioFile } from '@oratoria/audio';
import { validateRatings } from '@oratoria/evaluation';

export const MAX_BACKUP_BYTES = 60 * 1024 * 1024;
const MAX_PLAIN_BYTES = 44 * 1024 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
export const BACKUP_KDF_ITERATIONS = 600000;
const encoder = new TextEncoder();
const aad = encoder.encode('oratoria-session-encrypted/1;AES-256-GCM;PBKDF2-SHA256;600000');
const Base64Schema = z
  .string()
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Base64 no válido')
  .refine((value) => value.length % 4 === 0, 'Longitud Base64 no válida');
const AudioBackupSchema = z.strictObject({
  mime: z
    .string()
    .max(120)
    .regex(/^(?:(?:audio|video)\/[a-z0-9.+-]+(?:;[a-z0-9=, ."_-]+)?|application\/octet-stream)$/i),
  bytes: z.number().int().positive().max(MAX_AUDIO_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  data: Base64Schema.max(4 * Math.ceil(MAX_AUDIO_BYTES / 3)),
});
const PlainBackupSchema = z.strictObject({
  format: z.literal('oratoria-session-backup'),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  session: SessionSchema,
  audio: AudioBackupSchema.nullable(),
});
const EncryptedBackupSchema = z.strictObject({
  format: z.literal('oratoria-session-encrypted'),
  version: z.literal(1),
  cipher: z.literal('AES-256-GCM'),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.literal(BACKUP_KDF_ITERATIONS),
  salt: Base64Schema.length(24),
  iv: Base64Schema.length(16),
  data: Base64Schema.min(24).max(4 * Math.ceil((MAX_PLAIN_BYTES + 16) / 3)),
});
export interface RestoredSession {
  session: Session;
  audio: Blob | null;
}
export class BackupPasswordRequiredError extends Error {
  constructor() {
    super('Esta copia está cifrada. Introduce su contraseña para abrirla.');
    this.name = 'BackupPasswordRequiredError';
  }
}
function subtle() {
  if (!globalThis.crypto?.subtle)
    throw new Error('Se necesita HTTPS o localhost y soporte Web Crypto para comprobar o cifrar copias.');
  return crypto.subtle;
}
function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  // Multiples of three preserve base64 groups across bounded chunks.
  for (let i = 0; i < bytes.length; i += 24576)
    parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 24576))));
  return parts.join('');
}
function fromBase64(value: string, limit: number): Uint8Array<ArrayBuffer> {
  const size = (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  if (size > limit) throw new Error('El contenido supera el límite admitido.');
  const output = new Uint8Array(size);
  for (let offset = 0, i = 0; i < value.length; i += 32768) {
    const binary = atob(value.slice(i, i + 32768));
    for (let j = 0; j < binary.length; j++) output[offset++] = binary.charCodeAt(j);
  }
  // Reject noncanonical encodings, including nonzero unused padding bits.
  if (toBase64(output) !== value) throw new Error('Base64 no canónico.');
  return output;
}
async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await subtle().digest('SHA-256', bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}
function validateSession(value: unknown): Session {
  const session = SessionSchema.parse(value);
  if (encoder.encode(JSON.stringify(session)).byteLength > MAX_METADATA_BYTES)
    throw new Error('Los datos de la sesión superan 8 MiB.');
  const segments = session.transcript?.segments ?? [];
  if (new Set(segments.map((s) => s.id)).size !== segments.length)
    throw new Error('La transcripción tiene identificadores duplicados.');
  const audio = session.audio;
  if (audio) {
    if (
      !session.audioBytes ||
      audio.duration > MAX_DURATION_SECONDS + 0.1 ||
      audio.frames.length > 30005 ||
      audio.envelope.length > 600 ||
      audio.pauses.length > 2401 ||
      audio.thresholdDbfs < -60 ||
      audio.thresholdDbfs > -15 ||
      Math.abs(audio.activeSeconds + audio.silenceSeconds - audio.duration) > 0.001
    )
      throw new Error('Las métricas acústicas de la copia son incoherentes o superan los límites.');
    let previous = -1;
    for (const frame of audio.frames) {
      if (frame.time < 0 || frame.time <= previous || frame.time > audio.duration || frame.rms < 0)
        throw new Error('La secuencia de frames de audio no es válida.');
      previous = frame.time;
    }
    previous = -1;
    for (const pause of audio.pauses) {
      if (
        pause.start < 0 ||
        pause.end > audio.duration ||
        pause.end <= pause.start ||
        pause.start < previous ||
        Math.abs(pause.end - pause.start - pause.duration) > 0.001
      )
        throw new Error('Los intervalos de pausa no son válidos.');
      previous = pause.end;
    }
  }
  if (session.evaluation) {
    const evaluation = session.evaluation;
    if (!session.transcript || evaluation.transcriptRevision !== session.transcript.revision)
      throw new Error('La valoración no corresponde a la revisión de la transcripción.');
    if (new Set(evaluation.rubric.criteria.map((c) => c.id)).size !== evaluation.rubric.criteria.length)
      throw new Error('La rúbrica tiene criterios duplicados.');
    const errors = validateRatings(evaluation.ratings, evaluation.rubric, session.transcript);
    if (errors.length) throw new Error(errors.join(' '));
  }
  return session;
}
function validatePassword(password: string) {
  if (password.length < 12 || password.length > 1024 || !password.trim())
    throw new Error('Usa una contraseña de entre 12 y 1024 caracteres.');
}
async function keyFromPassword(password: string, salt: Uint8Array<ArrayBuffer>) {
  validatePassword(password);
  const api = subtle();
  const material = await api.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return api.deriveKey(
    { name: 'PBKDF2', salt, iterations: BACKUP_KDF_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
/** Portable per-session backup. No model weights or device preferences are included. */
export async function createSessionBackup(
  value: Session,
  blob: Blob | null,
  password?: string,
  onProgress: (phase: string) => void = () => {},
): Promise<Blob> {
  if (password !== undefined) validatePassword(password);
  onProgress('Comprobando los datos guardados…');
  const session = validateSession(value);
  if (!!session.audioBytes !== !!blob || (blob && blob.size !== session.audioBytes))
    throw new Error('No se encontró el audio original completo de esta sesión.');
  let audio: z.infer<typeof AudioBackupSchema> | null = null;
  if (blob) {
    await checkAudioFile(blob);
    onProgress('Comprobando la integridad del audio…');
    const bytes = await blob.arrayBuffer();
    audio = AudioBackupSchema.parse({
      mime: session.audioMime || blob.type || 'application/octet-stream',
      bytes: blob.size,
      sha256: await sha256(bytes),
      data: toBase64(new Uint8Array(bytes)),
    });
  }
  const plain = encoder.encode(
    JSON.stringify(
      PlainBackupSchema.parse({
        format: 'oratoria-session-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        session,
        audio,
      }),
    ),
  );
  if (plain.byteLength > MAX_PLAIN_BYTES) throw new Error('La copia supera 44 MiB sin cifrar.');
  if (password === undefined) return new Blob([plain], { type: 'application/json' });
  onProgress('Cifrando la copia en este dispositivo…');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromPassword(password, salt);
  const encrypted = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    plain,
  );
  return new Blob(
    [
      JSON.stringify({
        format: 'oratoria-session-encrypted',
        version: 1,
        cipher: 'AES-256-GCM',
        kdf: 'PBKDF2-SHA256',
        iterations: BACKUP_KDF_ITERATIONS,
        salt: toBase64(salt),
        iv: toBase64(iv),
        data: toBase64(new Uint8Array(encrypted)),
      }),
    ],
    { type: 'application/json' },
  );
}
export async function readSessionBackup(
  file: Blob,
  password?: string,
  onProgress: (phase: string) => void = () => {},
): Promise<RestoredSession> {
  if (!file.size || file.size > MAX_BACKUP_BYTES)
    throw new Error('La copia debe ocupar entre 1 byte y 60 MiB.');
  onProgress('Leyendo la copia local…');
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error('El archivo no contiene una copia JSON válida.');
  }
  const format = typeof value === 'object' && value !== null && 'format' in value ? value.format : null;
  if (format === 'oratoria-session-encrypted') {
    const encrypted = EncryptedBackupSchema.parse(value);
    const salt = fromBase64(encrypted.salt, 16),
      iv = fromBase64(encrypted.iv, 12);
    if (salt.byteLength !== 16 || iv.byteLength !== 12) throw new Error('Parámetros de cifrado no válidos.');
    if (password === undefined) throw new BackupPasswordRequiredError();
    onProgress('Descifrando la copia en este dispositivo…');
    const key = await keyFromPassword(password, salt);
    const data = fromBase64(encrypted.data, MAX_PLAIN_BYTES + 16);
    let plain: ArrayBuffer;
    try {
      plain = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, data);
    } catch {
      throw new Error('La contraseña no es correcta o la copia cifrada está dañada.');
    }
    if (plain.byteLength > MAX_PLAIN_BYTES) throw new Error('El contenido de la copia supera 44 MiB.');
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
    } catch {
      throw new Error('El contenido descifrado no es una copia válida.');
    }
  } else if (format !== 'oratoria-session-backup') {
    throw new Error(
      'Selecciona un archivo creado con «Copia completa». El informe JSON no incluye el audio para restaurar.',
    );
  } else if (file.size > MAX_PLAIN_BYTES) throw new Error('La copia sin cifrar supera 44 MiB.');
  onProgress('Verificando la sesión y sus evidencias…');
  const backup = PlainBackupSchema.parse(value);
  const session = validateSession(backup.session);
  if (
    !!session.audioBytes !== !!backup.audio ||
    (backup.audio &&
      (session.audioBytes !== backup.audio.bytes ||
        (session.audioMime && session.audioMime !== backup.audio.mime)))
  )
    throw new Error('Los metadatos del audio no coinciden con la grabación incluida.');
  if (!backup.audio) return { session, audio: null };
  onProgress('Verificando SHA-256 del audio original…');
  const bytes = fromBase64(backup.audio.data, MAX_AUDIO_BYTES);
  if (bytes.byteLength !== backup.audio.bytes || (await sha256(bytes.buffer)) !== backup.audio.sha256)
    throw new Error('El audio de la copia está incompleto o su integridad no coincide.');
  const audio = new Blob([bytes], { type: backup.audio.mime });
  await checkAudioFile(audio);
  return { session, audio };
}
