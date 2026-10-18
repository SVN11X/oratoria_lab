import type { Page } from '@playwright/test';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Señal sintética conocida (tono de 200 Hz), solo para pruebas. */
export function fixtureWav(seconds = 2) {
  const rate = 16000,
    size = rate * seconds * 2,
    buffer = Buffer.alloc(44 + size);
  buffer.write('RIFF');
  buffer.writeUInt32LE(36 + size, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(size, 40);
  for (let i = 0; i < rate * seconds; i++)
    buffer.writeInt16LE(Math.round(5000 * Math.sin((2 * Math.PI * 200 * i) / rate)), 44 + i * 2);
  return buffer;
}

/** Material ficticio con secciones y cifras para probar preguntas ancladas al documento. */
export const THESIS_MD = `# Robot de navegación autónoma para bodegas

## Resumen
Este trabajo ficticio presenta un robot que navega en bodegas usando ROS 2 y un sensor LiDAR.

## Metodología
Se realizaron 40 pruebas en un circuito de 120 metros. El algoritmo de planificación elegido fue A* con un mapa de ocupación.

## Resultados
El robot completó el recorrido con un error medio de 12 centímetros y una tasa de éxito del 92 %.

## Limitaciones
Las pruebas se hicieron solo de día y con pasillos despejados.
`;

/** Configuración inicial de IA guardada antes de abrir la app (mismo formato que zustand/persist). */
export async function presetAi(page: Page, state: Record<string, unknown>) {
  await page.addInitScript((s) => {
    if (!localStorage.getItem('oratoria-ai-v1'))
      localStorage.setItem('oratoria-ai-v1', JSON.stringify({ state: s, version: 0 }));
  }, state);
}

/** Recoge solicitudes que salen del servidor local de la app. */
export function trackExternal(page: Page, allow: string[] = []) {
  const external: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith('http://localhost:4173') || url.startsWith('blob:') || url.startsWith('data:')) return;
    if (allow.some((a) => url.startsWith(a))) return;
    external.push(url);
  });
  return external;
}

type MockModel = {
  name: string;
  size: number;
  family: string;
  params: string;
  quant: string;
  embedding?: boolean;
};
/**
 * Servidor que imita la API HTTP documentada de Ollama para probar el gestor de modelos sin
 * descargar nada. Registra cada llamada para verificar que solo se usan endpoints oficiales.
 */
export async function mockOllama(initial: MockModel[]) {
  const models = new Map(initial.map((m) => [m.name, m]));
  const running = new Set<string>();
  const calls: { method: string; path: string; body: unknown }[] = [];
  let questions = 0;
  const QUESTIONS = [
    '[Simulado] ¿Por qué eligió A* y no otro planificador para las bodegas?',
    '[Simulado] ¿Cómo validó que 40 pruebas bastan para sus conclusiones?',
    '[Simulado] ¿Qué ocurriría con pasillos ocupados por personas?',
    '[Simulado] ¿Cómo se compara su error de posición con trabajos similares?',
    '[Simulado] ¿Qué aporte concreto deja su trabajo a la empresa?',
    '[Simulado] ¿Qué haría distinto si repitiera el estudio?',
  ];
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body));
  };
  const tag = (m: MockModel) => ({
    name: m.name,
    model: m.name,
    modified_at: '2026-09-01T10:00:00Z',
    size: m.size,
    digest: `sha256:${Buffer.from(m.name).toString('hex').padEnd(64, '0').slice(0, 64)}`,
    details: { format: 'gguf', family: m.family, parameter_size: m.params, quantization_level: m.quant },
  });
  const read = (req: IncomingMessage) =>
    new Promise<unknown>((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch {
          resolve(data);
        }
      });
    });
  const server: Server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }
    const body = (await read(req)) as Record<string, unknown> | null;
    const path = (req.url ?? '').split('?')[0]!;
    calls.push({ method: req.method ?? '', path, body });
    if (path === '/api/version') return json(res, 200, { version: '0.30.0-prueba' });
    if (path === '/api/tags') return json(res, 200, { models: [...models.values()].map(tag) });
    if (path === '/api/ps')
      return json(res, 200, {
        models: [...running]
          .filter((n) => models.has(n))
          .map((n) => ({ ...tag(models.get(n)!), size_vram: 0 })),
      });
    if (path === '/api/show') {
      const m = models.get(String(body?.model));
      if (!m) return json(res, 404, { error: 'model not found' });
      return json(res, 200, {
        license: 'Licencia de prueba 2.0\nTexto completo de ejemplo.',
        details: tag(m).details,
        model_info: { 'general.architecture': m.family, [`${m.family}.context_length`]: 32768 },
        capabilities: m.embedding ? ['embedding'] : ['completion'],
      });
    }
    if (path === '/api/pull') {
      const name = String(body?.model);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Access-Control-Allow-Origin': '*' });
      const send = (o: unknown) => res.write(JSON.stringify(o) + '\n');
      send({ status: 'pulling manifest' });
      const total = 4_000_000;
      for (let done = 0; done <= total; done += 1_000_000) {
        send({ status: 'pulling abc123', digest: 'sha256:abc123', total, completed: done });
        await new Promise((r) => setTimeout(r, 120));
      }
      send({ status: 'verifying sha256 digest' });
      send({ status: 'writing manifest' });
      send({ status: 'success' });
      models.set(name, {
        name,
        size: total,
        family: name.split(/[:.]/)[0]!,
        params: '4B',
        quant: 'Q4_K_M',
        embedding: /embed/.test(name),
      });
      res.end();
      return;
    }
    if (path === '/api/delete' && req.method === 'DELETE') {
      const name = String(body?.model);
      if (!models.delete(name)) return json(res, 404, { error: `model '${name}' not found` });
      running.delete(name);
      return json(res, 200, {});
    }
    if (path === '/api/generate') {
      if (body?.keep_alive === 0) running.delete(String(body?.model));
      return json(res, 200, { model: body?.model, response: '', done: true, done_reason: 'unload' });
    }
    if (path === '/api/embed') {
      const input = (body?.input as string[]) ?? [];
      const vec = (t: string) =>
        Array.from({ length: 8 }, (_, i) => ((t.charCodeAt(i % t.length) || 1) % 13) / 13 + 0.01);
      return json(res, 200, { embeddings: input.map(vec) });
    }
    if (path === '/api/chat') {
      running.add(String(body?.model));
      const format = body?.format as { properties?: Record<string, unknown> } | string | undefined;
      const props = typeof format === 'object' ? (format.properties ?? {}) : {};
      let content: unknown;
      if ('criterios' in props)
        content = {
          criterios: [],
          resumen: '[Simulado] Evaluación del servidor de prueba.',
          fortalezas: [],
          mejoras: [],
        };
      else if ('tipo' in props)
        content = { tipo: 'parcial', reaccion: 'Entiendo su punto.', repregunta: null, motivo: 'prueba' };
      else if ('pregunta' in props)
        content = { pregunta: QUESTIONS[questions++ % QUESTIONS.length], fuentes: [], motivo: 'prueba' };
      else
        content = {
          repregunta: '¿Por qué considera que el algoritmo era el mejor frente a las alternativas?',
        };
      return json(res, 200, {
        message: { role: 'assistant', content: JSON.stringify(content) },
        done: true,
        total_duration: 1_200_000_000,
        load_duration: 300_000_000,
        eval_count: 40,
        eval_duration: 800_000_000,
      });
    }
    json(res, 404, { error: 'not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, calls, models, running, close: () => new Promise<void>((r) => server.close(() => r())) };
}
