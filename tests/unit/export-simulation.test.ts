import { describe, expect, it, vi } from 'vitest';
import { csvCell, sessionCSV, sessionJSON, sessionTXT, safeFilename } from '@oratoria/export';
import { newSession } from '@oratoria/core';
import { practiceReducer, INITIAL_PRACTICE } from '@oratoria/simulation';
import { verifyBytes, modelAvailable } from '@oratoria/model-manager';
describe('Exportaciones y práctica guiada', () => {
  it('neutraliza fórmulas en campos de texto CSV', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell(' =1+1')).toBe('"\' =1+1"');
    expect(csvCell(-38)).toBe('"-38"');
  });
  it('escapa comillas y limita nombres de archivo', () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(safeFilename('../../Tésis de prueba')).toBe('-Tesis-de-prueba');
  });
  it('exporta solamente las métricas disponibles', () => {
    const s = newSession({ title: 'Solo texto' });
    expect(sessionCSV(s)).not.toContain('palabras_por_minuto');
    expect(JSON.parse(sessionJSON(s)).audioIncluded).toBe(false);
    expect(sessionTXT(s)).toBe('');
  });
  it('la máquina de estados requiere una respuesta no vacía', () => {
    const s = practiceReducer(INITIAL_PRACTICE, {
      type: 'start',
      scenarioId: 'tesis',
      count: 2,
      difficulty: 'inicial',
    });
    expect(s.status).toBe('answering');
    expect(practiceReducer(s, { type: 'answer', text: ' ' })).toBe(s);
    const next = practiceReducer(s, { type: 'answer', text: 'Primera respuesta' });
    expect(next.index).toBe(1);
    const complete = practiceReducer(next, { type: 'answer', text: 'Segunda respuesta' });
    expect(complete.status).toBe('complete');
    expect(complete.answers).toEqual(['Primera respuesta', 'Segunda respuesta']);
  });
  it('el nivel modifica el orden real de preguntas fijas', () => {
    const a = practiceReducer(INITIAL_PRACTICE, {
        type: 'start',
        scenarioId: 'tesis',
        count: 1,
        difficulty: 'inicial',
      }),
      b = practiceReducer(INITIAL_PRACTICE, {
        type: 'start',
        scenarioId: 'tesis',
        count: 1,
        difficulty: 'profundizacion',
      });
    expect(a.questions[0]).not.toBe(b.questions[0]);
  });
  it('un caché de modelos no compatible no bloquea funciones sin modelo', async () => {
    vi.stubGlobal('caches', {
      open: async () => {
        throw new Error('CacheStorage no compatible');
      },
    });
    try {
      expect(await modelAvailable('/')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('verifica SHA-256 y rechaza contenido alterado', async () => {
    const bytes = new TextEncoder().encode('abc').buffer;
    expect(await verifyBytes(bytes, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toBe(
      true,
    );
    expect(await verifyBytes(bytes, '0'.repeat(64))).toBe(false);
  });
});
