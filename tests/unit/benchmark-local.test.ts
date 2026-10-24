import { expect, it, vi } from 'vitest';

it('el benchmark repite los mismos casos y parámetros con streaming, sin instalar ni borrar modelos', async () => {
  const script = new URL('../../scripts/benchmark-local.mjs', import.meta.url).pathname;
  const { runBenchmark } = await import(script);
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    const path = new URL(String(url)).pathname;
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    calls.push({ path, body });
    if (path === '/api/tags')
      return Response.json({ models: [{ name: 'qwen3.5:4b', digest: 'prueba-no-pesos' }] });
    if (path === '/api/show') return Response.json({ capabilities: ['completion', 'thinking'] });
    if (path !== '/api/chat') throw new Error('Endpoint no autorizado en el benchmark');
    const content = JSON.stringify({
      pregunta: '¿Cómo justifica el alcance de esa muestra?',
      fuentes: ['S1'],
    });
    return new Response(
      [
        { message: { content: content.slice(0, 25) }, done: false },
        { message: { content: content.slice(25) }, done: false },
        { done: true, eval_count: 20, eval_duration: 1e9, load_duration: 1e8 },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n'),
    );
  });
  const report = await runBenchmark({ models: ['qwen3.5:4b'], repetitions: 2, fetcher });
  expect(report.results).toHaveLength(8);
  expect(report.results[0]).toMatchObject({ sourceIdsValid: true, jsonQuestion: true, tokensPerSecond: 20 });
  expect(report.results[0].firstTokenMilliseconds).toBeGreaterThanOrEqual(0);
  const chats = calls.filter((c) => c.path === '/api/chat');
  expect(chats).toHaveLength(8);
  for (const c of chats)
    expect(c.body).toMatchObject({
      stream: true,
      think: false,
      options: { temperature: 0.2, seed: 23, num_ctx: 4096, num_predict: 160 },
    });
  expect(calls.some((c) => /pull|delete|generate/.test(c.path))).toBe(false);
});
