/// <reference lib="webworker" />
/**
 * Síntesis de voz Piper (VITS) en el navegador: fonemas con espeak-ng (WASM) e inferencia con
 * ONNX Runtime (WASM). La voz se lee del caché local verificado; no hay solicitudes externas.
 */
// Mismo paquete de ONNX Runtime que usa Whisper: un solo binario WASM para ambos.
import * as ort from 'onnxruntime-web';
// El módulo de fonemas es un paquete Emscripten en formato CommonJS.
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import { managed, readManaged } from '@oratoria/model-manager';

type Request =
  | { type: 'load'; id: number; voice: string; base: string }
  | {
      type: 'speak';
      id: number;
      voice: string;
      base: string;
      text: string;
      speaker: number;
      lengthScale: number;
      noiseScale?: number;
      noiseW?: number;
    };
type Incoming = Request | { type: 'cancel'; target: number };
type Config = {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  speaker_id_map?: Record<string, number>;
  num_speakers?: number;
};
type Phonemizer = { callMain: (args: string[]) => void };

const sessions = new Map<string, { session: ort.InferenceSession; config: Config }>();
let phonemizer: Promise<Phonemizer> | null = null;
let lastOutput = '';

async function getPhonemizer(base: string): Promise<Phonemizer> {
  phonemizer ??= (async () => {
    const [wasm, data] = await Promise.all(
      ['piper_phonemize.wasm', 'piper_phonemize.data'].map(async (f) => {
        const r = await fetch(new URL(`${base}piper/${f}`, self.location.origin));
        if (!r.ok) throw new Error(`Falta el componente de fonemas de Piper (${f}).`);
        return r.arrayBuffer();
      }),
    );
    return (await createPiperPhonemize({
      noInitialRun: true,
      wasmBinary: wasm,
      getPreloadedPackage: () => data,
      print: (s: string) => (lastOutput = s),
      printErr: () => undefined,
      locateFile: (p: string) => new URL(`${base}piper/${p}`, self.location.origin).href,
    })) as Phonemizer;
  })().catch((error: unknown) => {
    phonemizer = null;
    throw error;
  });
  return phonemizer;
}
async function getVoice(voice: string, base: string) {
  const hit = sessions.get(voice);
  if (hit) return hit;
  const m = managed(voice);
  if (!m) throw new Error(`Voz desconocida: ${voice}.`);
  const [model, cfg] = await Promise.all([
    readManaged(m, 'model.onnx', base),
    readManaged(m, 'model.onnx.json', base),
  ]);
  const config = JSON.parse(new TextDecoder().decode(cfg)) as Config;
  ort.env.wasm.wasmPaths = new URL(`${base}ort/`, self.location.origin).href;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
  // Se mantienen como máximo tres voces en memoria.
  if (sessions.size >= 3) {
    const [first] = sessions.keys();
    await sessions.get(first!)?.session.release();
    sessions.delete(first!);
  }
  const entry = { session, config };
  sessions.set(voice, entry);
  return entry;
}
async function phonemeIds(text: string, espeakVoice: string, base: string): Promise<number[]> {
  const p = await getPhonemizer(base);
  lastOutput = '';
  p.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  const parsed = JSON.parse(lastOutput) as { phoneme_ids?: number[] };
  if (!parsed.phoneme_ids?.length) throw new Error('No se pudieron obtener los fonemas del texto.');
  return parsed.phoneme_ids;
}

async function run(req: Request, queuedAt: number) {
  const started = performance.now();
  try {
    const { session, config } = await getVoice(req.voice, req.base);
    const loadedAt = performance.now();
    if (req.type === 'load') {
      await getPhonemizer(req.base);
      self.postMessage({
        id: req.id,
        ok: true,
        sampleRate: config.audio.sample_rate,
        speakers: config.num_speakers ?? 1,
      });
      return;
    }
    const ids = await phonemeIds(req.text, config.espeak.voice, req.base);
    const phonemesAt = performance.now();
    const feeds: Record<string, ort.Tensor> = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids.map((x) => BigInt(x))), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor(
        'float32',
        Float32Array.from([
          req.noiseScale ?? config.inference.noise_scale,
          req.lengthScale * config.inference.length_scale,
          req.noiseW ?? config.inference.noise_w,
        ]),
        [3],
      ),
    };
    if (session.inputNames.includes('sid'))
      feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(Math.max(0, req.speaker))]), [1]);
    const out = await session.run(feeds).finally(() => {
      for (const tensor of Object.values(feeds)) tensor.dispose();
    });
    const inferredAt = performance.now();
    let pcm: Float32Array;
    try {
      const audio = (out.output ?? out[session.outputNames[0]!])!.data as Float32Array;
      pcm = Float32Array.from(audio);
    } finally {
      for (const tensor of Object.values(out)) tensor.dispose();
    }
    if (cancelled.has(req.id)) return;
    self.postMessage(
      {
        id: req.id,
        ok: true,
        pcm,
        sampleRate: config.audio.sample_rate,
        synthesisMs: performance.now() - queuedAt,
        timings: {
          voiceQueueMs: started - queuedAt,
          voiceLoadMs: loadedAt - started,
          voicePhonemeMs: phonemesAt - loadedAt,
          voiceInferenceMs: inferredAt - phonemesAt,
          voiceAudioMs: (pcm.length / config.audio.sample_rate) * 1000,
        },
      },
      [pcm.buffer],
    );
  } catch (error) {
    self.postMessage({
      id: req.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Falló la síntesis de voz.',
    });
  }
}
// Emscripten comparte su salida de fonemas y las sesiones ONNX: solo un trabajo a la vez.
let queue = Promise.resolve();
const scheduled = new Set<number>();
const cancelled = new Set<number>();
self.onmessage = (event: MessageEvent<Incoming>) => {
  const req = event.data;
  if (req.type === 'cancel') {
    if (scheduled.has(req.target)) cancelled.add(req.target);
    return;
  }
  const queuedAt = performance.now();
  scheduled.add(req.id);
  const work = async () => {
    try {
      if (!cancelled.has(req.id)) await run(req, queuedAt);
    } finally {
      scheduled.delete(req.id);
      cancelled.delete(req.id);
    }
  };
  queue = queue.then(work, work);
};
