import { describe, expect, it } from 'vitest';
import {
  OllamaClient,
  OllamaError,
  auditModels,
  planProfile,
  paramsBillions,
  isEmbeddingModel,
  profileForHardware,
  MANAGED,
  formatBytes,
  type OllamaModel,
  type Hardware,
} from '@oratoria/model-manager';

const model = (
  name: string,
  size: number,
  parameter_size?: string,
  family = 'qwen2',
  quant = 'Q4_K_M',
): OllamaModel => ({
  name,
  model: name,
  modified_at: '2026-01-01T00:00:00Z',
  size,
  digest: name.replace(/\W/g, '').padEnd(12, '0'),
  details: { family, parameter_size, quantization_level: quant, format: 'gguf' },
});
const HW: Hardware = { ramGb: 16, ramSource: 'sistema', cores: 8, gpu: null, webgpu: false, cpuScore: 1 };

/** Servidor falso que imita la API documentada de Ollama para probar el cliente. */
function fakeOllama() {
  const state = {
    models: [
      model('qwen2.5:7b', 4.7e9, '7.6B'),
      model('nomic-embed-text:latest', 274e6, '137M', 'nomic-bert', 'F16'),
    ],
    running: [] as string[],
    calls: [] as string[],
  };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    state.calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    switch (`${init?.method ?? 'GET'} ${url.pathname}`) {
      case 'GET /api/version':
        return json({ version: '0.12.6' });
      case 'GET /api/tags':
        return json({ models: state.models });
      case 'GET /api/ps':
        return json({
          models: state.models
            .filter((m) => state.running.includes(m.name))
            .map((m) => ({ ...m, size_vram: 0 })),
        });
      case 'POST /api/show':
        return state.models.some((m) => m.name === body.model)
          ? json({
              license: 'Apache 2.0',
              capabilities: body.model.includes('embed') ? ['embedding'] : ['completion'],
            })
          : json({ error: `model '${body.model}' not found` }, 404);
      case 'DELETE /api/delete': {
        const before = state.models.length;
        state.models = state.models.filter((m) => m.name !== body.model);
        return before === state.models.length
          ? json({ error: 'model not found' }, 404)
          : new Response(null, { status: 200 });
      }
      case 'POST /api/generate':
        if (body.keep_alive === 0) state.running = state.running.filter((r) => r !== body.model);
        return json({ done: true });
      case 'POST /api/chat':
        state.running.push(body.model);
        return json({
          message: { content: '{"saludo":"Hola"}' },
          eval_count: 20,
          eval_duration: 1e9,
          load_duration: 5e8,
        });
      case 'POST /api/embed':
        return json({ embeddings: body.input.map(() => [0.1, 0.2, 0.3]) });
      case 'POST /api/pull': {
        const lines = [
          { status: 'pulling manifest' },
          { status: 'pulling abc', digest: 'sha256:abc', total: 100, completed: 50 },
          { status: 'pulling abc', digest: 'sha256:abc', total: 100, completed: 100 },
          { status: 'success' },
        ];
        if (body.model === 'roto:1b')
          lines.splice(1, 3, { status: 'x', error: 'pull model manifest: file does not exist' } as never);
        state.models.push(model(body.model, 1e9, '1B'));
        return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200 });
      }
      default:
        return json({ error: 'no' }, 404);
    }
  }) as typeof fetch;
  return { state, client: new OllamaClient('http://localhost:11434/v1', fetcher) };
}

describe('Cliente de Ollama (API documentada)', () => {
  it('lista, muestra, carga, descarga de memoria y desinstala de forma real', async () => {
    const { state, client } = fakeOllama();
    expect(await client.version()).toBe('0.12.6');
    expect((await client.list()).map((m) => m.name)).toEqual(['qwen2.5:7b', 'nomic-embed-text:latest']);
    expect((await client.show('qwen2.5:7b')).license).toBe('Apache 2.0');
    const r = await client.chat({
      model: 'qwen2.5:7b',
      messages: [{ role: 'user', content: 'hola' }],
      format: 'json',
    });
    expect(r.content).toContain('saludo');
    expect(r.stats.eval_count).toBe(20);
    expect((await client.running()).map((m) => m.name)).toEqual(['qwen2.5:7b']);
    await client.unload('qwen2.5:7b');
    expect(await client.running()).toEqual([]);
    await client.remove('qwen2.5:7b');
    expect((await client.list()).map((m) => m.name)).toEqual(['nomic-embed-text:latest']);
    expect(state.calls).toContain('DELETE /api/delete');
    await expect(client.remove('qwen2.5:7b')).rejects.toBeInstanceOf(OllamaError);
  });
  it('quita /v1 de la dirección para usar la API nativa', async () => {
    const { state, client } = fakeOllama();
    await client.list();
    expect(state.calls[0]).toBe('GET /api/tags');
  });
  it('descarga con progreso y detecta errores de Ollama en el flujo', async () => {
    const { client } = fakeOllama();
    const seen: number[] = [];
    await client.pull('qwen3.5:2b', (p) => p.completed && seen.push(p.completed));
    expect(seen).toEqual([50, 100]);
    await expect(client.pull('roto:1b', () => undefined)).rejects.toThrow('file does not exist');
  });
  it('obtiene embeddings y valida su cantidad', async () => {
    const { client } = fakeOllama();
    expect(await client.embed('nomic-embed-text', ['a', 'b'])).toHaveLength(2);
  });
  it('informa un error claro si Ollama no está disponible', async () => {
    const client = new OllamaClient('http://localhost:1', (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    await expect(client.list()).rejects.toThrow('OLLAMA_ORIGINS');
  });
});

describe('Auditoría de modelos instalados', () => {
  it('reconoce tamaño, embeddings y tareas compatibles', () => {
    expect(paramsBillions(model('x', 1, '494.03M'))).toBeCloseTo(0.494);
    expect(paramsBillions({ name: 'llama3.2:3b' })).toBe(3);
    expect(isEmbeddingModel(model('nomic-embed-text', 1, '137M', 'nomic-bert'))).toBe(true);
    expect(isEmbeddingModel(model('qwen3.5:4b', 1, '4B', 'qwen35'))).toBe(false);
  });
  it('no elimina por antigüedad: sugiere actualizar y explica por qué', () => {
    const { items, gaps } = auditModels({
      installed: [model('qwen2.5:7b', 4.7e9, '7.6B')],
      running: [],
      hardware: HW,
    });
    expect(items[0]!.decision).toBe('actualizar');
    expect(items[0]!.reasons.join(' ')).toContain('qwen3.5');
    expect(gaps.join(' ')).toContain('embeddings');
  });
  it('propone sustituir modelos demasiado pequeños o que no caben en la RAM', () => {
    const { items } = auditModels({
      installed: [model('qwen2.5:0.5b', 400e6, '494M'), model('llama3.3:70b', 43e9, '70.6B', 'llama')],
      running: [],
      hardware: HW,
    });
    expect(items.map((i) => i.decision)).toEqual(['sustituir', 'sustituir']);
  });
  it('marca variantes duplicadas como desinstalación opcional, salvo la seleccionada', () => {
    const { items } = auditModels({
      installed: [
        model('qwen3.5:4b', 3.3e9, '4B', 'qwen35'),
        model('qwen3.5:4b-q8_0', 5e9, '4B', 'qwen35', 'Q8_0'),
      ],
      running: [],
      hardware: HW,
      selected: { conversacion: 'qwen3.5:4b' },
    });
    expect(items.find((i) => i.name === 'qwen3.5:4b')!.decision).toBe('conservar');
    expect(items.find((i) => i.name === 'qwen3.5:4b-q8_0')!.decision).toBe('desinstalar');
  });
});

describe('Perfiles y selección por función', () => {
  it('reutiliza lo instalado antes de sugerir descargas', () => {
    const plan = planProfile('equilibrado', [
      model('qwen2.5:7b', 4.7e9, '7.6B'),
      model('bge-m3', 1.2e9, '567M', 'bert'),
    ]);
    expect(plan.assignments).toEqual({
      conversacion: 'qwen2.5:7b',
      evaluacion: 'qwen2.5:7b',
      embeddings: 'bge-m3',
    });
    expect(plan.downloads).toEqual([]);
  });
  it('sugiere descargas del catálogo cuando falta una función', () => {
    const plan = planProfile('eficiente', []);
    expect(plan.downloads.map((d) => d.tag)).toEqual(['qwen3.5:2b', 'qwen3-embedding:0.6b']);
  });
  it('elige el perfil según el hardware informado', () => {
    expect(profileForHardware({ ...HW, ramGb: 8 })).toBe('eficiente');
    expect(profileForHardware(HW)).toBe('equilibrado');
    expect(profileForHardware({ ...HW, ramGb: 32 })).toBe('calidad');
  });
  it('cada modelo administrado por la app tiene un caché exclusivo', () => {
    const caches = MANAGED.map((m) => m.cache);
    expect(new Set(caches).size).toBe(caches.length);
    expect(MANAGED.filter((m) => m.kind === 'tts').length).toBeGreaterThanOrEqual(4);
    expect(formatBytes(4.7e9)).toBe('4,7 GB');
  });
});
