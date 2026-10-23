import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../apps/web/public/avatars');
const provenance = JSON.parse(await readFile(resolve(root, 'PROVENANCE.json'), 'utf8'));
let bytes = 0;
for (const entry of provenance.files) {
  const path = resolve(root, entry.path);
  if (!path.startsWith(root + sep)) throw new Error('Ruta de recurso fuera del paquete.');
  const content = await readFile(path);
  if (content.length !== entry.bytes || createHash('sha256').update(content).digest('hex') !== entry.sha256)
    throw new Error(`El recurso no coincide con la versión revisada: ${entry.path}`);
  bytes += content.length;
}
console.log(
  JSON.stringify({
    resources: provenance.files.length,
    bytes,
    license: provenance.assetLicense,
    integrity: 'SHA-256 correcto',
  }),
);
