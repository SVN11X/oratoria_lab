import {
  DOC_KIND_TEXT,
  KnowledgeIndex,
  comparePresentation,
  extractFile,
  outlineOf,
  segment,
  sha256Hex,
  type Chunk,
  type DocKind,
  type PdfJs,
  type SourceDoc,
} from '@oratoria/knowledge';
import { libraryStore } from '@oratoria/storage';
import type { RetrievedChunk } from '@oratoria/conversation';
import { ollama } from '../ai/llm';
import { useAi } from '../ai/settings';

export { DOC_KIND_TEXT };
export type { DocKind, SourceDoc };
/** Tamaño máximo por archivo. Es un límite de memoria del navegador, no de caracteres. */
export const MAX_DOC_BYTES = 60 * 1024 * 1024;

let pdf: Promise<PdfJs> | null = null;
async function pdfjs(): Promise<PdfJs> {
  pdf ??= (async () => {
    // La variante legacy mantiene extracción en WebViews y navegadores sin Uint8Array.toHex.
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    lib.GlobalWorkerOptions.workerSrc = worker;
    return lib as unknown as PdfJs;
  })();
  return pdf;
}

export type ImportProgress = {
  phase: 'leyendo' | 'extrayendo' | 'segmentando' | 'guardando';
  detail: string;
};
export function guessKind(name: string): DocKind {
  const n = name.toLowerCase();
  if (/\.pptx$|present|diapositiv|slides/.test(n)) return 'presentacion';
  if (/biblio|referenc/.test(n)) return 'bibliografia';
  if (/anexo|apendice|apéndice/.test(n)) return 'anexo';
  if (/cv|curr[ií]cul/.test(n)) return 'cv';
  if (/cargo|oferta|job|descripci/.test(n)) return 'cargo';
  if (/instructivo|reglamento|instrucc|pauta|rubric/.test(n)) return 'instrucciones';
  if (/notas|apuntes/.test(n)) return 'notas';
  if (/tesis|memoria|informe|thesis/.test(n)) return 'tesis';
  return 'otro';
}
/** Importa un archivo: extrae su texto con ubicación, lo segmenta y lo guarda en este equipo. */
export async function importDocument(
  file: File,
  kind: DocKind,
  onProgress: (p: ImportProgress) => void,
): Promise<SourceDoc> {
  if (file.size > MAX_DOC_BYTES) throw new Error(`«${file.name}» supera ${MAX_DOC_BYTES / 1024 / 1024} MB.`);
  onProgress({ phase: 'leyendo', detail: file.name });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const existing = (await libraryStore.docs()).find((d) => d.sha256 === sha256) as SourceDoc | undefined;
  if (existing) return existing;
  onProgress({ phase: 'extrayendo', detail: file.name });
  const extracted = await extractFile(
    { name: file.name, type: file.type, bytes },
    {
      pdfjs: /\.pdf$/i.test(file.name) || file.type === 'application/pdf' ? await pdfjs() : undefined,
      onProgress: (p, t) => onProgress({ phase: 'extrayendo', detail: `página ${p} de ${t}` }),
    },
  );
  onProgress({ phase: 'segmentando', detail: `${extracted.blocks.length} bloques` });
  const id = crypto.randomUUID();
  const chunks = segment({ id, name: file.name }, extracted);
  const doc: SourceDoc = {
    id,
    name: file.name,
    kind,
    format: extracted.format,
    bytes: file.size,
    sha256,
    addedAt: new Date().toISOString(),
    pages: extracted.pages,
    slides: extracted.slides,
    chars: chunks.reduce((n, c) => n + c.text.length, 0),
    chunks: chunks.length,
    outline: outlineOf(extracted),
    warnings: extracted.warnings,
  };
  onProgress({ phase: 'guardando', detail: `${chunks.length} fragmentos` });
  await libraryStore.save(
    doc as unknown as Parameters<typeof libraryStore.save>[0],
    chunks as unknown as Parameters<typeof libraryStore.save>[1],
    file,
  );
  return doc;
}
export async function listDocuments(): Promise<SourceDoc[]> {
  return ((await libraryStore.docs()) as unknown as SourceDoc[]).sort((a, b) =>
    b.addedAt.localeCompare(a.addedAt),
  );
}
export const removeDocument = (id: string) => libraryStore.remove(id);
export const documentChunks = async (ids: string[]) => (await libraryStore.chunks(ids)) as unknown as Chunk[];

/** Calcula embeddings con el modelo asignado para los fragmentos que aún no los tienen. */
export async function embedDocuments(
  ids: string[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
) {
  const model = useAi.getState().assign.embeddings;
  if (!model) throw new Error('No hay un modelo de embeddings asignado.');
  const chunks = await documentChunks(ids);
  const have = await libraryStore.vectors(model, ids);
  const missing = chunks.filter((c) => !have.has(c.id));
  const client = ollama();
  for (let i = 0; i < missing.length; i += 16) {
    signal?.throwIfAborted();
    const batch = missing.slice(i, i + 16);
    const vectors = await client.embed(
      model,
      batch.map((c) => c.text),
      signal,
    );
    await libraryStore.saveVectors(
      batch.map((c, j) => ({ chunkId: c.id, docId: c.docId, model, vector: Float32Array.from(vectors[j]!) })),
    );
    onProgress(Math.min(missing.length, i + 16), missing.length);
  }
  useAi.getState().touch(model);
  return { embedded: missing.length, total: chunks.length };
}
export async function vectorCoverage(ids: string[]) {
  const model = useAi.getState().assign.embeddings;
  if (!model || !ids.length) return { model, have: 0, total: 0 };
  const [chunks, vectors] = await Promise.all([documentChunks(ids), libraryStore.vectors(model, ids)]);
  return { model, have: vectors.size, total: chunks.length };
}

/**
 * Recuperador para el motor conversacional: búsqueda léxica siempre, más embeddings si el modelo
 * asignado ya procesó los documentos. Si Ollama no responde, sigue con búsqueda léxica.
 */
export async function makeRetriever(
  ids: string[],
  focus?: { docId: string; slide: number } | null,
): Promise<{
  retrieve: (q: string, k: number) => Promise<RetrievedChunk[]>;
  index: KnowledgeIndex;
  dense: boolean;
} | null> {
  if (!ids.length) return null;
  const all = await documentChunks(ids);
  const focused = focus ? all.filter((c) => c.docId === focus.docId && c.slide === focus.slide) : [];
  const focusedIds = new Set(focused.map((c) => c.id));
  const chunks = focus
    ? all.filter((c) => focusedIds.has(c.id) || (c.docId !== focus.docId && c.slide === null))
    : all;
  if (!chunks.length) return null;
  const model = useAi.getState().assign.embeddings;
  const vectors = model && useAi.getState().useLlm ? await libraryStore.vectors(model, ids) : null;
  const dense = !!vectors && vectors.size > 0;
  const index = new KnowledgeIndex(chunks, dense ? vectors : null);
  const cache = new Map<string, number[]>();
  let failed = false;
  const retrieve = async (q: string, k: number) => {
    let queryVector: number[] | null = null;
    if (dense && !failed) {
      queryVector = cache.get(q) ?? null;
      if (!queryVector)
        try {
          queryVector = (await ollama().embed(model, [q]))[0] ?? null;
          if (queryVector) cache.set(q, queryVector);
        } catch {
          failed = true;
        }
    }
    const hits = index.search(q, { k, queryVector });
    const anchored = focused
      .slice(0, Math.min(2, k))
      .map((c) => ({ ...c, chunkId: c.id, excerpt: c.text.slice(0, 240), score: 1 }));
    return [...anchored, ...hits.filter((h) => !anchored.some((a) => a.id === h.id))]
      .slice(0, k)
      .map((h) => ({
        docId: h.docId,
        docName: h.docName,
        chunkId: h.chunkId,
        location: h.location,
        excerpt: h.excerpt,
        text: h.text,
        score: h.score,
      }));
  };
  return { retrieve, index, dense };
}
/** Compara la presentación con el documento principal seleccionado. */
export async function compareDocs(docId: string, slidesId: string) {
  const [doc, slides] = await Promise.all([documentChunks([docId]), documentChunks([slidesId])]);
  return comparePresentation(doc, slides);
}
