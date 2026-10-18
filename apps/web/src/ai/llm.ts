import { OllamaClient, OllamaError } from '@oratoria/model-manager';
import type { LlmPort } from '@oratoria/conversation';
import { useAi, type AiSettings, type Bench } from './settings';

type Message = { role: 'system' | 'user' | 'assistant'; content: string };
const thinkingCache = new Map<string, boolean>();

export const ollama = (s: Pick<AiSettings, 'ollamaUrl'> = useAi.getState()) => new OllamaClient(s.ollamaUrl);

/** Adaptador hacia Ollama con su API nativa: salidas JSON con esquema y sin «razonamiento» visible. */
export class OllamaPort implements LlmPort {
  constructor(
    readonly model: string,
    private client = ollama(),
  ) {}
  private async thinks() {
    if (!thinkingCache.has(this.model)) {
      const caps = await this.client
        .show(this.model)
        .then((s) => s.capabilities ?? [])
        .catch(() => [] as string[]);
      thinkingCache.set(this.model, caps.includes('thinking'));
    }
    return thinkingCache.get(this.model)!;
  }
  async complete(messages: Message[], o: Parameters<LlmPort['complete']>[1]) {
    const think = (await this.thinks()) ? false : undefined;
    const r = await this.client.chat({
      model: this.model,
      messages,
      format: o.json ? (o.schema ?? 'json') : undefined,
      think,
      temperature: o.temperature,
      signal: o.signal,
      timeoutMs: o.timeoutMs,
      numCtx: 8192,
    });
    useAi.getState().touch(this.model);
    return r.content;
  }
}

/** Adaptador para servicios con API compatible con OpenAI (LM Studio, llama.cpp, vLLM y otros). */
export class OpenAiPort implements LlmPort {
  constructor(
    readonly model: string,
    private baseUrl: string,
    private apiKey: string,
  ) {}
  async complete(messages: Message[], o: Parameters<LlmPort['complete']>[1]) {
    const url = `${this.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
    const timeout = AbortSignal.timeout(o.timeoutMs ?? 60000);
    const signal = o.signal && 'any' in AbortSignal ? AbortSignal.any([o.signal, timeout]) : timeout;
    const send = (json: boolean) =>
      fetch(url, {
        method: 'POST',
        signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey.trim() ? { Authorization: `Bearer ${this.apiKey.trim()}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: o.temperature ?? 0.6,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
    let response: Response;
    try {
      response = await send(o.json);
      if (response.status === 400 && o.json) response = await send(false);
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError'))
        throw new Error('El modelo tardó demasiado en responder.');
      throw new Error(
        'No se pudo conectar con el servicio. Revisa la dirección y que acepte solicitudes desde esta página.',
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'El servicio rechazó la clave.'
          : response.status === 404
            ? 'No se encontró el modelo o la dirección.'
            : `El servicio respondió ${response.status}: ${body.slice(0, 160)}`,
      );
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('El servicio respondió sin texto.');
    useAi.getState().touch(this.model);
    return text;
  }
}

/** Modelo para una función, o null si la IA está desactivada o sin asignar. */
export function llmFor(
  role: 'conversacion' | 'evaluacion',
  s: AiSettings = useAi.getState(),
): LlmPort | null {
  if (!s.useLlm) return null;
  if (s.provider === 'openai')
    return s.openai.model.trim()
      ? new OpenAiPort(s.openai.model.trim(), s.openai.baseUrl, s.openai.apiKey)
      : null;
  const model = (
    role === 'evaluacion' ? s.assign.evaluacion || s.assign.conversacion : s.assign.conversacion
  ).trim();
  return model ? new OllamaPort(model, ollama(s)) : null;
}

const BENCH_PROMPT: Message[] = [
  {
    role: 'system',
    content: 'Eres un profesor que evalúa una defensa de tesis. Responde solo con JSON válido.',
  },
  {
    role: 'user',
    content:
      'El estudiante dijo: «Elegimos el algoritmo porque era el mejor». Formula una repregunta exigente en español, de máximo 25 palabras. Formato: {"repregunta":"..."}',
  },
];
const SPANISH = /\b(el|la|los|las|que|por|una|su|qué|cómo|usted|algoritmo)\b/i;

/**
 * Prueba breve y reproducible: el mismo prompt en español con salida JSON. Mide la latencia total,
 * la carga y los tokens por segundo que informa Ollama. No es un benchmark de calidad general.
 */
export async function benchmark(model: string, signal?: AbortSignal): Promise<Bench> {
  const client = ollama();
  const started = performance.now();
  const thinks = await client
    .show(model)
    .then((s) => (s.capabilities ?? []).includes('thinking'))
    .catch(() => false);
  try {
    const r = await client.chat({
      model,
      messages: BENCH_PROMPT,
      format: 'json',
      think: thinks ? false : undefined,
      temperature: 0.2,
      signal,
      timeoutMs: 180000,
    });
    const totalSec = (performance.now() - started) / 1000;
    let jsonOk = false,
      text = '';
    try {
      const v = JSON.parse(r.content.replace(/<think>[\s\S]*?<\/think>/g, '')) as { repregunta?: string };
      jsonOk = typeof v.repregunta === 'string' && v.repregunta.length > 8;
      text = v.repregunta ?? '';
    } catch {
      jsonOk = false;
    }
    const s = r.stats;
    const result: Bench = {
      at: new Date().toISOString(),
      totalSec: Math.round(totalSec * 10) / 10,
      loadSec: s.load_duration ? Math.round((s.load_duration / 1e9) * 10) / 10 : null,
      tokensPerSec:
        s.eval_count && s.eval_duration
          ? Math.round((s.eval_count / (s.eval_duration / 1e9)) * 10) / 10
          : null,
      jsonOk,
      spanishOk: SPANISH.test(text),
      note: text.slice(0, 200),
    };
    useAi.setState((st) => ({ bench: { ...st.bench, [model]: result } }));
    return result;
  } catch (e) {
    throw e instanceof OllamaError ? e : new Error(e instanceof Error ? e.message : 'La prueba falló.');
  }
}
