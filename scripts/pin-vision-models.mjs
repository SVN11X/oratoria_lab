// Descarga una vez los modelos de MediaPipe y fija su tamaño y SHA-256 en el manifiesto.
// Después de ejecutarlo, la app rechaza cualquier archivo que no coincida exactamente.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const path = resolve(import.meta.dirname, '../apps/web/src/defense/vision-models.json');
const manifest = JSON.parse(await readFile(path, 'utf8'));
for (const model of manifest.models) {
  const response = await fetch(model.url);
  if (!response.ok) throw new Error(`No se pudo descargar ${model.url} (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  model.bytes = bytes.byteLength;
  model.sha256 = createHash('sha256').update(bytes).digest('hex');
  console.log(`${model.id}: ${model.bytes} bytes, SHA-256 ${model.sha256}`);
}
await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
console.log('Manifiesto actualizado. Revisa y guarda el cambio en Git.');
