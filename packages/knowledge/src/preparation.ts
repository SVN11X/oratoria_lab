import { keyTerms } from '@oratoria/defense';
import type { Chunk, Hit } from './library';

const FACETS = {
  problema: /problema|pregunta.*investig|introducci[oó]n/i,
  objetivos: /objetivo|hip[oó]tesis/i,
  teoria: /marco.*te[oó]ric|concept|literatura|antecedente/i,
  metodologia: /metodolog|muestra|dise[nñ]o|experimento|instrumento/i,
  resultados: /resultado|hallazgo|discusi[oó]n/i,
  conclusiones: /conclusi[oó]n/i,
  limitaciones: /limitaci[oó]n|trabajo.*futuro/i,
  referencias: /bibliograf|referencia/i,
} as const;
export type AcademicProfile = {
  version: 1;
  derived: true;
  /** Todo extracto conserva un identificador verificable del índice. */
  sections: { title: string; location: string; chunkIds: string[]; terms: string[]; extract: string }[];
  facets: Partial<Record<keyof typeof FACETS, string[]>>;
};
export function prepareAcademicProfile(chunks: Chunk[]): AcademicProfile {
  const groups = new Map<string, Chunk[]>();
  for (const c of chunks) {
    const key = `${c.docId}|${c.section ?? 'Sin sección'}`;
    const group = groups.get(key) ?? [];
    group.push(c);
    groups.set(key, group);
  }
  const facets: AcademicProfile['facets'] = {};
  const sections = [...groups.values()].map((group) => {
    const first = group[0]!;
    const title = first.section ?? 'Sin sección';
    for (const [name, pattern] of Object.entries(FACETS)) {
      if (pattern.test(title)) {
        const key = name as keyof typeof FACETS;
        facets[key] = [...(facets[key] ?? []), ...group.slice(0, 2).map((c) => c.id)].slice(0, 12);
      }
    }
    // Resumen extractivo identificado como derivado. Nunca crea conclusiones nuevas.
    const extract = group
      .map((c) => c.text)
      .join('\n')
      .slice(0, 500);
    return {
      title,
      location: first.location,
      chunkIds: group.map((c) => c.id),
      terms: keyTerms(
        group
          .slice(0, 12)
          .map((c) => c.text)
          .join(' '),
        6,
      ),
      extract,
    };
  });
  return { version: 1, derived: true, sections, facets };
}

/** Añade vecinos solo con la misma ubicación; conserva cada cita, deduplica y respeta el presupuesto. */
export function expandEvidence(hits: Hit[], chunks: Chunk[], maxChars = 10000, neighbors = 1): Hit[] {
  const chosen: Hit[] = [];
  const seen = new Set<string>();
  let chars = 0;
  const take = (hit: Hit) => {
    if (seen.has(hit.id) || chars + hit.text.length > maxChars) return;
    chars += hit.text.length;
    seen.add(hit.id);
    chosen.push(hit);
  };
  for (const hit of hits) take(hit);
  for (const hit of hits) {
    const nearby = chunks.filter(
      (c) =>
        c.docId === hit.docId &&
        c.section === hit.section &&
        c.page === hit.page &&
        c.slide === hit.slide &&
        Math.abs(c.order - hit.order) <= neighbors,
    );
    for (const c of nearby)
      take({ ...c, chunkId: c.id, excerpt: c.text.slice(0, 240), score: hit.score * 0.8 });
  }
  return chosen;
}
