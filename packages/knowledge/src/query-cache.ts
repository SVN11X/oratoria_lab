/** Caché acotada y reintento tras desconexión. Coalesce consultas idénticas, sin almacenar documentos. */
export class QueryVectorCache {
  private values = new Map<string, number[]>();
  private pending = new Map<string, Promise<number[] | null>>();
  private retryAt = 0;
  degraded = false;
  constructor(
    private embed: (query: string) => Promise<number[]>,
    private clock: () => number = () => Date.now(),
    private cooldownMs = 5000,
  ) {}
  async get(query: string): Promise<number[] | null> {
    const cached = this.values.get(query);
    if (cached) return cached;
    if (this.clock() < this.retryAt) return null;
    if (this.pending.has(query)) return this.pending.get(query)!;
    const job = this.embed(query)
      .then((vector) => {
        if (!vector.length || vector.some((n) => !Number.isFinite(n))) throw new Error('Vector inválido.');
        this.values.set(query, vector);
        if (this.values.size > 64) this.values.delete(this.values.keys().next().value!);
        this.degraded = false;
        this.retryAt = 0;
        return vector;
      })
      .catch(() => {
        this.degraded = true;
        this.retryAt = this.clock() + this.cooldownMs;
        return null;
      })
      .finally(() => this.pending.delete(query));
    this.pending.set(query, job);
    return job;
  }
}
