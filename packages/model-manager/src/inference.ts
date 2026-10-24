/** Una inferencia por servidor. Evita cargar simultáneamente conversación, evaluación y embeddings. */
export class InferenceQueue {
  private active = false;
  private waiting: (() => void)[] = [];

  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let started = false;
      const abort = () => {
        if (started) return; // El trabajo activo recibe la misma señal.
        this.waiting = this.waiting.filter((item) => item !== start);
        reject(signal?.reason ?? new DOMException('Operación cancelada.', 'AbortError'));
      };
      const start = () => {
        if (signal?.aborted) {
          abort();
          this.advance();
          return;
        }
        started = true;
        signal?.removeEventListener('abort', abort);
        this.active = true;
        void Promise.resolve()
          .then(work)
          .then(resolve, reject)
          .finally(() => this.advance());
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (this.active) this.waiting.push(start);
      else start();
    });
  }

  private advance() {
    this.active = false;
    this.waiting.shift()?.();
  }
}

const queues = new Map<string, InferenceQueue>();
export function inferenceQueue(baseUrl: string): InferenceQueue {
  const key = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  if (!queues.has(key)) queues.set(key, new InferenceQueue());
  return queues.get(key)!;
}
