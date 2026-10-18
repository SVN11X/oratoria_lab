/**
 * Cliente de la API HTTP oficial de Ollama (https://github.com/ollama/ollama/blob/main/docs/api.md).
 * Solo usa endpoints documentados: no toca archivos internos de Ollama.
 */
export type OllamaModel = {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format?: string;
    family?: string;
    families?: string[] | null;
    parameter_size?: string;
    quantization_level?: string;
    parent_model?: string;
  };
};
export type OllamaRunning = OllamaModel & {
  size_vram?: number;
  expires_at?: string;
  context_length?: number;
};
export type OllamaShow = {
  license?: string;
  modelfile?: string;
  parameters?: string;
  template?: string;
  details?: OllamaModel['details'];
  model_info?: Record<string, unknown>;
  capabilities?: string[];
  modified_at?: string;
};
export type PullProgress = { status: string; digest?: string; total?: number; completed?: number };
export type ChatStats = {
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
};

export class OllamaError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

export class OllamaClient {
  constructor(
    readonly baseUrl = DEFAULT_OLLAMA_URL,
    private fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}
  private url(path: string) {
    return `${this.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}${path}`;
  }
  private async request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
    const timeout = AbortSignal.timeout(init.timeoutMs ?? 15000);
    const signal =
      init.signal && 'any' in AbortSignal
        ? AbortSignal.any([init.signal, timeout])
        : (init.signal ?? timeout);
    let response: Response;
    try {
      response = await this.fetcher(this.url(path), {
        ...init,
        signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError' && init.signal?.aborted) throw error;
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError'))
        throw new OllamaError('Ollama tardó demasiado en responder.');
      throw new OllamaError(
        'No se pudo conectar con Ollama. Revisa que esté abierto y, si usas la web publicada, que OLLAMA_ORIGINS incluya este sitio.',
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      let message = body;
      try {
        message = (JSON.parse(body) as { error?: string }).error ?? body;
      } catch {
        /* cuerpo no JSON */
      }
      throw new OllamaError(
        response.status === 404
          ? `Ollama no encontró el modelo o la ruta (${message.slice(0, 160)}).`
          : `Ollama respondió ${response.status}: ${message.slice(0, 200)}`,
        response.status,
      );
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
  async version(): Promise<string> {
    return (await this.request<{ version: string }>('/api/version', { timeoutMs: 4000 })).version;
  }
  async list(): Promise<OllamaModel[]> {
    return (await this.request<{ models?: OllamaModel[] }>('/api/tags')).models ?? [];
  }
  async running(): Promise<OllamaRunning[]> {
    return (await this.request<{ models?: OllamaRunning[] }>('/api/ps')).models ?? [];
  }
  async show(model: string): Promise<OllamaShow> {
    return this.request<OllamaShow>('/api/show', { method: 'POST', body: JSON.stringify({ model }) });
  }
  /** Descarga con progreso. Cancelar detiene la descarga; Ollama conserva lo descargado para reanudar. */
  async pull(model: string, onProgress: (p: PullProgress) => void, signal?: AbortSignal): Promise<void> {
    let response: Response;
    try {
      response = await this.fetcher(this.url('/api/pull'), {
        method: 'POST',
        body: JSON.stringify({ model, stream: true }),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Descarga cancelada.', 'AbortError');
      throw new OllamaError(
        `No se pudo iniciar la descarga: ${error instanceof Error ? error.message : 'error de red'}.`,
      );
    }
    if (!response.ok || !response.body)
      throw new OllamaError(`Ollama rechazó la descarga (${response.status}).`, response.status);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '',
      success = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const data = JSON.parse(line) as PullProgress & { error?: string };
          if (data.error) throw new OllamaError(`Ollama: ${data.error}`);
          if (data.status === 'success') success = true;
          onProgress(data);
        }
      }
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Descarga cancelada.', 'AbortError');
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (!success) throw new OllamaError('La descarga terminó sin confirmación de Ollama.');
  }
  /** Eliminación real mediante la API oficial (DELETE /api/delete). */
  async remove(model: string): Promise<void> {
    await this.request('/api/delete', { method: 'DELETE', body: JSON.stringify({ model }) });
  }
  /** Descarga el modelo de la memoria sin borrarlo del disco (keep_alive = 0). */
  async unload(model: string): Promise<void> {
    await this.request('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ model, keep_alive: 0 }),
      timeoutMs: 20000,
    });
  }
  async chat(input: {
    model: string;
    messages: { role: string; content: string }[];
    format?: 'json' | Record<string, unknown>;
    temperature?: number;
    think?: boolean;
    keepAlive?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    numCtx?: number;
  }): Promise<{ content: string; stats: ChatStats }> {
    const r = await this.request<{ message?: { content?: string; thinking?: string } } & ChatStats>(
      '/api/chat',
      {
        method: 'POST',
        signal: input.signal,
        timeoutMs: input.timeoutMs ?? 60000,
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          stream: false,
          ...(input.format ? { format: input.format } : {}),
          ...(input.think !== undefined ? { think: input.think } : {}),
          keep_alive: input.keepAlive ?? '10m',
          options: {
            temperature: input.temperature ?? 0.6,
            ...(input.numCtx ? { num_ctx: input.numCtx } : {}),
          },
        }),
      },
    );
    const content = r.message?.content ?? '';
    if (!content.trim()) throw new OllamaError('El modelo respondió sin texto.');
    const {
      total_duration,
      load_duration,
      prompt_eval_count,
      prompt_eval_duration,
      eval_count,
      eval_duration,
    } = r;
    return {
      content,
      stats: {
        total_duration,
        load_duration,
        prompt_eval_count,
        prompt_eval_duration,
        eval_count,
        eval_duration,
      },
    };
  }
  async embed(model: string, input: string[], signal?: AbortSignal): Promise<number[][]> {
    const r = await this.request<{ embeddings?: number[][] }>('/api/embed', {
      method: 'POST',
      signal,
      timeoutMs: 120000,
      body: JSON.stringify({ model, input, keep_alive: '10m' }),
    });
    if (!r.embeddings?.length || r.embeddings.length !== input.length)
      throw new OllamaError('Ollama no devolvió los vectores esperados.');
    return r.embeddings;
  }
}

/** Tamaño de parámetros en miles de millones a partir de «7.6B», «494M» o del nombre. */
export function paramsBillions(m: Pick<OllamaModel, 'name' | 'details'>): number | null {
  const raw = m.details?.parameter_size ?? /[:\-_](\d+(?:\.\d+)?)([bm])\b/i.exec(m.name)?.slice(1).join('');
  if (!raw) return null;
  const x = /^(\d+(?:\.\d+)?)\s*([BMK])?/i.exec(raw);
  if (!x) return null;
  const n = Number(x[1]);
  const unit = (x[2] ?? 'B').toUpperCase();
  return unit === 'M' ? n / 1000 : unit === 'K' ? n / 1e6 : n;
}
export function isEmbeddingModel(m: Pick<OllamaModel, 'name' | 'details'>, capabilities?: string[]): boolean {
  if (capabilities?.includes('embedding')) return true;
  if (capabilities?.includes('completion')) return false;
  const fam = [m.details?.family ?? '', ...(m.details?.families ?? [])].join(' ').toLowerCase();
  return (
    /embed|bge|minilm|e5-|gte|arctic-embed|granite-embedding/.test(m.name.toLowerCase()) ||
    /bert|nomic-bert/.test(fam)
  );
}
