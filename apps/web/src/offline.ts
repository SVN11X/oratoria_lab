import { basePath } from './services';
export type OfflineState = { ready: boolean; totalBytes: number; version: string };
export type OfflineProgress = { verifiedBytes: number; totalBytes: number; file: string };
function message(
  worker: ServiceWorker,
  type: 'prepare' | 'status',
  progress?: (p: OfflineProgress) => void,
): Promise<OfflineState> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer =
      type === 'status'
        ? setTimeout(() => {
            channel.port1.close();
            reject(new Error('El Service Worker no respondió.'));
          }, 5000)
        : undefined;
    channel.port1.onmessage = (
      event: MessageEvent<{ done?: OfflineState; error?: string; progress?: OfflineProgress }>,
    ) => {
      if (event.data.progress) progress?.(event.data.progress);
      if (event.data.done || event.data.error) {
        clearTimeout(timer);
        channel.port1.close();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.done!);
      }
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}
export async function offlineStatus(): Promise<OfflineState | null> {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration(basePath);
  return registration?.active ? message(registration.active, 'status') : null;
}
export async function prepareOffline(progress: (p: OfflineProgress) => void): Promise<OfflineState> {
  if (!('serviceWorker' in navigator)) throw new Error('Este navegador no admite preparación offline.');
  let registration = await navigator.serviceWorker.getRegistration(basePath);
  if (registration) await registration.update();
  else
    registration = await navigator.serviceWorker.register(`${basePath}sw.js`, {
      scope: basePath,
      updateViaCache: 'none',
    });
  const installing = registration.installing;
  if (installing && installing.state !== 'installed' && installing.state !== 'activated')
    await new Promise<void>((resolve, reject) => {
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' || installing.state === 'activated') resolve();
        else if (installing.state === 'redundant')
          reject(new Error('No se pudo instalar el Service Worker.'));
      });
    });
  const ready = registration.waiting || registration.active || (await navigator.serviceWorker.ready).active;
  if (!ready) throw new Error('No se pudo iniciar la preparación offline.');
  return message(ready, 'prepare', progress);
}
