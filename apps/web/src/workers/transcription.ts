import { env, pipeline } from '@huggingface/transformers';
import { MODEL_CACHE, verifyModel } from '@oratoria/model-manager';
import { errorMessage } from '@oratoria/core';
self.onmessage = async (event: MessageEvent<{ pcm: Float32Array; base: string; language: string }>) => {
  try {
    const { pcm, base, language } = event.data;
    if (!(await verifyModel(base))) throw new Error('Instala o repara el modelo en Modelos locales.');
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = new URL(`${base}models/`, self.location.origin).href;
    env.useBrowserCache = false;
    env.useFSCache = false;
    env.useCustomCache = true;
    const cache = await caches.open(MODEL_CACHE);
    env.customCache = {
      match: (key: string) => cache.match(new URL(key, self.location.origin).href),
      put: async () => undefined,
    };
    const wasm = env.backends.onnx.wasm;
    if (!wasm) throw new Error('El motor WASM no está disponible en este navegador.');
    wasm.wasmPaths = new URL(`${base}ort/`, self.location.origin).href;
    wasm.numThreads = 1;
    wasm.proxy = false;
    // During inference only local runtime assets are permitted. Model files come from verified CacheStorage.
    const originalFetch = self.fetch.bind(self);
    self.fetch = (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        self.location.origin,
      );
      if (url.origin !== self.location.origin || !url.pathname.includes('/ort/'))
        throw new Error('Solicitud bloqueada durante inferencia local.');
      return originalFetch(input, init);
    };
    self.postMessage({ phase: 'loading', message: 'Cargando pesos verificados del dispositivo…' });
    const transcriber = await pipeline('automatic-speech-recognition', 'whisper-tiny', {
      device: 'wasm',
      dtype: 'q8',
      local_files_only: true,
    });
    self.postMessage({
      phase: 'processing',
      message: 'Transcribiendo en este dispositivo. La duración depende del equipo.',
    });
    const result = await transcriber(pcm, {
      language,
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    self.postMessage({ result });
    await transcriber.dispose();
  } catch (error) {
    self.postMessage({ error: errorMessage(error) });
  }
};
