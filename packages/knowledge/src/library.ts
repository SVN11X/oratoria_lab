import type { Block, Extracted } from './extract';
import { jaccard, numericClaims, tokenize } from './text';
import { keyTerms } from '@oratoria/defense';
import type { AcademicProfile } from './preparation';

export type DocKind =
  | 'tesis'
  | 'presentacion'
  | 'bibliografia'
  | 'articulo'
  | 'anexo'
  | 'notas'
  | 'instrucciones'
  | 'cv'
  | 'cargo'
  | 'otro';
export const DOC_KIND_TEXT: Record<DocKind, string> = {
  tesis: 'Tesis o informe principal',
  presentacion: 'Presentación',
  bibliografia: 'Bibliografía',
  articulo: 'Artículo científico',
  anexo: 'Anexo',
  notas: 'Notas',
  instrucciones: 'Instrucciones de la institución',
  cv: 'Currículum',
  cargo: 'Descripción del cargo',
  otro: 'Otro documento',
};
export type SourceDoc = {
  id: string;
  name: string;
  kind: DocKind;
  format: Extracted['format'];
  bytes: number;
  sha256: string;
  addedAt: string;
  pages: number | null;
  slides: number | null;
  chars: number;
  chunks: number;
  outline: { heading: string; level: number; location: string }[];
  warnings: string[];
  /** Preparación extractiva derivada; no sustituye ni modifica el archivo original. */
  academicProfile?: AcademicProfile;
};
export type Chunk = {
  id: string;
  docId: string;
  docName: string;
  order: number;
  text: string;
  location: string;
  page: number | null;
  slide: number | null;
  section: string | null;
};
export type Hit = Chunk & { excerpt: string; chunkId: string; score: number };

const location = (b: Pick<Block, 'page' | 'slide' | 'heading'>, format: Extracted['format']) => {
  const where = b.page ? `pág. ${b.page}` : b.slide ? `diap. ${b.slide}` : '';
  const sec = b.heading ? b.heading.slice(0, 80) : '';
  if (where && sec) return `${where} · ${sec}`;
  return (
    where ||
    (sec ? `§ ${sec}` : format === 'txt' || format === 'md' || format === 'tex' ? 'texto' : 'documento')
  );
};
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?;:])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9«"(])/u).filter(Boolean);
}
function boundedParts(text: string, max: number): string[] {
  const out: string[] = [];
  while (text.length > max) {
    let end = text.lastIndexOf(' ', max);
    if (end < max / 2) end = max;
    // No dividir un par sustituto de Unicode.
    if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--;
    out.push(text.slice(0, end));
    text = text.slice(end).trimStart();
  }
  if (text) out.push(text);
  return out;
}
/**
 * Segmenta respetando la estructura: un fragmento no cruza de una página, diapositiva o sección
 * a otra. Los párrafos largos se dividen por oraciones; se repite una oración entre fragmentos
 * consecutivos para no perder contexto. No se descarta texto.
 */
export function segment(doc: Pick<SourceDoc, 'id' | 'name'>, extracted: Extracted, target = 1000): Chunk[] {
  const chunks: Chunk[] = [];
  let buffer: string[] = [],
    size = 0,
    key = '',
    meta: Pick<Block, 'page' | 'slide' | 'heading'> = {};
  const push = () => {
    const text = buffer.join('\n').trim();
    if (text)
      chunks.push({
        id: `${doc.id}:${chunks.length}`,
        docId: doc.id,
        docName: doc.name,
        order: chunks.length,
        text,
        location: location(meta, extracted.format),
        page: meta.page ?? null,
        slide: meta.slide ?? null,
        section: meta.heading ?? null,
      });
    const tail = buffer.length ? sentences(buffer[buffer.length - 1]!).slice(-1)[0] : undefined;
    buffer = tail && tail.length < 300 && text.length > target * 0.6 ? [tail] : [];
    size = buffer.reduce((n, b) => n + b.length, 0);
  };
  for (const b of extracted.blocks) {
    const k = `${b.page ?? ''}|${b.slide ?? ''}|${b.heading ?? ''}`;
    if (k !== key) {
      if (buffer.length) {
        push();
        buffer = [];
        size = 0;
      }
      key = k;
      meta = { page: b.page, slide: b.slide, heading: b.heading };
    }
    if (b.isHeading) {
      buffer.push(b.text);
      size += b.text.length;
      continue;
    }
    const text = b.notes ? `Notas del orador: ${b.text}` : b.text;
    if (text.length > target * 1.4) {
      for (const s of sentences(text).flatMap((s) => boundedParts(s, Math.max(200, target)))) {
        if (size + s.length > target && size > target * 0.4) push();
        buffer.push(s);
        size += s.length;
      }
    } else {
      if (size + text.length > target * 1.25 && size > target * 0.3) push();
      buffer.push(text);
      size += text.length;
    }
  }
  if (buffer.length) push();
  // Dos fragmentos iguales también pueden ser contenido legítimo (tablas o cadenas repetidas).
  // El solapamiento se controla en push; nunca se elimina texto por igualdad de sus bytes.
  return chunks.map((c, i) => ({ ...c, order: i, id: `${doc.id}:${i}` }));
}
export function outlineOf(extracted: Extracted) {
  return extracted.blocks
    .filter((b) => b.isHeading)
    .map((b) => ({
      heading: b.heading!,
      level: b.level ?? 1,
      location: b.page ? `pág. ${b.page}` : b.slide ? `diap. ${b.slide}` : '',
    }))
    .slice(0, 400);
}

/** Índice léxico BM25 con normalización para español. */
export class Bm25 {
  private postings = new Map<string, Map<number, number>>();
  private lengths: number[] = [];
  private avg = 0;
  constructor(
    readonly items: { text: string }[],
    private k1 = 1.4,
    private b = 0.72,
  ) {
    items.forEach((it, i) => {
      const toks = tokenize(it.text);
      this.lengths[i] = toks.length;
      for (const t of toks) {
        const p = this.postings.get(t) ?? new Map<number, number>();
        p.set(i, (p.get(i) ?? 0) + 1);
        this.postings.set(t, p);
      }
    });
    this.avg = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, this.lengths.length);
  }
  search(query: string, k = 10, allowed?: (index: number) => boolean): { index: number; score: number }[] {
    const N = this.items.length;
    const scores = new Map<number, number>();
    for (const t of new Set(tokenize(query))) {
      const p = this.postings.get(t);
      if (!p) continue;
      const idf = Math.log(1 + (N - p.size + 0.5) / (p.size + 0.5));
      for (const [i, tf] of p) {
        if (allowed && !allowed(i)) continue;
        const len = this.lengths[i] ?? 0;
        const s =
          (idf * tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + (this.b * len) / (this.avg || 1)));
        scores.set(i, (scores.get(i) ?? 0) + s);
      }
    }
    return [...scores]
      .map(([index, score]) => ({ index, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return 0;
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export type SearchOptions = {
  k?: number;
  /** Vector de la consulta, si hay embeddings del mismo modelo. */
  queryVector?: number[] | null;
  /** Limitar a documentos concretos. */
  docIds?: string[];
  sections?: string[];
  /** 0 = solo relevancia; 1 = máxima diversidad. */
  diversity?: number;
};
/**
 * Recuperación híbrida: BM25 + similitud de embeddings (si existen), fusionadas con
 * Reciprocal Rank Fusion y diversificadas con MMR para no devolver fragmentos casi iguales.
 */
export class KnowledgeIndex {
  private bm25: Bm25;
  private tokens: Set<string>[];
  constructor(
    readonly chunks: Chunk[],
    readonly vectors: Map<string, Float32Array> | null = null,
  ) {
    this.bm25 = new Bm25(chunks);
    this.tokens = chunks.map((c) => new Set(tokenize(c.text)));
  }
  get size() {
    return this.chunks.length;
  }
  search(query: string, options: SearchOptions = {}): Hit[] {
    const k = options.k ?? 5;
    if (!this.chunks.length || !query.trim()) return [];
    const allowed = options.docIds ? new Set(options.docIds) : null;
    const sections = options.sections ? new Set(options.sections) : null;
    const ok = (i: number) =>
      (!allowed || allowed.has(this.chunks[i]!.docId)) &&
      (!sections || sections.has(this.chunks[i]!.section ?? ''));
    // Filtrar antes del top-k evita perder una sección detrás de 40 resultados de otros documentos.
    const lexical = this.bm25.search(query, 40, ok);
    const fused = new Map<number, number>();
    lexical.forEach((h, rank) => fused.set(h.index, (fused.get(h.index) ?? 0) + 1 / (60 + rank)));
    if (options.queryVector && this.vectors?.size) {
      const dense = this.chunks
        .map((c, i) => ({
          i,
          s: this.vectors!.has(c.id) && ok(i) ? cosine(options.queryVector!, this.vectors!.get(c.id)!) : -1,
        }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 40);
      dense.forEach((h, rank) => fused.set(h.i, (fused.get(h.i) ?? 0) + 1 / (60 + rank)));
    }
    const ranked = [...fused].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return [];
    const lambda = 1 - (options.diversity ?? 0.3);
    const chosen: { i: number; s: number }[] = [];
    const pool = ranked.slice(0, 30);
    const top = pool[0]![1];
    while (chosen.length < k && pool.length) {
      let best = 0,
        bestScore = -Infinity;
      pool.forEach(([i, s], idx) => {
        const red = chosen.length
          ? Math.max(...chosen.map((c) => jaccard(this.tokens[i]!, this.tokens[c.i]!)))
          : 0;
        const mmr = lambda * (s / top) - (1 - lambda) * red;
        if (mmr > bestScore) {
          bestScore = mmr;
          best = idx;
        }
      });
      const [i, s] = pool.splice(best, 1)[0]!;
      chosen.push({ i, s });
    }
    return chosen.map(({ i, s }) => {
      const c = this.chunks[i]!;
      return {
        ...c,
        chunkId: c.id,
        excerpt: c.text.slice(0, 240),
        score: Math.round((s / top) * 1000) / 1000,
      };
    });
  }
}

export type CompareFinding = {
  kind: 'cobertura' | 'cifra_ausente' | 'cifra_distinta' | 'concepto_ausente' | 'sin_respaldo' | 'secuencia';
  text: string;
  slide?: number;
  location?: string;
};
/**
 * Compara una presentación con el documento principal. Son reglas explicables: coincidencia de
 * términos por sección, cifras con unidad y conceptos frecuentes. Señalan puntos a revisar; no
 * prueban que algo esté mal.
 */
export function comparePresentation(
  doc: Chunk[],
  slides: Chunk[],
): { findings: CompareFinding[]; coverage: { section: string; slide: number | null; score: number }[] } {
  const findings: CompareFinding[] = [];
  const docText = doc.map((c) => c.text).join('\n');
  const bySlide = new Map<number, Chunk[]>();
  for (const s of slides) if (s.slide) bySlide.set(s.slide, [...(bySlide.get(s.slide) ?? []), s]);
  const slideTexts = [...bySlide].map(([n, cs]) => ({
    n,
    text: cs.map((c) => c.text).join('\n'),
    toks: new Set(tokenize(cs.map((c) => c.text).join(' '))),
  }));
  // Cobertura por sección principal del documento.
  const sections = new Map<string, string[]>();
  for (const c of doc) {
    const sec = c.section ?? 'Sin sección';
    sections.set(sec, [...(sections.get(sec) ?? []), c.text]);
  }
  const coverage = [...sections]
    .filter(([, texts]) => texts.join(' ').length > 400)
    .map(([section, texts]) => {
      const toks = new Set(tokenize(texts.join(' ')));
      let best = { n: null as number | null, s: 0 };
      for (const st of slideTexts) {
        let hit = 0;
        for (const t of st.toks) if (toks.has(t)) hit++;
        const s = st.toks.size ? hit / st.toks.size : 0;
        if (s > best.s) best = { n: st.n, s };
      }
      return { section, slide: best.s >= 0.25 ? best.n : null, score: Math.round(best.s * 100) / 100 };
    });
  for (const c of coverage.filter(
    (x) =>
      x.slide === null &&
      !/^(sin secci|agradec|indice|índice|referencias|bibliograf|anexo|resumen|abstract)/i.test(x.section),
  ))
    findings.push({
      kind: 'cobertura',
      text: `La sección «${c.section}» del documento no aparece representada en ninguna diapositiva.`,
    });
  // Cifras.
  const docClaims = numericClaims(docText);
  for (const st of slideTexts) {
    for (const s of numericClaims(st.text)) {
      const same = docClaims.filter((d) => d.unit === s.unit);
      if (!same.length) {
        findings.push({
          kind: 'cifra_ausente',
          text: `La cifra ${s.raw} de la diapositiva ${st.n} no aparece en el documento con esa unidad.`,
          slide: st.n,
        });
        continue;
      }
      const exact = same.some((d) => Math.abs(d.value - s.value) <= Math.max(0.01 * Math.abs(d.value), 0.01));
      if (exact) continue;
      const related = same.filter((d) => [...d.context].some((w) => s.context.has(w)));
      if (related.length)
        findings.push({
          kind: 'cifra_distinta',
          text: `La diapositiva ${st.n} muestra ${s.raw}, pero el documento indica ${related
            .map((r) => r.raw)
            .slice(0, 2)
            .join(' o ')} para el mismo asunto.`,
          slide: st.n,
        });
      else
        findings.push({
          kind: 'cifra_ausente',
          text: `La cifra ${s.raw} de la diapositiva ${st.n} no aparece en el documento.`,
          slide: st.n,
        });
    }
    if (st.text.split(/\s+/).length >= 15) {
      const docToks = new Set(tokenize(docText));
      let hit = 0;
      for (const t of st.toks) if (docToks.has(t)) hit++;
      if (st.toks.size && hit / st.toks.size < 0.35)
        findings.push({
          kind: 'sin_respaldo',
          text: `El contenido de la diapositiva ${st.n} tiene poca relación con el documento; revisa si está respaldado.`,
          slide: st.n,
        });
    }
  }
  // Conceptos esenciales del documento ausentes en la presentación.
  const all = slideTexts
    .map((s) => s.text)
    .join(' ')
    .toLowerCase();
  const missing = keyTerms(docText, 14).filter((t) => !all.includes(t.toLowerCase()));
  if (missing.length)
    findings.push({
      kind: 'concepto_ausente',
      text: `Conceptos frecuentes del documento que no aparecen en las diapositivas: ${missing.slice(0, 8).join(', ')}.`,
    });
  // Secuencia: orden de las secciones del documento según la diapositiva que las representa.
  const seq = coverage.filter((c) => c.slide !== null).map((c) => c.slide!);
  let inversions = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i]! < seq[i - 1]!) inversions++;
  if (seq.length >= 4 && inversions >= Math.max(2, seq.length / 3))
    findings.push({
      kind: 'secuencia',
      text: `El orden de las diapositivas no sigue el orden del documento en ${inversions} puntos. Revisa si la secuencia es intencional.`,
    });
  return { findings, coverage };
}
