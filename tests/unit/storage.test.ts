import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BrowserStore, db, drafts, rubricStore } from '@oratoria/storage';
import { newSession } from '@oratoria/core';
import { INITIAL_RUBRICS } from '@oratoria/evaluation';
const store = new BrowserStore();
beforeEach(async () => {
  const d = await db();
  for (const name of ['sessions', 'audio', 'chunks', 'rubrics'] as const) await d.clear(name);
});
describe('Persistencia local', () => {
  it('guarda y recupera metadatos con audio binario', async () => {
    const s = newSession({ title: 'Audio real de prueba', audioBytes: 3 });
    await store.save(s, new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }));
    expect((await store.get(s.id))?.title).toBe(s.title);
    expect(Array.from(new Uint8Array(await (await store.audio(s.id))!.arrayBuffer()))).toEqual([1, 2, 3]);
  });
  it('actualizar el texto conserva el audio original', async () => {
    const s = newSession();
    await store.save(s, new Blob(['audio']));
    await store.save({ ...s, title: 'Editada' });
    expect(await (await store.audio(s.id))!.text()).toBe('audio');
  });
  it('la eliminación borra metadata y audio de la sesión elegida', async () => {
    const a = newSession(),
      b = newSession();
    await store.save(a, new Blob(['a']));
    await store.save(b, new Blob(['b']));
    await store.remove(a.id);
    expect(await store.get(a.id)).toBeUndefined();
    expect(await store.audio(a.id)).toBeUndefined();
    expect(await (await store.audio(b.id))!.text()).toBe('b');
  });
  it('no escribe una sesión inválida', async () => {
    const s = newSession();
    await expect(store.save({ ...s, title: '' })).rejects.toThrow();
    expect(await store.list()).toHaveLength(0);
  });
  it('ordena el historial desde la sesión más reciente', async () => {
    const a = newSession({ createdAt: '2026-01-01T00:00:00.000Z' }),
      b = newSession({ createdAt: '2026-01-02T00:00:00.000Z' });
    await store.save(a);
    await store.save(b);
    expect((await store.list()).map((s) => s.id)).toEqual([b.id, a.id]);
  });
  it('ensambla chunks en orden y los elimina al terminar', async () => {
    await drafts.append('r', 1, new Blob(['b']));
    await drafts.append('r', 0, new Blob(['a']));
    expect(await (await drafts.finish('r', 'audio/webm')).text()).toBe('ab');
    expect(await (await db()).count('chunks')).toBe(0);
  });
  it('conserva distintas versiones de una rúbrica', async () => {
    const r = INITIAL_RUBRICS[0]!;
    await rubricStore.save(r);
    await rubricStore.save({ ...r, version: 2, name: 'Revisada' });
    expect(await rubricStore.list()).toHaveLength(2);
  });
});
