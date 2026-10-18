/** Módulo Emscripten de fonemas de Piper (CommonJS sin tipos). */
declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  const create: (options: Record<string, unknown>) => Promise<unknown>;
  export default create;
}
/** ONNX Runtime Web: sus tipos viven en onnxruntime-common. */
declare module 'onnxruntime-web' {
  export * from 'onnxruntime-common';
}
