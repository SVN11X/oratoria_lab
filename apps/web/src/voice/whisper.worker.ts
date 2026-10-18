/// <reference lib="webworker" />
/**
 * Transcripción local persistente: carga un modelo Whisper verificado una vez y transcribe
 * fragmentos de 16 kHz a medida que llegan. No hay solicitudes externas durante la inferencia.
 */
import { env, pipeline } from '@huggingface/transformers';
import { managed, managedKey, verifyManaged } from '@oratoria/model-manager';

type Asr = (
  pcm: Float32Array,
  o: Record<string, unknown>,
) => Promise<{ text?: string } | { text?: string }[]>;
let asr: Promise<Asr> | null = null,
  loaded = '';

async function load(modelId: string, base: string): Promise<Asr> {
  if (asr && loaded === modelId) return asr;
  loaded = modelId;
  asr = (async () => {
    const m = managed(modelId);
    if (!m || m.kind !== 'stt') throw new Error('Modelo de reconocimiento desconocido.');
    if (!(await verifyManaged(m, base)))
      throw new Error(
        `${m.name} no está instalado o está dañado. Revísalo en Configuración → Modelos de IA.`,
      );
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = new URL(`${base}models/`, self.location.origin).href;
    env.useBrowserCache = false;
    env.useFSCache = false;
    env.useCustomCache = true;
    const cache = await caches.open(m.cache);
    env.customCache = {
      match: (key: string) => cache.match(new URL(key, self.location.origin).href),
      put: async () => undefined,
    };
    const wasm = env.backends.onnx.wasm;
    if (!wasm) throw new Error('El motor WASM no está disponible en este navegador.');
    wasm.wasmPaths = new URL(`${base}ort/`, self.location.origin).href;
    wasm.numThreads = 1;
    wasm.proxy = false;
    void managedKey;
    return (await pipeline('automatic-speech-recognition', m.dir, {
      device: 'wasm',
      dtype: 'q8',
      local_files_only: true,
    })) as unknown as Asr;
  })();
  return asr;
}

self.onmessage = async (
  e: MessageEvent<{ id: number; model: string; base: string; pcm?: Float32Array; timestamps?: boolean }>,
) => {
  const { id, model, base, pcm, timestamps } = e.data;
  try {
    const run = await load(model, base);
    if (!pcm) {
      self.postMessage({ id, ok: true, text: '' });
      return;
    }
    if (timestamps) {
      const result = await run(pcm, {
        language: 'spanish',
        task: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      self.postMessage({ id, ok: true, result: Array.isArray(result) ? result[0] : result });
      return;
    }
    const r = await run(pcm, {
      language: 'spanish',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = (Array.isArray(r) ? r.map((x) => x.text ?? '').join(' ') : (r.text ?? '')).trim();
    self.postMessage({ id, ok: true, text });
  } catch (error) {
    asr = null;
    loaded = '';
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Falló la transcripción local.',
    });
  }
};
