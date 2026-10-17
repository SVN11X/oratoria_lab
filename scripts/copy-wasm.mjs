import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { mkdir, readdir, copyFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('onnxruntime-web'));
const target = resolve(import.meta.dirname, '../apps/web/public/ort');
await mkdir(target, { recursive: true });
for (const file of await readdir(source))
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(file)) await copyFile(resolve(source, file), resolve(target, file));
console.log('ONNX WASM incluido como recurso local.');

// MediaPipe Tasks Vision: solo la variante con SIMD, que tienen Chrome, Edge, Firefox y Safari actuales.
const webRequire = createRequire(resolve(import.meta.dirname, '../apps/web/package.json'));
const vision = resolve(dirname(webRequire.resolve('@mediapipe/tasks-vision')), 'wasm');
const visionTarget = resolve(import.meta.dirname, '../apps/web/public/mediapipe');
await mkdir(visionTarget, { recursive: true });
for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'])
  await copyFile(resolve(vision, file), resolve(visionTarget, file));
console.log('MediaPipe WASM incluido como recurso local.');

const licenses = resolve(import.meta.dirname, '../docs/third-party');
const licenseTarget = resolve(import.meta.dirname, '../apps/web/public/third-party');
await mkdir(licenseTarget, { recursive: true });
for (const file of await readdir(licenses))
  await copyFile(resolve(licenses, file), resolve(licenseTarget, file));
