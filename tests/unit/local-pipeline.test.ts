import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadHumanPackage,
  evaluateShape,
  DEFAULT_HUMAN,
  HumanAvatar,
} from '../../apps/web/src/vendor/humanforge/runtime';
import { humanLook } from '../../apps/web/src/practice/human-look';
import { defaultLook } from '@oratoria/conversation';
import { libraryStore } from '@oratoria/storage';
import { TextSensors } from '../../apps/web/src/practice/text-sensors';

it('el modo escrito detiene el reloj en pausa y no fabrica mediciones', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  const sensors = new TextSensors();
  clock.mockReturnValue(2000);
  expect(sensors.now()).toBe(1);
  sensors.pause();
  clock.mockReturnValue(5000);
  expect(sensors.now()).toBe(1);
  sensors.setPhase('respuesta');
  clock.mockReturnValue(6000);
  expect(sensors.phaseSeconds('respuesta')).toBe(1);
  expect(sensors.firstVoiceAfter(0)).toBeNull();
  expect(sensors.ticks).toEqual([]);
  expect(await sensors.stop()).toBeNull();
  clock.mockRestore();
});

it('el recurso humano contiene geometría, rig y expresiones reales y todas las apariencias resuelven archivos locales', async () => {
  const root = resolve('apps/web/public/avatars/human');
  const pkg = await loadHumanPackage('file://human', {
    fetch: async (url) => {
      const bytes = readFileSync(resolve(root, url.replace('file://human/', '')));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  });
  expect(pkg.manifest.body.triangles).toBeGreaterThan(10000);
  const avatar = new HumanAvatar(pkg);
  expect(avatar.bones.length).toBeGreaterThan(30);
  expect(avatar.expressionNames).toContain('jawOpen');
  expect(avatar.expressionNames).toContain('eyeBlinkLeft');
  avatar.dispose();
  for (let i = 0; i < 12; i++) {
    const look = humanLook(defaultLook(i, i % 2 ? 'm' : 'f'), i);
    const positions = evaluateShape(pkg, { ...DEFAULT_HUMAN, ...look });
    expect([...positions].every(Number.isFinite)).toBe(true);
    expect(existsSync(resolve(root, `skins/${look.skin}_1k.webp`))).toBe(true);
    for (const id of [look.hair, ...look.clothes!].filter(Boolean)) {
      const proxy = pkg.manifest.proxies.find((p) => p.id === id)!;
      expect(proxy, String(id)).toBeDefined();
      expect(existsSync(resolve(root, proxy.file))).toBe(true);
      if (proxy.texture) expect(existsSync(resolve(root, proxy.texture))).toBe(true);
    }
  }
});

it('Whisper ausente mantiene las respuestas locales y no activa reconocimiento en línea', async () => {
  vi.stubGlobal('location', new URL('http://localhost/'));
  const { useAi, DEFAULT_AI } = await import('../../apps/web/src/ai/settings');
  const { makeStt } = await import('../../apps/web/src/practice/engines');
  expect(DEFAULT_AI.stt).toBe('escrito');
  useAi.setState({ stt: 'whisper-tiny' });
  const r = await makeStt({ onFinal: vi.fn(), onInterim: vi.fn(), onError: vi.fn() }, () => 0);
  expect(r.stt).toBeNull();
  expect(r.warning).toContain('no está instalado');
  expect(r.warning).not.toContain('Se usa el reconocimiento del navegador');
});

it('un ensayo de diapositiva conserva su foco y excluye las demás diapositivas', async () => {
  vi.stubGlobal('location', new URL('http://localhost/'));
  const { makeRetriever } = await import('../../apps/web/src/knowledge/library');
  const chunk = (id: string, slide: number | null, text: string, docId = 'slides') => ({
    id,
    docId,
    slide,
    text,
    docName: docId,
    order: 0,
    location: slide ? `diap. ${slide}` : 'pág. 3',
    page: slide ? null : 3,
    section: 'Resultados',
  });
  await libraryStore.save({ id: 'slides' }, [
    chunk('s1', 1, 'Información ajena al foco'),
    chunk('s2', 2, 'El robot obtuvo error de 4 cm'),
  ]);
  await libraryStore.save({ id: 'thesis' }, [
    chunk('t1', null, 'El error del robot fue 4 cm tras 30 pruebas', 'thesis'),
  ]);
  const r = await makeRetriever(['slides', 'thesis'], { docId: 'slides', slide: 2 });
  const hits = await r!.retrieve('error robot pruebas', 4);
  expect(hits[0]!.chunkId).toBe('s2');
  expect(hits.some((h) => h.chunkId === 's1')).toBe(false);
  expect(hits.some((h) => h.chunkId === 't1')).toBe(true);
});
