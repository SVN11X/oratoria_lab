import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ active: 0, maxActive: 0, created: 0 }));
vi.mock('onnxruntime-web', () => ({
  env: { wasm: {} },
  Tensor: class {
    constructor(
      readonly type: string,
      readonly data: unknown,
      readonly dimensions: number[],
    ) {}
    dispose() {}
  },
  InferenceSession: {
    create: async () => {
      state.created++;
      await new Promise((r) => setTimeout(r, 10));
      return {
        inputNames: ['input'],
        outputNames: ['output'],
        release: async () => {},
        run: async () => {
          state.maxActive = Math.max(state.maxActive, ++state.active);
          await new Promise((r) => setTimeout(r, 10));
          state.active--;
          return { output: { data: new Float32Array(2205), dispose() {} } };
        },
      };
    },
  },
}));
vi.mock('@oratoria/model-manager', () => ({
  managed: (id: string) => ({ id }),
  readManaged: async (_model: unknown, file: string) =>
    new TextEncoder().encode(
      file.endsWith('.json')
        ? JSON.stringify({
            audio: { sample_rate: 22050 },
            espeak: { voice: 'es' },
            inference: { noise_scale: 0.6, length_scale: 1, noise_w: 0.8 },
          })
        : 'modelo',
    ),
}));
vi.mock('../../apps/web/node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.js', () => ({
  default: async (options: { print: (text: string) => void }) => ({
    callMain: () => options.print(JSON.stringify({ phoneme_ids: [1, 2, 3] })),
  }),
}));

it('serializa la carga y síntesis de Piper, omite trabajos cancelados en cola y entrega sus medidas', async () => {
  const surface = {
    location: { origin: 'http://localhost' },
    onmessage: null as null | ((event: unknown) => void),
    postMessage: vi.fn(),
  };
  vi.stubGlobal('self', surface);
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array(8)));
  try {
    await import('../../apps/web/src/voice/piper.worker');
    const request = {
      type: 'speak',
      voice: 'voz-local',
      base: '/',
      text: 'Una frase.',
      speaker: 0,
      lengthScale: 1,
    };
    for (const id of [1, 2, 3]) surface.onmessage!({ data: { ...request, id } });
    surface.onmessage!({ data: { type: 'cancel', target: 3 } });
    await vi.waitFor(() => expect(surface.postMessage).toHaveBeenCalledTimes(2));
    const replies = surface.postMessage.mock.calls.map((call) => call[0]);
    expect(
      replies.every((reply) => reply.ok),
      JSON.stringify(replies),
    ).toBe(true);
    expect(state.created).toBe(1);
    expect(state.maxActive).toBe(1);
    expect(replies.map((reply) => reply.id)).toEqual([1, 2]);
    expect(replies[0].timings.voiceAudioMs).toBe(100);
    expect(replies[1].timings.voiceQueueMs).toBeGreaterThan(0);
    expect(replies[0].timings.voiceInferenceMs).toBeGreaterThan(0);
  } finally {
    vi.unstubAllGlobals();
  }
});
