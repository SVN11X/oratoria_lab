// Build replaces the two identifiers with a content hash and a verified asset manifest.
const CACHE = __CACHE__,
  ASSETS = __ASSETS__;
const CONTROL = 'oratoria-offline-control-v1';
const stateKey = () => new URL('offline-state', self.registration.scope).href;
const assetURL = (asset) => new URL(asset.url, self.registration.scope).href;
const totalBytes = ASSETS.reduce((n, a) => n + a.bytes, 0);
async function state() {
  const response = await (await caches.open(CONTROL)).match(stateKey());
  if (!response) return null;
  const value = await response.json();
  return typeof value.cache === 'string' && value.cache.startsWith('oratoria-static-') ? value : null;
}
async function validBytes(bytes, asset) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return (
    bytes.byteLength === asset.bytes &&
    Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('') === asset.sha256
  );
}
async function staticMatch(url, exclude) {
  const names = (await caches.keys())
    .filter((k) => k.startsWith('oratoria-static-') && k !== exclude)
    .reverse();
  for (const name of names) {
    const hit = await (await caches.open(name)).match(url);
    if (hit) return hit;
  }
  return undefined;
}
async function prepare(port) {
  try {
    const cache = await caches.open(CACHE);
    let verifiedBytes = 0;
    for (const asset of ASSETS) {
      const url = assetURL(asset);
      let response = (await cache.match(url)) || (await staticMatch(url, CACHE));
      let bytes = response ? await response.arrayBuffer() : null;
      if (!bytes || !(await validBytes(bytes, asset))) {
        response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
        if (!response.ok) throw new Error(`No se pudo preparar ${asset.url}.`);
        bytes = await response.arrayBuffer();
        if (!(await validBytes(bytes, asset))) throw new Error(`Integridad incorrecta: ${asset.url}.`);
      }
      await cache.put(
        url,
        new Response(bytes, {
          headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream' },
        }),
      );
      verifiedBytes += asset.bytes;
      port.postMessage({ progress: { verifiedBytes, totalBytes, file: asset.url } });
    }
    // Switch only after every asset was verified. Interrupted preparation keeps the previous shell usable.
    await (
      await caches.open(CONTROL)
    ).put(
      stateKey(),
      new Response(JSON.stringify({ cache: CACHE, totalBytes, ready: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    // Preserve one previous static version for tabs still using its hashed chunks; never touch models/IndexedDB.
    const old = (await caches.keys()).filter((k) => k.startsWith('oratoria-static-') && k !== CACHE);
    await Promise.all(old.slice(0, -1).map((k) => caches.delete(k)));
    port.postMessage({ done: { ready: true, totalBytes, version: CACHE } });
    await self.skipWaiting();
  } catch (error) {
    port.postMessage({
      error: error instanceof Error ? error.message : 'No se pudo preparar el uso offline.',
    });
  }
}
// Installation/update checks do not silently download the application's assets.
self.addEventListener('install', () => {});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  const port = event.ports[0];
  if (!port) return;
  if (event.data?.type === 'prepare') event.waitUntil(prepare(port));
  else if (event.data?.type === 'status')
    event.waitUntil(
      (async () => {
        try {
          const stored = await state();
          const ready =
            !!stored &&
            !!(await (
              await caches.open(stored.cache)
            ).match(new URL('index.html', self.registration.scope).href));
          port.postMessage({ done: { ready, totalBytes, version: CACHE } });
        } catch {
          port.postMessage({ done: { ready: false, totalBytes, version: CACHE } });
        }
      })(),
    );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const stored = await state();
      if (stored) {
        const cache = await caches.open(stored.cache),
          hit = await cache.match(event.request);
        if (hit) return hit;
        if (event.request.mode === 'navigate') {
          const index = await cache.match(new URL('index.html', self.registration.scope).href);
          if (index) return index;
        }
        const previous = await staticMatch(event.request.url, stored.cache);
        if (previous) return previous;
      }
      return fetch(event.request);
    })(),
  );
});
