import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { Script } from 'node:vm';
import { gunzipSync } from 'node:zlib';

const dist = resolve(import.meta.dirname, '../apps/web/dist');
const base = process.env.VITE_BASE_PATH || './';
const source = await readFile(resolve(dist, 'sw.js'), 'utf8');
new Script(source, { filename: 'sw.js' });
const match = source.match(/ASSETS = (\[[\s\S]*?\]);/);
if (!match) throw new Error('El Service Worker no contiene un manifiesto de recursos.');
const assets = JSON.parse(match[1]);
const paths = new Set();
let bytes = 0;
for (const asset of assets) {
  if (
    !asset.url.startsWith('./') ||
    paths.has(asset.url) ||
    !Number.isInteger(asset.bytes) ||
    asset.bytes < 1
  )
    throw new Error(`Entrada de manifiesto no válida: ${asset.url}`);
  const path = resolve(dist, asset.url),
    local = relative(dist, path);
  if (local.startsWith('..') || local.startsWith('/')) throw new Error('Ruta fuera de dist.');
  const data = await readFile(path);
  if (data.byteLength !== asset.bytes || createHash('sha256').update(data).digest('hex') !== asset.sha256)
    throw new Error(`Integridad incorrecta: ${asset.url}`);
  if (asset.decoded) {
    const decoded = gunzipSync(data);
    if (
      decoded.byteLength !== asset.decoded.bytes ||
      createHash('sha256').update(decoded).digest('hex') !== asset.decoded.sha256
    )
      throw new Error(`Integridad de descompresión incorrecta: ${asset.url}`);
  }
  paths.add(asset.url);
  bytes += asset.bytes;
}
async function tree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? tree(resolve(directory, entry.name)) : [resolve(directory, entry.name)],
      ),
    )
  ).flat();
}
const files = (await tree(dist)).filter((file) => !file.endsWith('sw.js') && !file.endsWith('.map'));
if (
  files.length !== paths.size ||
  files.some((file) => !paths.has('./' + relative(dist, file).replaceAll('\\', '/')))
)
  throw new Error('Hay recursos del build fuera del manifiesto offline.');
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
if (!html.includes('http-equiv="Content-Security-Policy"')) throw new Error('Falta CSP en producción.');
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
for (const reference of references) {
  if (!reference.startsWith(base) || !paths.has('./' + reference.slice(base.length)))
    throw new Error(`Referencia HTML fuera del base/manifiesto: ${reference}`);
}
for (const required of ['./index.html', './worklets/levels.js', './manifest.webmanifest'])
  if (!paths.has(required)) throw new Error(`Falta recurso: ${required}`);
if (!assets.some((a) => a.url.startsWith('./assets/backup-') && a.url.endsWith('.js')))
  throw new Error('Falta worker de copias.');
console.log(
  JSON.stringify(
    {
      base,
      assets: paths.size,
      bytes,
      mebibytes: Number((bytes / 1024 / 1024).toFixed(2)),
      htmlReferences: references.length,
      integrity: 'SHA-256 y tamaños correctos',
      serviceWorker: 'sintaxis válida; sin ejecutar navegador',
    },
    null,
    2,
  ),
);
