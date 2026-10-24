import { describe, expect, it, vi } from 'vitest';
import {
  ConversationEngine,
  SCENARIOS,
  SCENARIO_ORDER,
  createParticipants,
  jsonStringPrefix,
  sessionMemoryBlock,
  TurnDiagnostics,
  type LlmPort,
  type ScenarioId,
  type SessionConfig,
  type TurnRecord,
  budgetedContext,
} from '@oratoria/conversation';

function config(id: ScenarioId = 'tesis'): SessionConfig {
  const s = SCENARIOS[id];
  return {
    scenario: id,
    topic: 'Investigación ficticia',
    context: {},
    questions: 3,
    progressive: true,
    followUps: true,
    interruptions: false,
    openingMinutes: 0,
    participants: createParticipants(
      s.defaultRoles.map((r) => s.roles.find((x) => x.id === r)!),
      'experta',
      { seed: 7 },
    ),
  };
}
const source = {
  docId: 'd',
  docName: 'tesis.pdf',
  chunkId: 'd:0',
  location: 'pág. 3 · Metodología',
  excerpt: 'Se entrevistó a doce docentes.',
  text: 'Se entrevistó a doce docentes de colegios urbanos mediante muestreo por conveniencia.',
  score: 1,
};
function port(questions: string[]) {
  let index = 0;
  return {
    model: 'modelo-de-prueba',
    complete: vi.fn(async (_messages, options) => {
      const text = JSON.stringify({ pregunta: questions[index++ % questions.length], fuentes: ['S1'] });
      for (let i = 0; i < text.length; i += 9) options.onDelta?.(text.slice(i, i + 9));
      options.onMetrics?.({ firstTokenMs: 3, loadMs: 0, tokensPerSecond: 10 });
      return text;
    }),
  } satisfies LlmPort;
}

describe('Diálogo compartido con streaming conectado', () => {
  it('el perfil estructurado también descarta una objeción con fuentes inventadas', async () => {
    let n = 0;
    const llm: LlmPort = {
      model: 'objecion-invalida',
      complete: async () =>
        ++n === 1
          ? JSON.stringify({ pregunta: '¿Por qué eligió entrevistas con docentes?', fuentes: ['S1'] })
          : JSON.stringify({
              tipo: 'contradice_documento',
              reaccion: 'Su tesis demuestra otra cosa.',
              repregunta: 'En la página 999 dice otra cosa. ¿Por qué?',
              fuentes: ['S99'],
            }),
    };
    const e = new ConversationEngine(config(), {
      llm,
      dialogue: 'evaluado',
      retrieve: async () => [source],
      rng: () => 0,
    });
    await e.start();
    const moves = await e.answer({ text: 'Era el mejor método.', durationSec: 2, latencySec: 0 });
    expect(moves.every((m) => !m.text.includes('999'))).toBe(true);
    expect(moves[0]?.generator).toBe('reglas');
  });
  it('reduce de dos a una las inferencias al avanzar de tema, comparando ambas rutas con el mismo caso', async () => {
    const counts: number[] = [];
    for (const dialogue of ['evaluado', 'directo'] as const) {
      let questions = 0;
      const complete = vi.fn<LlmPort['complete']>(async (_messages, o) => {
        if ((o.schema?.properties as Record<string, unknown>)?.tipo)
          return JSON.stringify({ tipo: 'correcta', reaccion: 'Entiendo.', repregunta: null, fuentes: [] });
        return JSON.stringify({
          pregunta:
            questions++ === 0
              ? '¿Por qué eligió un muestreo por conveniencia?'
              : '¿Cómo contrastaría la interpretación de los hallazgos?',
          fuentes: ['S1'],
        });
      });
      const setup = config();
      setup.followUps = false;
      const engine = new ConversationEngine(setup, {
        dialogue,
        llm: { model: 'comparacion-controlada', complete },
        retrieve: async () => [source],
        rng: () => 0,
      });
      await engine.start();
      const before = complete.mock.calls.length;
      await engine.answer({
        text: 'Elegí entrevistas porque permiten comprender experiencias; registré doce conversaciones y contrasté los temas con las notas de campo para justificar el análisis.',
        durationSec: 12,
        latencySec: 0,
      });
      counts.push(complete.mock.calls.length - before);
    }
    expect(counts).toEqual([2, 1]);
  });
  it('genera una repregunta en una inferencia, usando la última respuesta y sin evaluar antes de hablar', async () => {
    const llm = port([
      '¿Por qué eligió entrevistas con docentes urbanos?',
      'Mencionó que era el mejor método. ¿Qué comparación concreta respalda esa elección?',
    ]);
    const drafts: string[] = [];
    const engine = new ConversationEngine(config(), {
      llm,
      dialogue: 'directo',
      rng: () => 0,
      retrieve: async () => [source],
      retrieveLocal: async () => [source],
      onDraft: (_id, text) => drafts.push(text),
    });
    await engine.start();
    const before = llm.complete.mock.calls.length;
    const moves = await engine.answer({ text: 'Era el mejor método.', durationSec: 4, latencySec: 0 });
    expect(llm.complete.mock.calls.length - before).toBe(1);
    expect(moves[0]).toMatchObject({ kind: 'repregunta', generator: 'ia' });
    expect(moves[0]?.text).toContain('Qué comparación');
    const messages = llm.complete.mock.calls.at(-1)![0];
    expect(messages.at(-1)?.content).toContain('Era el mejor método.');
    expect(messages.at(-1)?.content).not.toContain('clasifica la respuesta');
    expect(drafts.some((d) => d.includes('Mencionó que'))).toBe(true);
    expect(drafts.at(-1)).toBe('');
  });

  it.each(SCENARIO_ORDER)('%s: una pregunta nueva usa una inferencia y conserva el escenario', async (id) => {
    const llm = port([
      '¿Qué criterio utilizó para elegir la estrategia?',
      '¿Cómo comprobaría el impacto que acaba de describir?',
    ]);
    const setup = config(id);
    setup.followUps = false;
    const engine = new ConversationEngine(setup, {
      llm,
      dialogue: 'directo',
      retrieve: async () => [source],
    });
    await engine.start();
    const before = llm.complete.mock.calls.length;
    await engine.answer({
      text: 'Elegí esta estrategia porque permite comparar experiencias; por ejemplo, entrevisté a doce docentes y registré sus respuestas para fundamentar los resultados.',
      durationSec: 12,
      latencySec: 1,
    });
    expect(llm.complete.mock.calls.length - before).toBe(1);
    expect(engine.snapshot().scenario).toBe(id);
    expect(engine.turns[0]?.answer?.text).toContain('doce docentes');
  });

  it('no consulta embeddings por cada área durante la apertura', async () => {
    const retrieve = vi.fn(async () => [source]);
    const local = vi.fn(async () => [source]);
    const engine = new ConversationEngine(config(), { retrieve, retrieveLocal: local, rng: () => 0 });
    await engine.start();
    expect(local).toHaveBeenCalledTimes(SCENARIOS.tesis.areas.length);
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it.each([
    { pregunta: 'En la página 999 afirma algo distinto. ¿Por qué?', fuentes: ['S1'] },
    { pregunta: '¿Por qué eligió este método de investigación?', fuentes: ['S99'] },
    { pregunta: 'Su tesis demuestra causalidad. ¿Por qué ocurrió?', fuentes: [] },
  ])('descarta una referencia imposible o una atribución documental sin fuente', async (response) => {
    const llm: LlmPort = { model: 'doble', complete: async () => JSON.stringify(response) };
    const e = new ConversationEngine(config(), { llm, dialogue: 'directo', retrieve: async () => [source] });
    await e.start();
    expect(e.currentTurn?.question.generator).toBe('reglas');
    expect(e.currentTurn?.question.text).not.toContain('999');
  });

  it('acepta la ubicación real de la fuente y conserva el identificador de fragmento', async () => {
    const llm = port(['En la página 3 describe muestreo por conveniencia. ¿Por qué lo eligió?']);
    const e = new ConversationEngine(config(), { llm, dialogue: 'directo', retrieve: async () => [source] });
    await e.start();
    expect(e.currentTurn?.question.generator).toBe('ia');
    expect(e.currentTurn?.question.sources[0]).toMatchObject({ chunkId: 'd:0', location: source.location });
  });

  it('se recupera tras el intervalo del cortacircuito sin perder respuestas previas', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    let calls = 0;
    const llm: LlmPort = {
      model: 'recuperable',
      complete: async () => {
        if (++calls <= 3) throw new Error('sin conexión');
        return JSON.stringify({
          pregunta: '¿Cómo contrastaría las conclusiones con una muestra rural?',
          fuentes: ['S1'],
        });
      },
    };
    const setup = config();
    setup.questions = 8;
    setup.followUps = false;
    const engine = new ConversationEngine(setup, {
      llm,
      dialogue: 'directo',
      retrieve: async () => [source],
    });
    try {
      await engine.start();
      for (let i = 0; i < 2; i++)
        await engine.answer({ text: 'Respuesta conservada de la prueba.', durationSec: 2, latencySec: 0 });
      expect(engine.llmActive).toBe(false);
      now = 16000;
      await engine.answer({ text: 'Conservo también esta respuesta.', durationSec: 2, latencySec: 0 });
      expect(engine.llmActive).toBe(true);
      expect(engine.currentTurn?.question.generator).toBe('ia');
      expect(engine.snapshot().turns).toHaveLength(3);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('Prefijos, memoria acotada y diagnóstico privado', () => {
  it('respeta el presupuesto aproximado manteniendo respuesta actual, movimiento y fuentes primero', () => {
    const system = 'Reglas del interlocutor. '.repeat(70);
    const blocks = [
      'Preparación extractiva derivada:\n' + 'mapa '.repeat(3000),
      'Última respuesta del usuario: "Utilicé entrevistas por saturación."',
      'Movimiento elegido: pedir evidencia de saturación.',
      'Evidencia disponible:\n[S1] doce docentes. ' + 'evidencia '.repeat(3000),
      'Preguntas antiguas: ' + 'historia '.repeat(3000),
      'Devuelva JSON con pregunta primero.',
    ];
    const user = budgetedContext(system, blocks, 10500);
    expect(user.length + system.length).toBeLessThanOrEqual(10500);
    expect(user).toContain('Utilicé entrevistas por saturación');
    expect(user).toContain('[S1]');
    expect(user).toContain('pedir evidencia de saturación');
    expect(user).toContain('Contexto limitado');
  });
  it('decodifica escapes incompletos y no interpreta una clave citada como propiedad', () => {
    expect(jsonStringPrefix('{"pregunta":"¿Por qu', 'pregunta')).toBe('¿Por qu');
    expect(jsonStringPrefix('{"pregunta":"Línea\\n\\u00f1', 'pregunta')).toBe('Línea\nñ');
    expect(jsonStringPrefix('{"pregunta":"Cita \\"', 'pregunta')).toBe('Cita "');
    expect(jsonStringPrefix('{"motivo":"dijo \\"pregunta\\": \\"no\\"", "pregunta":"Sí', 'pregunta')).toBe(
      'Sí',
    );
    expect(jsonStringPrefix('{"pregunta":"Un escape \\u0', 'pregunta')).toBe('Un escape ');
  });

  it('recuerda afirmaciones de turnos antiguos sin incluir todos los textos completos', () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({
      question: { area: 'metodologia', text: `Pregunta ${i}` },
      answer: {
        text: `El objetivo ${i} fue entrevistar a doce docentes porque permite contrastar experiencias. ${'Texto adicional. '.repeat(100)}`,
        analysis: { type: 'correcta' },
      },
    })) as TurnRecord[];
    const memory = sessionMemoryBlock(turns);
    expect(memory).toContain('objetivo 25');
    expect(memory).not.toContain('Texto adicional. Texto adicional.');
    expect(memory.length).toBeLessThan(2500);
  });

  it('calcula percentiles de medidas presentes y exporta solo campos permitidos', () => {
    let now = 100;
    const diagnostics = new TurnDiagnostics(() => now);
    for (const latency of [10, 20, 30, 40, 500]) {
      diagnostics.begin('qwen3.5:4b', 'ollama');
      now += latency;
      diagnostics.mark('firstAudioMs', true);
      diagnostics.mark('firstAudioMs', true);
    }
    diagnostics.add('privateTranscript' as never, 10);
    diagnostics.add('loadMs', NaN);
    const report = diagnostics.export();
    expect(report.percentiles.firstAudioMs).toEqual({ n: 5, p50: 30, p95: 500 });
    expect(report.percentiles.loadMs).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain('privateTranscript');
    expect(report.turns.map((t) => t.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
  });
});
