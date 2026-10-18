import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const base = process.env.VITE_BASE_PATH || './';
async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const lists = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? files(resolve(dir, e.name)) : Promise.resolve([resolve(dir, e.name)]),
    ),
  );
  return lists.flat();
}
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwind(),
    {
      name: 'local-offline-shell',
      transformIndexHtml(html, context) {
        return context.server ? html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/, '') : html;
      },
      async closeBundle() {
        const dist = resolve(import.meta.dirname, 'dist');
        // ONNX Runtime referencia su WASM junto al código, pero los trabajadores fijan wasmPaths en
        // ./ort/. La copia duplicada (21 MB) nunca se descarga: se elimina del build y del manifiesto.
        for (const file of await files(resolve(dist, 'assets')))
          if (/ort-wasm-simd-threaded\.jsep-[\w-]+\.wasm$/.test(file)) await rm(file);
        const all = await files(dist);
        const assets = all.filter((f) => !f.endsWith('sw.js') && !f.endsWith('.map'));
        const digest = createHash('sha256');
        for (const file of assets) digest.update(await readFile(file));
        const cache = `oratoria-static-${digest.digest('hex').slice(0, 12)}`;
        const entries = await Promise.all(
          assets.map(async (file) => {
            const data = await readFile(file);
            return {
              url: './' + relative(dist, file).replaceAll('\\', '/'),
              bytes: data.byteLength,
              sha256: createHash('sha256').update(data).digest('hex'),
            };
          }),
        );
        const template = await readFile(
          resolve(import.meta.dirname, '../../scripts/service-worker.template.js'),
          'utf8',
        );
        await writeFile(
          resolve(dist, 'sw.js'),
          template.replace('__CACHE__', JSON.stringify(cache)).replace('__ASSETS__', JSON.stringify(entries)),
        );
      },
    },
  ],
  worker: { format: 'es' },
  build: { target: 'es2022', emptyOutDir: true },
});
