import manifest from './manifest.json';
export const WHISPER = manifest;
export const MODEL_CACHE = `oratoria-whisper-${manifest.revision}`;
export type DownloadProgress = {
  received: number;
  total: number;
  file: string;
  phase: 'download' | 'verify';
};
export const modelKey = (path: string, base: string) =>
  new URL(`${base}models/whisper-tiny/${path}`, location.origin).href;
export async function verifyBytes(bytes: ArrayBuffer, expected: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('') === expected;
}
export async function modelAvailable(base: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(MODEL_CACHE);
    return (await Promise.all(manifest.files.map((f) => cache.match(modelKey(f.path, base))))).every(Boolean);
  } catch {
    return false;
  }
}
export async function verifyModel(
  base: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<boolean> {
  const cache = await caches.open(MODEL_CACHE);
  let received = 0;
  for (const file of manifest.files) {
    const response = await cache.match(modelKey(file.path, base));
    if (!response) return false;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== file.bytes || !(await verifyBytes(bytes, file.sha256))) return false;
    received += file.bytes;
    onProgress?.({ received, total: manifest.totalBytes, file: file.path, phase: 'verify' });
  }
  return true;
}
export async function removeModel() {
  await caches.delete(MODEL_CACHE);
}
export async function downloadModel(
  base: string,
  signal: AbortSignal,
  onProgress: (p: DownloadProgress) => void,
) {
  const cache = await caches.open(MODEL_CACHE);
  let received = 0;
  for (const file of manifest.files) {
    signal.throwIfAborted();
    const existing = await cache.match(modelKey(file.path, base));
    if (existing && (await verifyBytes(await existing.arrayBuffer(), file.sha256))) {
      received += file.bytes;
      continue;
    }
    const response = await fetch(file.url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body)
      throw new Error(`No se pudo descargar ${file.path} (${response.status}).`);
    const reader = response.body.getReader(),
      chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          size += value.byteLength;
          if (size > file.bytes) throw new Error('El archivo excede el tamaño verificado.');
          chunks.push(new Uint8Array(value));
          onProgress({
            received: received + size,
            total: manifest.totalBytes,
            file: file.path,
            phase: 'download',
          });
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    signal.throwIfAborted();
    const bytes = await new Blob(chunks).arrayBuffer();
    onProgress({ received: received + size, total: manifest.totalBytes, file: file.path, phase: 'verify' });
    if (size !== file.bytes || !(await verifyBytes(bytes, file.sha256)))
      throw new Error(`Falló la integridad SHA-256 de ${file.path}.`);
    await cache.put(
      modelKey(file.path, base),
      new Response(bytes, {
        headers: {
          'Content-Type': file.path.endsWith('.json') ? 'application/json' : 'application/octet-stream',
          'X-Oratoria-SHA256': file.sha256,
        },
      }),
    );
    received += size;
  }
}
