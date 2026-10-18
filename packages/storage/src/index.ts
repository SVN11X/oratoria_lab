import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { SessionSchema, RubricSchema, type Session, type Rubric } from '@oratoria/core';

/** Documento del material académico guardado localmente (metadatos). */
export type StoredDoc = { id: string } & Record<string, unknown>;
/** Fragmento de un documento. */
export type StoredChunk = { id: string; docId: string } & Record<string, unknown>;
/** Registro de una práctica guiada (informe, turnos y evaluación). */
export type StoredPractice = { id: string; scenario: string; createdAt: string } & Record<string, unknown>;
interface Database extends DBSchema {
  sessions: { key: string; value: Session };
  audio: { key: string; value: Blob };
  chunks: { key: [string, number]; value: Blob };
  rubrics: { key: string; value: Rubric };
  docs: { key: string; value: StoredDoc };
  docFiles: { key: string; value: Blob };
  docChunks: { key: string; value: StoredChunk; indexes: { byDoc: string } };
  vectors: {
    key: [string, string];
    value: { chunkId: string; model: string; docId: string; vector: Float32Array };
    indexes: { byDoc: string; byModel: string };
  };
  practice: { key: string; value: StoredPractice; indexes: { byScenario: string } };
  practiceMedia: { key: string; value: Blob };
}
let database: Promise<IDBPDatabase<Database>> | undefined;
/**
 * Base de datos local. La versión 2 agrega material académico, vectores y prácticas guiadas
 * sin tocar los almacenes existentes de la versión 1.
 */
export function db() {
  return (database ??= openDB<Database>('oratoria-lab-v1', 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('sessions', { keyPath: 'id' });
        d.createObjectStore('audio');
        d.createObjectStore('chunks');
        d.createObjectStore('rubrics');
      }
      if (oldVersion < 2) {
        d.createObjectStore('docs', { keyPath: 'id' });
        d.createObjectStore('docFiles');
        d.createObjectStore('docChunks', { keyPath: 'id' }).createIndex('byDoc', 'docId');
        const v = d.createObjectStore('vectors', { keyPath: ['chunkId', 'model'] });
        v.createIndex('byDoc', 'docId');
        v.createIndex('byModel', 'model');
        d.createObjectStore('practice', { keyPath: 'id' }).createIndex('byScenario', 'scenario');
        d.createObjectStore('practiceMedia');
      }
    },
  }));
}
export interface SessionStore {
  list(): Promise<Session[]>;
  get(id: string): Promise<Session | undefined>;
  save(session: Session, blob?: Blob): Promise<void>;
  audio(id: string): Promise<Blob | undefined>;
  remove(id: string): Promise<void>;
}
export class BrowserStore implements SessionStore {
  async list() {
    return (await (await db()).getAll('sessions'))
      .map((s) => SessionSchema.parse(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) {
    const s = await (await db()).get('sessions', id);
    return s ? SessionSchema.parse(s) : undefined;
  }
  async save(session: Session, blob?: Blob) {
    const data = SessionSchema.parse(session);
    const tx = (await db()).transaction(['sessions', 'audio'], 'readwrite');
    await tx.objectStore('sessions').put(data);
    if (blob) await tx.objectStore('audio').put(blob, data.id);
    await tx.done;
  }
  async audio(id: string) {
    return (await db()).get('audio', id);
  }
  async remove(id: string) {
    const tx = (await db()).transaction(['sessions', 'audio'], 'readwrite');
    await tx.objectStore('sessions').delete(id);
    await tx.objectStore('audio').delete(id);
    await tx.done;
  }
}
export class DesktopStore implements SessionStore {
  private async invoke<T>(command: string, args?: Record<string, unknown>) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
  }
  async list() {
    return (await this.invoke<string[]>('list_sessions'))
      .map((s) => SessionSchema.parse(JSON.parse(s)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) {
    const s = await this.invoke<string | null>('get_session', { id });
    return s ? SessionSchema.parse(JSON.parse(s)) : undefined;
  }
  async save(session: Session, blob?: Blob) {
    const audio = blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : null;
    await this.invoke('save_session', { metadata: JSON.stringify(SessionSchema.parse(session)), audio });
  }
  async audio(id: string) {
    const session = await this.get(id);
    const bytes = await this.invoke<number[] | null>('read_audio', { id });
    return bytes
      ? new Blob([new Uint8Array(bytes)], { type: session?.audioMime ?? 'audio/webm' })
      : undefined;
  }
  async remove(id: string) {
    await this.invoke('delete_session', { id });
  }
}
export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const store: SessionStore = isDesktop() ? new DesktopStore() : new BrowserStore();
export const drafts = {
  async append(id: string, index: number, blob: Blob) {
    await (await db()).put('chunks', blob, [id, index]);
  },
  async finish(id: string, mime: string) {
    const d = await db();
    const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
    const chunks = await d.getAll('chunks', range);
    const blob = new Blob(chunks, { type: mime });
    await d.delete('chunks', range);
    return blob;
  },
  async remove(id: string) {
    await (await db()).delete('chunks', IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  },
  async clearAbandoned() {
    await (await db()).clear('chunks');
  },
};
export const rubricStore = {
  async list() {
    return (await (await db()).getAll('rubrics')).map((r) => RubricSchema.parse(r));
  },
  async save(rubric: Rubric) {
    await (await db()).put('rubrics', RubricSchema.parse(rubric), `${rubric.id}@${rubric.version}`);
  },
};

/** Material académico: documentos, archivo original, fragmentos y vectores. */
export const libraryStore = {
  async docs(): Promise<StoredDoc[]> {
    return (await db()).getAll('docs');
  },
  async chunks(docIds?: string[]): Promise<StoredChunk[]> {
    const d = await db();
    if (!docIds) return d.getAll('docChunks');
    const out: StoredChunk[] = [];
    for (const id of docIds) out.push(...(await d.getAllFromIndex('docChunks', 'byDoc', id)));
    return out;
  },
  async file(id: string): Promise<Blob | undefined> {
    return (await db()).get('docFiles', id);
  },
  async save(doc: StoredDoc, chunks: StoredChunk[], file?: Blob) {
    const tx = (await db()).transaction(['docs', 'docChunks', 'docFiles'], 'readwrite');
    await tx.objectStore('docs').put(doc);
    for (const c of chunks) await tx.objectStore('docChunks').put(c);
    if (file) await tx.objectStore('docFiles').put(file, doc.id);
    await tx.done;
  },
  async update(doc: StoredDoc) {
    await (await db()).put('docs', doc);
  },
  /** Elimina el documento, su archivo, sus fragmentos y todos sus vectores. */
  async remove(id: string) {
    const d = await db();
    const tx = d.transaction(['docs', 'docChunks', 'docFiles', 'vectors'], 'readwrite');
    await tx.objectStore('docs').delete(id);
    await tx.objectStore('docFiles').delete(id);
    for (const key of await tx.objectStore('docChunks').index('byDoc').getAllKeys(id))
      await tx.objectStore('docChunks').delete(key);
    for (const key of await tx.objectStore('vectors').index('byDoc').getAllKeys(id))
      await tx.objectStore('vectors').delete(key);
    await tx.done;
  },
  async vectors(model: string, docIds: string[]): Promise<Map<string, Float32Array>> {
    const d = await db();
    const out = new Map<string, Float32Array>();
    for (const docId of docIds)
      for (const v of await d.getAllFromIndex('vectors', 'byDoc', docId))
        if (v.model === model) out.set(v.chunkId, v.vector);
    return out;
  },
  async saveVectors(items: { chunkId: string; model: string; docId: string; vector: Float32Array }[]) {
    const tx = (await db()).transaction('vectors', 'readwrite');
    for (const it of items) await tx.store.put(it);
    await tx.done;
  },
  async removeVectorsOf(model: string) {
    const d = await db();
    const tx = d.transaction('vectors', 'readwrite');
    for (const key of await tx.store.index('byModel').getAllKeys(model)) await tx.store.delete(key);
    await tx.done;
  },
};
/** Registros de prácticas guiadas y su grabación opcional. */
export const practiceStore = {
  async list(): Promise<StoredPractice[]> {
    return ((await (await db()).getAll('practice')) as StoredPractice[]).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  },
  async get(id: string) {
    return (await db()).get('practice', id);
  },
  async save(record: StoredPractice, media?: Blob | null) {
    const tx = (await db()).transaction(['practice', 'practiceMedia'], 'readwrite');
    await tx.objectStore('practice').put(record);
    if (media) await tx.objectStore('practiceMedia').put(media, record.id);
    await tx.done;
  },
  async media(id: string) {
    return (await db()).get('practiceMedia', id);
  },
  async removeMedia(id: string) {
    await (await db()).delete('practiceMedia', id);
  },
  async remove(id: string) {
    const tx = (await db()).transaction(['practice', 'practiceMedia'], 'readwrite');
    await tx.objectStore('practice').delete(id);
    await tx.objectStore('practiceMedia').delete(id);
    await tx.done;
  },
};
/** Borra todos los datos locales de la app en este navegador (sesiones, material y prácticas). */
export async function clearAllLocalData() {
  const d = await db();
  const names = [
    'sessions',
    'audio',
    'chunks',
    'rubrics',
    'docs',
    'docFiles',
    'docChunks',
    'vectors',
    'practice',
    'practiceMedia',
  ] as const;
  const tx = d.transaction([...names], 'readwrite');
  for (const n of names) await tx.objectStore(n).clear();
  await tx.done;
}
