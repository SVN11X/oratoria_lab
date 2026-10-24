export const TIMING_LABELS = {
  captureMs: 'Captura de respuesta',
  transcriptionMs: 'Transcripción final',
  ragMs: 'Recuperación documental',
  contextMs: 'Preparación de contexto',
  generationMs: 'Generación (cliente)',
  queueMs: 'Espera de inferencia',
  loadMs: 'Carga del modelo (Ollama)',
  promptMs: 'Procesamiento del prompt (Ollama)',
  firstTokenMs: 'Primer token (cliente)',
  synthesisMs: 'Síntesis de voz',
  firstAudioMs: 'Hasta el primer audio',
  responseMs: 'Hasta completar la intervención',
  tokensPerSecond: 'Tokens por segundo (Ollama)',
} as const;
export type TimingKey = keyof typeof TIMING_LABELS;
export type DiagnosticTurn = {
  id: string;
  model: string | null;
  provider: 'ollama' | 'openai' | 'reglas';
  timings: Partial<Record<TimingKey, number>>;
};
export type DiagnosticReport = {
  version: 1;
  turns: DiagnosticTurn[];
  percentiles: Partial<Record<TimingKey, { n: number; p50: number; p95: number }>>;
};

/** Solo admite métricas conocidas; no recibe documentos, preguntas ni transcripciones. */
export class TurnDiagnostics {
  private rows: DiagnosticTurn[] = [];
  private started = 0;
  constructor(private clock: () => number = () => performance.now()) {}
  begin(model: string | null, provider: DiagnosticTurn['provider']) {
    this.started = this.clock();
    const row: DiagnosticTurn = { id: `T${this.rows.length + 1}`, model, provider, timings: {} };
    this.rows.push(row);
    return row.id;
  }
  get currentId() {
    return this.rows.at(-1)?.id ?? null;
  }
  add(key: TimingKey, value: number, accumulate = false) {
    const row = this.rows.at(-1);
    if (!row || !(key in TIMING_LABELS) || !Number.isFinite(value) || value < 0) return;
    row.timings[key] = (accumulate ? (row.timings[key] ?? 0) : 0) + value;
  }
  mark(key: TimingKey, once = false) {
    if (once && this.rows.at(-1)?.timings[key] !== undefined) return;
    this.add(key, this.clock() - this.started);
  }
  export(): DiagnosticReport {
    // Copia por lista permitida: también protege frente a propiedades añadidas por consumidores.
    const turns = this.rows.map((r) => ({
      id: r.id,
      model: r.model,
      provider: r.provider,
      timings: Object.fromEntries(
        Object.keys(TIMING_LABELS).flatMap((key) => {
          const n = r.timings[key as TimingKey];
          return n !== undefined && Number.isFinite(n) ? [[key, Math.round(n * 100) / 100]] : [];
        }),
      ),
    }));
    const percentiles: DiagnosticReport['percentiles'] = {};
    for (const key of Object.keys(TIMING_LABELS) as TimingKey[]) {
      const values = turns
        .flatMap((r) => (r.timings[key] === undefined ? [] : [r.timings[key]!]))
        .sort((a, b) => a - b);
      if (values.length)
        percentiles[key] = {
          n: values.length,
          p50: values[Math.max(0, Math.ceil(values.length * 0.5) - 1)]!,
          p95: values[Math.max(0, Math.ceil(values.length * 0.95) - 1)]!,
        };
    }
    return { version: 1, turns, percentiles };
  }
}
