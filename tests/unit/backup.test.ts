import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { newSession, type Session } from '@oratoria/core';
import { analyzeAudio } from '@oratoria/audio';
import { INITIAL_RUBRICS } from '@oratoria/evaluation';
import { BrowserStore } from '@oratoria/storage';
import {
  BACKUP_KDF_ITERATIONS,
  BackupPasswordRequiredError,
  createSessionBackup,
  MAX_BACKUP_BYTES,
  readSessionBackup,
  sessionJSON,
} from '@oratoria/export';

const password = 'Una frase privada para pruebas 2026!';
function writtenSession(): Session {
  const transcript = {
    source: 'manual' as const,
    language: 'es',
    model: null,
    revision: 2,
    updatedAt: '2026-10-13T00:00:00.000Z',
    segments: [
      {
        id: 'seg-1',
        text: 'El propósito es explicar un hallazgo con sus límites.',
        prompt: '¿Cuál es el propósito?',
        start: null,
        end: null,
      },
    ],
  };
  return newSession({
    source: 'guided',
    title: 'Práctica privada',
    transcript,
    evaluation: {
      method: 'manual-evidence-1.0.0',
      rubric: INITIAL_RUBRICS[0]!,
      ratings: [
        {
          criterionId: 'general-0',
          level: 3,
          segmentId: 'seg-1',
          quote: 'El propósito es explicar',
          note: 'Se explicita el propósito.',
        },
      ],
      transcriptRevision: 2,
      createdAt: '2026-10-13T00:00:00.000Z',
    },
  });
}
function audioSession() {
  const rate = 16000,
    pcm = Float32Array.from({ length: rate }, (_, i) => 0.15 * Math.sin((2 * Math.PI * 200 * i) / rate));
  const buffer = new ArrayBuffer(44 + pcm.length * 2),
    bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  for (const [offset, tag] of [
    [0, 'RIFF'],
    [8, 'WAVEfmt '],
    [36, 'data'],
  ] as const)
    bytes.set(new TextEncoder().encode(tag), offset);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(sample * 32767), true));
  const audio = new Blob([bytes], { type: 'audio/wav' });
  const session = newSession({
    title: 'WAV de prueba',
    audioName: 'prueba.wav',
    audioMime: audio.type,
    audioBytes: audio.size,
    audio: analyzeAudio(pcm, rate),
  });
  return { session, audio };
}
const fileFrom = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });

describe('Copias completas y cifradas', () => {
  it('conserva texto, contexto, revisión, valoración y snapshot de rúbrica', async () => {
    const session = writtenSession();
    const restored = await readSessionBackup(await createSessionBackup(session, null));
    expect(restored.session).toEqual(session);
    expect(restored.audio).toBeNull();
  });
  it('restaura el audio original byte por byte y las métricas calculadas', async () => {
    const { session, audio } = audioSession();
    const restored = await readSessionBackup(await createSessionBackup(session, audio));
    expect(restored.session).toEqual(session);
    expect(restored.audio?.type).toBe('audio/wav');
    expect(new Uint8Array(await restored.audio!.arrayBuffer())).toEqual(
      new Uint8Array(await audio.arrayBuffer()),
    );
  });
  it('el audio importado se puede guardar sin afectar la sesión existente', async () => {
    const original = audioSession(),
      store = new BrowserStore();
    await store.save(original.session, original.audio);
    const restored = await readSessionBackup(await createSessionBackup(original.session, original.audio));
    const copy = { ...restored.session, id: crypto.randomUUID() };
    await store.save(copy, restored.audio!);
    expect((await store.get(original.session.id))?.id).toBe(original.session.id);
    expect((await store.get(copy.id))?.title).toBe(original.session.title);
    expect(await (await store.audio(copy.id))!.arrayBuffer()).toEqual(await original.audio.arrayBuffer());
  });
  it('cifra todo el contenido, solicita contraseña y permite descifrado real', async () => {
    const session = writtenSession(),
      backup = await createSessionBackup(session, null, password);
    const content = await backup.text(),
      envelope = JSON.parse(content);
    expect(content).not.toContain(session.title);
    expect(content).not.toContain(session.transcript!.segments[0]!.text);
    expect(envelope).toMatchObject({
      cipher: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: BACKUP_KDF_ITERATIONS,
    });
    await expect(readSessionBackup(backup)).rejects.toBeInstanceOf(BackupPasswordRequiredError);
    expect((await readSessionBackup(backup, password)).session).toEqual(session);
  });
  it('usa salt e IV distintos en cada exportación', async () => {
    const a = JSON.parse(await (await createSessionBackup(writtenSession(), null, password)).text());
    const b = JSON.parse(await (await createSessionBackup(writtenSession(), null, password)).text());
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });
  it('recupera audio binario dentro de una copia cifrada', async () => {
    const { session, audio } = audioSession();
    const encrypted = await createSessionBackup(session, audio, password);
    const restored = await readSessionBackup(encrypted, password);
    expect(restored.session.audio).toEqual(session.audio);
    expect(await restored.audio!.arrayBuffer()).toEqual(await audio.arrayBuffer());
  });
  it('rechaza una contraseña errónea y ciphertext modificado', async () => {
    const backup = await createSessionBackup(writtenSession(), null, password);
    await expect(readSessionBackup(backup, 'Contraseña equivocada de prueba')).rejects.toThrow(
      /contraseña|dañada/,
    );
    const envelope = JSON.parse(await backup.text());
    envelope.data = (envelope.data[0] === 'A' ? 'B' : 'A') + envelope.data.slice(1);
    await expect(readSessionBackup(fileFrom(envelope), password)).rejects.toThrow(/contraseña|dañada/);
  });
  it('rechaza parámetros KDF arbitrarios antes de derivar una clave', async () => {
    const envelope = JSON.parse(await (await createSessionBackup(writtenSession(), null, password)).text());
    envelope.iterations = 1000000000;
    await expect(readSessionBackup(fileFrom(envelope), password)).rejects.toThrow();
  });
  it('rechaza audio truncado, reemplazado o con SHA incorrecto', async () => {
    const { session, audio } = audioSession();
    const backup = JSON.parse(await (await createSessionBackup(session, audio)).text());
    backup.audio.sha256 = '0'.repeat(64);
    await expect(readSessionBackup(fileFrom(backup))).rejects.toThrow(/integridad/);
    backup.audio.bytes -= 1;
    await expect(readSessionBackup(fileFrom(backup))).rejects.toThrow(/metadatos/);
  });
  it('no exporta copias completas sin el audio que declaran ni cabeceras falsas', async () => {
    const { session } = audioSession();
    await expect(createSessionBackup(session, null)).rejects.toThrow(/audio original/);
    const fake = new Blob(['archivo que no es audio'], { type: 'audio/wav' });
    await expect(createSessionBackup({ ...session, audioBytes: fake.size }, fake)).rejects.toThrow(
      /cabecera/,
    );
  });
  it('rechaza evidencias inexistentes y valoraciones de otra revisión', async () => {
    const session = writtenSession();
    const backup = JSON.parse(await (await createSessionBackup(session, null)).text());
    backup.session.evaluation.ratings[0].quote = 'una cita que nunca se dijo';
    await expect(readSessionBackup(fileFrom(backup))).rejects.toThrow(/cita exacta/);
    backup.session.evaluation.ratings[0].quote = session.evaluation!.ratings[0]!.quote;
    backup.session.evaluation.transcriptRevision = 1;
    await expect(readSessionBackup(fileFrom(backup))).rejects.toThrow(/revisión/);
  });
  it('rechaza timestamps métricos inválidos e identificadores repetidos', async () => {
    const { session, audio } = audioSession();
    const backup = JSON.parse(await (await createSessionBackup(session, audio)).text());
    backup.session.audio.frames[1].time = backup.session.audio.frames[0].time;
    await expect(readSessionBackup(fileFrom(backup))).rejects.toThrow(/frames/);
    const written = JSON.parse(await (await createSessionBackup(writtenSession(), null)).text());
    written.session.transcript.segments.push(written.session.transcript.segments[0]);
    await expect(readSessionBackup(fileFrom(written))).rejects.toThrow(/duplicados/);
  });
  it('distingue el informe JSON de una copia restaurable y rechaza JSON inválido', async () => {
    await expect(readSessionBackup(new Blob([sessionJSON(writtenSession())]))).rejects.toThrow(
      /Copia completa/,
    );
    await expect(readSessionBackup(new Blob(['no es JSON']))).rejects.toThrow(/JSON válida/);
  });
  it('limita archivos antes de leerlos y contraseñas antes de cifrar', async () => {
    const oversized = new Blob(['x']),
      text = vi.spyOn(oversized, 'text');
    Object.defineProperty(oversized, 'size', { value: MAX_BACKUP_BYTES + 1 });
    await expect(readSessionBackup(oversized)).rejects.toThrow(/60 MiB/);
    expect(text).not.toHaveBeenCalled();
    await expect(createSessionBackup(writtenSession(), null, 'corta')).rejects.toThrow(/12/);
  });
  it('comprueba Base64 canónico y versiones de formato admitidas', async () => {
    const backup = JSON.parse(await (await createSessionBackup(writtenSession(), null)).text());
    backup.version = 2;
    await expect(readSessionBackup(fileFrom(backup))).rejects.toThrow();
    const { session, audio } = audioSession();
    const withAudio = JSON.parse(await (await createSessionBackup(session, audio)).text());
    withAudio.audio.data = '@@==';
    await expect(readSessionBackup(fileFrom(withAudio))).rejects.toThrow();
  });
});
