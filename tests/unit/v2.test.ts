import { describe, expect, it, vi } from 'vitest';
import {
  evaluateSpeech,
  speechParts,
  ConversationEngine,
  SCENARIOS,
  createParticipants,
  evaluateSession,
  verifyQuote,
  type SessionConfig,
  type LlmPort,
} from '@oratoria/conversation';
import { cosine } from '@oratoria/knowledge';
import { OllamaClient } from '@oratoria/model-manager';

function config(): SessionConfig {
  const s = SCENARIOS.tesis;
  return {
    scenario: 'tesis',
    topic: 'Prueba de navegación autónoma',
    context: {},
    participants: createParticipants(s.roles.slice(0, 2), 'avanzada', { seed: 2 }),
    questions: 2,
    openingMinutes: 0,
    progressive: false,
    followUps: false,
    interruptions: true,
  };
}

describe('Evaluación fundamentada y temperamento', () => {
  it('no penaliza una interrupción del interlocutor y respeta criterios desactivados', async () => {
    const e = new ConversationEngine(config());
    await e.start();
    await e.answer({
      text: 'Elegimos este método porque permite comparar los resultados con el sensor del laboratorio.',
      durationSec: 50,
      latencySec: 2,
    });
    const s = e.snapshot();
    const criterion = SCENARIOS.tesis.criteria.filter((c) => c.id === 'turnos');
    expect(criterion).toHaveLength(1);
    const before = await evaluateSession({ snapshot: s, findings: [], criteria: criterion });
    s.turns[0]!.answer!.interrupted = true;
    const after = await evaluateSession({ snapshot: s, findings: [], criteria: criterion });
    expect(after.criteria[0]!.level).toBe(before.criteria[0]!.level);
    const disabled = await evaluateSession({ snapshot: s, findings: [], criteria: [] });
    expect(disabled.criteria).toEqual([]);
    expect(disabled.index).toBeNull();
    expect(verifyQuote('Elegimos este método', 'NO-T1', s)).toBeNull();
  });
  it('rechaza texto libre sin evidencia aunque el modelo presente un resumen convincente', async () => {
    const e = new ConversationEngine(config());
    await e.start();
    await e.answer({
      text: 'Elegimos el método por la disponibilidad del sensor.',
      durationSec: 20,
      latencySec: 2,
    });
    const llm: LlmPort = {
      model: 'doble',
      complete: async () =>
        JSON.stringify({
          criterios: [],
          resumen: 'FUE PERFECTO SIN EVIDENCIA',
          fortalezas: ['INVENTADO'],
          mejoras: ['INVENTADO'],
        }),
    };
    const result = await evaluateSession({ snapshot: e.snapshot(), findings: [], llm });
    expect(JSON.stringify(result)).not.toMatch(/INVENTADO|FUE PERFECTO/);
  });
});

describe('Análisis de grabaciones completas', () => {
  it('conserva el final de una transcripción extensa y no parte palabras cuando hay espacios', () => {
    const text = 'Un argumento con evidencia verificable. '.repeat(1000) + 'CONCLUSIÓN ÚLTIMA';
    const parts = speechParts(text);
    expect(parts.length).toBeGreaterThan(10);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text.trim().replace(/\s+/g, ' '));
    expect(parts.at(-1)).toContain('CONCLUSIÓN ÚLTIMA');
    expect(parts.every((p) => p.length <= 2800)).toBe(true);
  });
  it('descarta una cita inventada y mantiene solo identificadores de fuentes válidos', async () => {
    const llm: LlmPort = {
      model: 'doble',
      complete: async () =>
        JSON.stringify({
          comentarios: [
            {
              cita: 'Los resultados muestran un error de 4 cm.',
              observacion: 'Resultado explícito.',
              mejora: 'Explica la dispersión.',
              fuentes: ['S1', 'S1', 'S-1', 'S99'],
            },
            {
              cita: 'Una cita que el usuario jamás pronunció.',
              observacion: 'inventado',
              mejora: 'inventado',
              fuentes: [],
            },
          ],
        }),
    };
    const r = await evaluateSpeech({
      text: 'Los resultados muestran un error de 4 cm.',
      title: 'Robot',
      goal: 'Sintetizar',
      llm,
      retrieve: async () => [
        {
          docId: 'd',
          docName: 'tesis.pdf',
          chunkId: 'c',
          location: 'pág. 7',
          text: 'El error es de 4 cm.',
          excerpt: 'El error es de 4 cm.',
          score: 1,
        },
      ],
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.sources).toHaveLength(1);
    expect(r.notes.join(' ')).toContain('descartaron 1');
  });
});

describe('Descargas y vectores', () => {
  it('acepta la última línea NDJSON sin salto y propaga un error al final del stream', async () => {
    const client = (last: unknown) =>
      new OllamaClient(
        undefined,
        vi.fn(
          async () =>
            new Response(JSON.stringify({ status: 'verifying sha256 digest' }) + '\n' + JSON.stringify(last)),
        ) as typeof fetch,
      );
    const progress = vi.fn();
    await client({ status: 'success' }).pull('modelo:1b', progress);
    expect(progress.mock.calls.at(-1)?.[0]).toEqual({ status: 'success' });
    await expect(client({ error: 'firma inválida' }).pull('modelo:1b', progress)).rejects.toThrow(
      'firma inválida',
    );
  });
  it('no calcula similitudes con dimensiones incompatibles, ceros o NaN', () => {
    expect(cosine([1, 0], [1])).toBe(0);
    expect(cosine([NaN], [1])).toBe(0);
    expect(cosine([0, 0], [0, 0])).toBe(0);
    expect(cosine([1, 0], [1, 0])).toBe(1);
  });
});
