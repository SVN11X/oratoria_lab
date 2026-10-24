/** Mismos casos ficticios para comparar modelos ya instalados; no instala ni elimina nada. */
import { writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform } from 'node:os';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { readNdjson } from '../packages/model-manager/src/ndjson.ts';

export const CASES = [
  {
    id: 'metodologia',
    temperament: 'amable',
    level: 'experta',
    instruction: 'Pregunta por una alternativa al muestreo; mantén cercanía y rigor.',
  },
  {
    id: 'objecion',
    temperament: 'desafiante',
    level: 'intermedia',
    instruction:
      'El estudiante respondió: «Era la mejor metodología». Repregunta para obtener una justificación concreta.',
  },
  {
    id: 'limitacion',
    temperament: 'esceptico',
    level: 'avanzada',
    instruction:
      'El estudiante generaliza sus conclusiones a todos los colegios. Pregunta por el alcance de la muestra.',
  },
  {
    id: 'sintesis',
    temperament: 'serio',
    level: 'experta',
    instruction: 'Pide sintetizar el aporte y una limitación de la investigación en un minuto.',
  },
];
const SOURCE =
  '[S1] Caso íntegramente ficticio: investigación cualitativa con entrevistas a 12 docentes de dos colegios, elegidos por conveniencia. El propósito fue describir experiencias, sin medir causalidad. [S2] Limitación declarada: no se incluyeron colegios rurales.';

export async function runBenchmark({
  baseUrl = 'http://localhost:11434',
  models,
  output,
  fetcher = fetch,
  repetitions = 1,
}) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20)
    throw new Error('El número de repeticiones debe estar entre 1 y 20.');
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Usa una dirección HTTP de este equipo (localhost o loopback).');
  const call = async (path, body) => {
    const signal = globalThis.AbortSignal.timeout(180000);
    const started = performance.now();
    const r = await fetcher(new URL(path, url), {
      method: body ? 'POST' : 'GET',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal,
    });
    if (!r.ok) throw new Error(`Ollama respondió ${r.status} en ${path}.`);
    if (path === '/api/chat' && body?.stream && r.body) {
      let content = '',
        last = {},
        done = false,
        firstTokenMs = null;
      await readNdjson(
        r.body,
        (record) => {
          if (record.error) throw new Error('Ollama interrumpió la generación.');
          const delta = record.message?.content ?? '';
          if (delta) {
            firstTokenMs ??= performance.now() - started;
            content += delta;
          }
          if (record.done) {
            done = true;
            last = record;
          }
        },
        signal,
      );
      if (!done) throw new Error('La respuesta se cortó antes del registro final.');
      return { ...last, message: { content }, firstTokenMs };
    }
    return r.json();
  };
  const inventory = await call('/api/tags');
  const installed = new Map((inventory.models ?? []).map((m) => [m.name, m]));
  const names = models.map((n) => (installed.has(n) ? n : installed.has(`${n}:latest`) ? `${n}:latest` : ''));
  if (names.some((n) => !n))
    throw new Error('Todos los modelos deben estar instalados. El benchmark no descarga modelos.');
  const results = [];
  for (const name of names) {
    const details = await call('/api/show', { model: name });
    if (details.capabilities?.includes('embedding') && !details.capabilities.includes('completion'))
      throw new Error(`${name} es un modelo de embeddings, no conversacional.`);
    for (let repetition = 1; repetition <= repetitions; repetition++)
      for (const c of CASES) {
        const messages = [
          {
            role: 'system',
            content: `Eres un profesor ficticio de temperamento ${c.temperament} y dificultad ${c.level}, parámetros independientes. Respeta al estudiante. Formula una sola pregunta en español sobre las fuentes dadas. No inventes referencias. JSON: {"pregunta":"...","fuentes":["S1"]}.`,
          },
          { role: 'user', content: `${SOURCE}\n${c.instruction}` },
        ];
        const start = performance.now();
        try {
          const r = await call('/api/chat', {
            model: name,
            messages,
            stream: true,
            format: 'json',
            ...(details.capabilities?.includes('thinking') ? { think: false } : {}),
            keep_alive: '2m',
            options: { temperature: 0.2, seed: 23, num_ctx: 4096, num_predict: 160 },
          });
          const text = r.message?.content ?? '';
          let value = null;
          try {
            value = JSON.parse(text);
          } catch {
            /* formato no válido */
          }
          results.push({
            model: name,
            digest: installed.get(name).digest,
            case: c.id,
            repetition,
            milliseconds: Math.round(performance.now() - start),
            loadMilliseconds: Number.isFinite(r.load_duration) ? Math.round(r.load_duration / 1e6) : null,
            firstTokenMilliseconds: r.firstTokenMs === null ? null : Math.round(r.firstTokenMs),
            promptMilliseconds: Number.isFinite(r.prompt_eval_duration)
              ? Math.round(r.prompt_eval_duration / 1e6)
              : null,
            tokensPerSecond: r.eval_duration > 0 ? r.eval_count / (r.eval_duration / 1e9) : null,
            jsonQuestion: typeof value?.pregunta === 'string' && value.pregunta.length > 8,
            sourceIdsValid:
              Array.isArray(value?.fuentes) &&
              value.fuentes.length > 0 &&
              value.fuentes.every((id) => ['S1', 'S2'].includes(id)),
            answer: text,
            humanReview: {
              pertinencia: null,
              rigor: null,
              temperamento: null,
              dificultad: null,
              utilidad: null,
            },
          });
        } catch (error) {
          results.push({ model: name, case: c.id, error: error.message });
        }
      }
  }
  const report = {
    protocol: 'oratoria-local-2-streaming',
    parameters: { temperature: 0.2, seed: 23, num_ctx: 4096, num_predict: 160, stream: true, repetitions },
    at: new Date().toISOString(),
    runtime: process.version,
    system: { os: platform(), logicalCores: cpus().length, ramBytes: totalmem() },
    scope:
      'Prueba de latencia, formato y referencias a fuentes ficticias. Las casillas de calidad requieren revisión humana. No compara por sí sola con plataformas comerciales.',
    cases: CASES,
    source: SOURCE,
    results,
  };
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const get = (key) => args[args.indexOf(key) + 1];
  if (!args.includes('--models')) {
    console.log(
      'node scripts/benchmark-local.mjs --models modelo:tag,otro:tag --output benchmark-local.json [--url http://localhost:11434]',
    );
    process.exitCode = 1;
  } else {
    try {
      const r = await runBenchmark({
        models: get('--models')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        baseUrl: args.includes('--url') ? get('--url') : undefined,
        output: args.includes('--output') ? get('--output') : 'benchmark-local.json',
        repetitions: args.includes('--repeat') ? Number(get('--repeat')) : 1,
      });
      console.log(
        JSON.stringify({
          cases: r.results.length,
          errors: r.results.filter((r) => r.error).length,
          output: args.includes('--output') ? get('--output') : 'benchmark-local.json',
        }),
      );
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
  }
}
