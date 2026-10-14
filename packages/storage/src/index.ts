import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { SessionSchema, RubricSchema, type Session, type Rubric } from '@oratoria/core';

interface Database extends DBSchema {
  sessions: { key: string; value: Session };
  audio: { key: string; value: Blob };
  chunks: { key: [string, number]; value: Blob };
  rubrics: { key: string; value: Rubric };
}
let database: Promise<IDBPDatabase<Database>> | undefined;
export function db() {
  return (database ??= openDB<Database>('oratoria-lab-v1', 1, {
    upgrade(d) {
      d.createObjectStore('sessions', { keyPath: 'id' });
      d.createObjectStore('audio');
      d.createObjectStore('chunks');
      d.createObjectStore('rubrics');
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
