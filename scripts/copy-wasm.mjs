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

const licenses = resolve(import.meta.dirname, '../docs/third-party');
const licenseTarget = resolve(import.meta.dirname, '../apps/web/public/third-party');
await mkdir(licenseTarget, { recursive: true });
for (const file of await readdir(licenses))
  await copyFile(resolve(licenses, file), resolve(licenseTarget, file));
