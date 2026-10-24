import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  KnowledgeIndex,
  QueryVectorCache,
  expandEvidence,
  extractText,
  prepareAcademicProfile,
  segment,
  type Chunk,
} from '@oratoria/knowledge';
import { libraryStore } from '@oratoria/storage';

function chunk(id: string, docId: string, text: string, order = 0): Chunk {
  return {
    id,
    docId,
    docName: `${docId}.pdf`,
    text,
    order,
    page: 3,
    slide: null,
    section: 'Resultados',
    location: 'pág. 3 · Resultados',
  };
}

describe('Recuperación académica sin reemplazar BM25/RRF/MMR', () => {
  it('filtra por documento y sección antes del top-k, incluso tras 80 coincidencias en otro documento', () => {
    const noisy = Array.from({ length: 80 }, (_, i) =>
      chunk(`a:${i}`, 'a', 'neuronas aprendizaje cerebro neuronas', i),
    );
    const target = chunk(
      'b:0',
      'b',
      'Las neuronas intervienen en el aprendizaje y en la memoria de trabajo del grupo observado.',
    );
    const index = new KnowledgeIndex([...noisy, target]);
    expect(index.search('neuronas', { docIds: ['b'] }).map((h) => h.id)).toEqual(['b:0']);
    const second = { ...target, id: 'b:1', section: 'Limitaciones' };
    expect(
      new KnowledgeIndex([...noisy, second]).search('neuronas', { sections: ['Limitaciones'] })[0]?.id,
    ).toBe('b:1');
  });

  it('no inventa resultados cuando no existe una coincidencia ni vector de consulta', () => {
    const index = new KnowledgeIndex([chunk('a:0', 'a', 'El muestreo fue cualitativo por conveniencia.')]);
    expect(index.search('cromodinámica cuántica')).toEqual([]);
  });

  it('expande vecinos sin cruzar páginas, conserva identificadores y respeta el presupuesto', () => {
    const chunks = [
      chunk('a:0', 'a', 'Muestra de doce docentes.', 0),
      chunk('a:1', 'a', 'El tamaño se justificó por saturación.', 1),
      { ...chunk('a:2', 'a', 'Una cifra de otra página.', 2), page: 4, location: 'pág. 4' },
    ];
    const hit = { ...chunks[1]!, chunkId: 'a:1', excerpt: chunks[1]!.text, score: 1 };
    const expanded = expandEvidence([hit, hit], chunks, 80);
    expect(expanded.map((h) => h.id)).toEqual(['a:1', 'a:0']);
    expect(expanded.every((h) => h.page === 3)).toBe(true);
    expect(expanded.reduce((n, h) => n + h.text.length, 0)).toBeLessThanOrEqual(80);
  });

  it('segmenta párrafos sin puntuación y cadenas largas sin perder su contenido', () => {
    const text = 'λ'.repeat(12000);
    const chunks = segment({ id: 'long', name: 'largo.txt' }, extractText(text, 'txt'));
    expect(chunks.length).toBeGreaterThan(10);
    expect(Math.max(...chunks.map((c) => c.text.length))).toBeLessThanOrEqual(1250);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });

  it('prepara estructura derivada con referencias a metodología, resultados y limitaciones reales', () => {
    const extracted = extractText(
      '# Estudio ficticio\n\n## Metodología\nSe entrevistó a doce docentes.\n\n## Resultados\nTabla: Grupo A | 45 %; Grupo B | 55 %.\n\n## Limitaciones\nNo se incluyeron escuelas rurales.',
      'md',
    );
    const chunks = segment({ id: 'd', name: 'tesis.md' }, extracted);
    const profile = prepareAcademicProfile(chunks);
    expect(profile.derived).toBe(true);
    expect(Object.keys(profile.facets)).toEqual(['metodologia', 'resultados', 'limitaciones']);
    for (const section of profile.sections) {
      expect(section.chunkIds.every((id) => chunks.some((c) => c.id === id))).toBe(true);
      expect(
        chunks
          .filter((c) => section.chunkIds.includes(c.id))
          .map((c) => c.text)
          .join('\n'),
      ).toContain(section.extract);
    }
    expect(JSON.stringify(profile)).not.toContain('demuestra causalidad');
  });
});

describe('Recuperación semántica después de una desconexión', () => {
  it('usa un intervalo de recuperación y vuelve a activar la búsqueda semántica', async () => {
    let now = 0,
      calls = 0;
    const cache = new QueryVectorCache(
      async () => {
        if (++calls === 1) throw new Error('Ollama apagado');
        return [0.2, 0.8];
      },
      () => now,
    );
    expect(await cache.get('muestra')).toBeNull();
    expect(cache.degraded).toBe(true);
    expect(await cache.get('muestra')).toBeNull();
    expect(calls).toBe(1);
    now = 5001;
    expect(await cache.get('muestra')).toEqual([0.2, 0.8]);
    expect(cache.degraded).toBe(false);
    expect(await cache.get('muestra')).toEqual([0.2, 0.8]);
    expect(calls).toBe(2);
  });

  it('coalesce consultas simultáneas idénticas y rechaza vectores no finitos', async () => {
    const embed = vi.fn(async () => [1, 0]);
    const cache = new QueryVectorCache(embed);
    expect(await Promise.all([cache.get('objetivo'), cache.get('objetivo')])).toEqual([
      [1, 0],
      [1, 0],
    ]);
    expect(embed).toHaveBeenCalledTimes(1);
    const invalid = new QueryVectorCache(async () => [NaN]);
    expect(await invalid.get('consulta')).toBeNull();
    expect(invalid.degraded).toBe(true);
  });
});

describe('Reindexación y preservación de datos reales en IndexedDB', () => {
  it('conserva archivo, identidad y otro documento al reconstruir solo los datos derivados', async () => {
    vi.stubGlobal('location', new URL('http://localhost/'));
    const { importDocument, reindexDocument, documentChunks } =
      await import('../../apps/web/src/knowledge/library');
    const file = new File(
      [
        '# Tesis para reindexación\n\n## Resultados\nEl grupo experimental alcanzó un 45 % en el indicador de aprendizaje.',
      ],
      'reindexacion.md',
      { type: 'text/markdown' },
    );
    const doc = await importDocument(file, 'tesis', () => undefined);
    const before = await documentChunks([doc.id]);
    await libraryStore.saveVectors([
      { chunkId: before[0]!.id, docId: doc.id, model: 'embedding-test', vector: new Float32Array([1, 0]) },
      { chunkId: 'otro:0', docId: 'otro', model: 'embedding-test', vector: new Float32Array([0, 1]) },
    ]);
    const result = await reindexDocument(doc.id, () => undefined);
    expect(result.id).toBe(doc.id);
    expect(result.addedAt).toBe(doc.addedAt);
    expect(result.sha256).toBe(doc.sha256);
    expect(await (await libraryStore.file(doc.id))?.text()).toBe(await file.text());
    expect((await libraryStore.vectors('embedding-test', [doc.id])).size).toBe(0);
    expect((await libraryStore.vectors('embedding-test', ['otro'])).size).toBe(1);
    expect(result.academicProfile?.facets.resultados?.length).toBeGreaterThan(0);
    expect(await documentChunks([doc.id])).toEqual(before);
  });

  it('rechaza fragmentos de otro documento antes de iniciar una sustitución', async () => {
    await expect(
      libraryStore.replaceIndex(
        { id: 'conservar' } as never,
        [chunk('otro:1', 'otro', 'Texto ajeno.')] as never,
      ),
    ).rejects.toThrow('otro documento');
  });
});
