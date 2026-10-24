import { describe, expect, it, vi } from 'vitest';
import { InferenceQueue, OllamaClient, OllamaError } from '@oratoria/model-manager';

const input = { model: 'qwen3.5:4b', messages: [{ role: 'user', content: 'Caso ficticio' }] };
const bytes = (text: string) => new TextEncoder().encode(text);
const ndjson = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join('\n');
function fragmentedResponse(text: string) {
  const data = bytes(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < data.length; i++) controller.enqueue(data.slice(i, i + 1));
        controller.close();
      },
    }),
  );
}

describe('Streaming de Ollama con bytes reales de NDJSON', () => {
  it('reconstruye UTF-8, registros fragmentados y el último registro sin salto de línea', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      fragmentedResponse(
        ndjson(
          { message: { content: '¿Qué ', thinking: 'No exponer este razonamiento' }, done: false },
          { message: { content: 'evidencia?' }, done: false },
          { done: true, eval_count: 12, eval_duration: 1e9, load_duration: 1e8 },
        ),
      ),
    );
    const client = new OllamaClient('http://localhost:11434', fetcher as typeof fetch);
    const seen: string[] = [];
    const result = await client.chatStream({ ...input, think: false, numCtx: 4096, numPredict: 160 }, (d) =>
      seen.push(d),
    );
    expect(seen).toEqual(['¿Qué ', 'evidencia?']);
    expect(result.content).toBe(seen.join(''));
    expect(result.stats.eval_count).toBe(12);
    expect(result.stats.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(result.stats.clientMs).toBeGreaterThanOrEqual(result.stats.firstTokenMs!);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      stream: true,
      think: false,
      options: { num_ctx: 4096, num_predict: 160 },
    });
  });

  it('entrega el primer fragmento antes de que el servidor termine', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const client = new OllamaClient(
      'http://localhost:11434',
      (async () =>
        new Response(
          new ReadableStream({
            start(c) {
              controller = c;
            },
          }),
        )) as typeof fetch,
    );
    const seen = vi.fn();
    let finished = false;
    const job = client.chatStream(input, seen).then((r) => {
      finished = true;
      return r;
    });
    await vi.waitFor(() => expect(controller).toBeDefined());
    controller.enqueue(bytes(ndjson({ message: { content: 'Una frase.' }, done: false }) + '\n'));
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith('Una frase.'));
    expect(finished).toBe(false);
    controller.enqueue(bytes(ndjson({ done: true })));
    controller.close();
    expect((await job).content).toBe('Una frase.');
  });

  it.each([
    ['corte antes de done', ndjson({ message: { content: 'Parcial' }, done: false })],
    ['registro inválido', '{"message":'],
    ['error del proveedor', ndjson({ error: 'detalle privado del servidor' })],
    ['respuesta vacía', ndjson({ done: true })],
  ])('rechaza %s sin anunciar una respuesta completa', async (_label, text) => {
    const client = new OllamaClient('http://localhost:11434', (async () =>
      fragmentedResponse(text)) as typeof fetch);
    await expect(client.chatStream(input, () => undefined)).rejects.toBeInstanceOf(OllamaError);
  });

  it('conserva el estado HTTP y no publica el cuerpo de un error', async () => {
    const client = new OllamaClient(
      'http://localhost:11434',
      (async () => new Response('tesis privada', { status: 503 })) as typeof fetch,
    );
    await expect(client.chatStream(input, () => undefined)).rejects.toMatchObject({ status: 503 });
  });

  it('cancela un flujo activo y libera el lector aunque el fetch de prueba ignore AbortSignal', async () => {
    const cancel = vi.fn();
    const client = new OllamaClient(
      'http://localhost:11434',
      (async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(bytes(ndjson({ message: { content: 'Parcial' }, done: false }) + '\n'));
            },
            cancel,
          }),
        )) as typeof fetch,
    );
    const abort = new AbortController();
    const seen = vi.fn();
    const job = client.chatStream({ ...input, signal: abort.signal }, seen);
    const rejected = expect(job).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(seen).toHaveBeenCalled());
    abort.abort();
    await rejected;
    expect(cancel).toHaveBeenCalled();
  });

  it('aplica el timeout también después de recibir las cabeceras', async () => {
    const client = new OllamaClient(
      'http://localhost:11434',
      (async () => new Response(new ReadableStream({ start() {} }))) as typeof fetch,
    );
    await expect(client.chatStream({ ...input, timeoutMs: 25 }, () => undefined)).rejects.toThrow(
      'tardó demasiado',
    );
  });

  it('no inicia una solicitud ya cancelada', async () => {
    const fetcher = vi.fn();
    const client = new OllamaClient('http://localhost:11434', fetcher);
    const abort = new AbortController();
    abort.abort();
    await expect(
      client.chatStream({ ...input, signal: abort.signal }, () => undefined),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Concurrencia y memoria del servidor local', () => {
  it('el timeout de consulta semántica incluye la espera en cola', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              stream = c;
            },
          }),
        ),
    );
    const client = new OllamaClient('http://localhost:14561', fetcher);
    const abort = new AbortController();
    const first = client.chatStream({ ...input, signal: abort.signal }, () => undefined);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(stream).toBeDefined());
    await expect(client.embed('qwen3-embedding:0.6b', ['consulta'], undefined, 25)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    abort.abort();
    await rejected;
  });
  it('una solicitud cancelada en cola no bloquea la siguiente', async () => {
    const queue = new InferenceQueue();
    let release!: () => void;
    const first = queue.run(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    await vi.waitFor(() => expect(release).toBeDefined());
    const abort = new AbortController();
    const work = vi.fn(async () => 2);
    const second = queue.run(work, abort.signal);
    const rejected = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    const third = queue.run(async () => 3);
    abort.abort();
    await rejected;
    release();
    await first;
    expect(await third).toBe(3);
    expect(work).not.toHaveBeenCalled();
  });

  it('libera la cola tras un fallo y nunca ejecuta dos inferencias simultáneas', async () => {
    const queue = new InferenceQueue();
    let active = 0,
      maximum = 0;
    const run = (fail: boolean) =>
      queue.run(async () => {
        maximum = Math.max(maximum, ++active);
        await Promise.resolve();
        active--;
        if (fail) throw new Error('Desconexión');
        return true;
      });
    const results = await Promise.allSettled([run(true), run(false), run(false)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
    expect(maximum).toBe(1);
  });
});
