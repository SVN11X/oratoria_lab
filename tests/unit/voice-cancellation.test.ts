import { afterEach, expect, it, vi } from 'vitest';
import type { VoiceSpec } from '../../apps/web/src/voice/tts';

const voice: VoiceSpec = { gender: 'f', pitch: 1, rate: 1, pause: 0, emphasis: 0, voiceKey: '', seed: 0 };
afterEach(() => {
  vi.unstubAllGlobals();
});

it('cancelar Web Speech completa la promesa aunque el navegador no emita onend', async () => {
  vi.stubGlobal('location', new URL('http://localhost/'));
  vi.stubGlobal('SpeechSynthesisUtterance', class {});
  vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak: vi.fn() });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const { SystemTts } = await import('../../apps/web/src/voice/tts');
  const ended = vi.fn();
  const handle = new SystemTts([]).speak('Una intervención que puede interrumpirse.', voice, {
    onEnd: ended,
  });
  handle.cancel();
  await handle.done;
  expect(ended).toHaveBeenCalledTimes(1);
});

it('un PCM de Piper que llega después de cancelar nunca crea una reproducción', async () => {
  vi.stubGlobal('location', new URL('http://localhost/'));
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: unknown) => void) | null = null;
    onerror = null;
    requests: Record<string, unknown>[] = [];
    constructor() {
      FakeWorker.instances.push(this);
    }
    postMessage(value: Record<string, unknown>) {
      this.requests.push(value);
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', FakeWorker);
  const audio = vi.fn();
  vi.stubGlobal('AudioContext', audio);
  const { PiperTts, releasePiper } = await import('../../apps/web/src/voice/tts');
  const handle = new PiperTts({ f: 'piper-es_AR-daniela-high', m: 'piper-es_MX-claude-high' }).speak(
    'Esta frase quedó obsoleta.',
    voice,
  );
  const worker = FakeWorker.instances[0]!;
  expect(worker.requests).toHaveLength(1);
  handle.cancel();
  await handle.done;
  worker.onmessage?.({
    data: { id: worker.requests[0]!.id, ok: true, pcm: new Float32Array(40), sampleRate: 22050 },
  });
  expect(audio).not.toHaveBeenCalled();
  releasePiper();
});

it('el servidor TTS aborta la solicitud sin convertir una interrupción en error de voz', async () => {
  vi.stubGlobal('location', new URL('http://localhost/'));
  const fetcher = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { ServerTts } = await import('../../apps/web/src/voice/tts');
  const handle = new ServerTts({ baseUrl: 'http://localhost:8880/v1', model: 'local', voices: '' }).speak(
    'Una frase de prueba.',
    voice,
  );
  handle.cancel();
  await expect(handle.done).resolves.toBeUndefined();
  expect(fetcher.mock.calls[0]?.[1].signal?.aborted).toBe(true);
});
