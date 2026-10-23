import { z } from 'zod';
import { create } from 'zustand';
import { practiceStore, type StoredPractice } from '@oratoria/storage';
import type { DefenseReport } from '@oratoria/defense';
import {
  COMMON,
  coachPlan,
  type CriterionResult,
  type EngineSnapshot,
  type EvaluationResult,
  type Exercise,
  type HistoryPoint,
  type ScenarioId,
} from '@oratoria/conversation';

export type PracticeRecord = {
  id: string;
  scenario: ScenarioId;
  createdAt: string;
  title: string;
  difficulty: HistoryPoint['difficulty'];
  durationSec: number;
  snapshot: EngineSnapshot | null;
  report: DefenseReport;
  evaluation: EvaluationResult;
  exercises: Exercise[];
  engines: { llm: string | null; evaluator: string | null; stt: string; tts: string; vision: boolean };
  docNames: string[];
  media: { type: string; bytes: number } | null;
  goal: string;
  /** Importado del antiguo simulador de defensa. */
  legacy?: boolean;
};
const RecordShape = z
  .object({
    id: z.string(),
    scenario: z.enum(['tesis', 'entrevista', 'presentacion', 'debate', 'educativa', 'dificil']),
    createdAt: z.string(),
    title: z.string(),
    report: z.object({ findings: z.array(z.unknown()) }).passthrough(),
    evaluation: z.object({ criteria: z.array(z.unknown()) }).passthrough(),
  })
  .passthrough();

export const useRecords = create<{
  records: PracticeRecord[];
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}>((set) => ({
  records: [],
  loading: true,
  error: '',
  reload: async () => {
    try {
      await migrateLegacy();
      const all = await practiceStore.list();
      set({
        records: all.filter((r) => RecordShape.safeParse(r).success) as unknown as PracticeRecord[],
        loading: false,
        error: '',
      });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : 'No se pudo leer el historial de prácticas.',
      });
    }
  },
}));
export async function saveRecord(r: PracticeRecord, media: Blob | null) {
  await practiceStore.save(r as unknown as StoredPractice, media);
  await useRecords.getState().reload();
}
export async function deleteRecord(id: string) {
  await practiceStore.remove(id);
  await useRecords.getState().reload();
}
export const recordMedia = (id: string) => practiceStore.media(id);
export const historyPoints = (records: PracticeRecord[]): HistoryPoint[] =>
  records.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    scenario: r.scenario,
    difficulty: r.difficulty,
    criteria: r.evaluation.criteria,
  }));

const LEVEL: Record<string, 0 | 1 | 2 | 3 | null> = {
  fortaleza: 3,
  adecuado: 2,
  mejorar: 1,
  'sin-datos': null,
};
/** Mapa de hallazgos del simulador anterior a criterios actuales. */
const LEGACY_MAP: Record<string, string> = {
  ritmo: 'ritmo',
  muletillas: 'muletillas',
  silencios: 'pausas',
  volumen: 'volumen',
  entonacion: 'entonacion',
  contacto: 'contacto',
  gestos: 'gestos',
  postura: 'postura',
  latencia: 'turnos',
  tiempo: 'tiempo',
  seguridad: 'asertividad',
  desarrollo: 'sintesis',
};
let migrated = false;
/** Importa una sola vez los informes que el antiguo simulador guardaba en localStorage. */
async function migrateLegacy() {
  if (migrated) return;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem('oratoria-defense-v1');
    if (!raw || localStorage.getItem('oratoria-defense-migrated') === '1') {
      migrated = true;
      return;
    }
  } catch {
    return;
  }
  let reports: DefenseReport[];
  try {
    const saved = (JSON.parse(raw) as { state?: { reports?: unknown } }).state?.reports;
    reports = Array.isArray(saved)
      ? saved.filter((r): r is DefenseReport => !!r && typeof r.id === 'string' && Array.isArray(r.findings))
      : [];
  } catch {
    // Una configuración antigua dañada no impide abrir las sesiones de la base actual.
    return;
  }
  const existing = new Set((await practiceStore.list()).map((r) => r.id));
  for (const r of reports) {
    if (existing.has(r.id)) continue;
    const criteria: CriterionResult[] = r.findings
      .filter((f) => LEGACY_MAP[f.id] && COMMON[LEGACY_MAP[f.id]!])
      .map((f) => {
        const c = COMMON[LEGACY_MAP[f.id]!]!;
        return {
          id: c.id,
          name: c.name,
          dimension: c.dimension,
          level: LEVEL[f.level] ?? null,
          observed: `${f.value}. ${f.explanation}`,
          why: c.whyItMatters,
          evidence: [{ kind: 'medicion' as const, text: f.value }],
          improve: f.exercise,
          method: 'medicion' as const,
          methodText: f.method,
          weight: c.weight,
        };
      });
    const record: PracticeRecord = {
      id: r.id,
      scenario: 'tesis',
      createdAt: r.createdAt,
      title: r.title,
      difficulty:
        r.difficulty === 'exigente' ? 'experta' : r.difficulty === 'amable' ? 'intermedia' : 'avanzada',
      durationSec: r.exposition.seconds,
      snapshot: null,
      report: r,
      evaluation: {
        criteria,
        summary: 'Informe importado del simulador de defensa anterior. Solo incluye mediciones.',
        strengths: [],
        improvements: [],
        notes: ['Importado desde la versión anterior.'],
        evaluatorModel: r.content?.model ?? null,
        index: null,
      },
      exercises: coachPlan(criteria),
      engines: {
        llm: r.content?.model ?? null,
        evaluator: null,
        stt: 'navegador',
        tts: 'sistema',
        vision: r.cameraUsed,
      },
      docNames: [],
      media: null,
      goal: '',
      legacy: true,
    };
    await practiceStore.save(record as unknown as StoredPractice, null);
  }
  try {
    localStorage.setItem('oratoria-defense-migrated', '1');
  } catch {
    /* sin almacenamiento */
  }
  migrated = true;
}
