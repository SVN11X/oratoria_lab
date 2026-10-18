import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { mkdir, readdir, copyFile, rm } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('onnxruntime-web'));
const target = resolve(import.meta.dirname, '../apps/web/public/ort');
await mkdir(target, { recursive: true });
// Transformers.js (Whisper) y Piper usan el mismo paquete de ONNX Runtime con JSEP: basta una copia.
for (const file of await readdir(target))
  if (!/^ort-wasm-simd-threaded\.jsep\.(wasm|mjs)$/.test(file)) await rm(resolve(target, file));
for (const file of await readdir(source))
  if (/^ort-wasm-simd-threaded\.jsep\.(wasm|mjs)$/.test(file))
    await copyFile(resolve(source, file), resolve(target, file));
console.log('ONNX WASM incluido como recurso local.');

// MediaPipe Tasks Vision: solo la variante con SIMD, que tienen Chrome, Edge, Firefox y Safari actuales.
const webRequire = createRequire(resolve(import.meta.dirname, '../apps/web/package.json'));
const vision = resolve(dirname(webRequire.resolve('@mediapipe/tasks-vision')), 'wasm');
const visionTarget = resolve(import.meta.dirname, '../apps/web/public/mediapipe');
await mkdir(visionTarget, { recursive: true });
for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'])
  await copyFile(resolve(vision, file), resolve(visionTarget, file));
console.log('MediaPipe WASM incluido como recurso local.');

// Fonemas de Piper (espeak-ng compilado a WASM) para las voces neuronales locales.
const piper = resolve(dirname(webRequire.resolve('@diffusionstudio/piper-wasm/build/piper_phonemize.js')));
const piperTarget = resolve(import.meta.dirname, '../apps/web/public/piper');
await mkdir(piperTarget, { recursive: true });
for (const file of ['piper_phonemize.wasm', 'piper_phonemize.data'])
  await copyFile(resolve(piper, file), resolve(piperTarget, file));
console.log('Fonemas de Piper incluidos como recurso local.');

const licenses = resolve(import.meta.dirname, '../docs/third-party');
const licenseTarget = resolve(import.meta.dirname, '../apps/web/public/third-party');
await mkdir(licenseTarget, { recursive: true });
for (const file of await readdir(licenses))
  await copyFile(resolve(licenses, file), resolve(licenseTarget, file));
