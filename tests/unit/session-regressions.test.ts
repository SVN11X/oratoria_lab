import { afterEach, expect, it, vi } from 'vitest';
import {
  ConversationEngine,
  SCENARIOS,
  createParticipants,
  evaluateSession,
  transcriptQuality,
  verifyQuote,
  type SessionConfig,
  type LlmPort,
} from '@oratoria/conversation';
import { unsupportedPremise } from '../../packages/conversation/src/grounding';
vi.stubGlobal('location', new URL('http://localhost/'));
const { piperPhrases } = await import('../../apps/web/src/voice/tts');
const { ServerStt } = await import('../../apps/web/src/voice/stt');
type BatchSchema = { properties: { criterios: { items: { properties: { id: { enum: string[] } } } } } };

const text =
  'Elegí entrevistas porque permiten comparar experiencias. Por ejemplo, registré doce conversaciones y contrasté las respuestas con notas de campo.';
const loop = 'Un inicio reconocido. ' + 'de la identificación '.repeat(100);
function config(): SessionConfig {
  const scenario = SCENARIOS.tesis;
  return {
    scenario: 'tesis',
    topic: 'Investigación ficticia',
    context: {},
    questions: 2,
    progressive: false,
    followUps: false,
    interruptions: false,
    openingMinutes: 0,
    participants: createParticipants(scenario.roles.slice(0, 2), 'avanzada', { seed: 3 }),
  };
}
async function snapshot() {
  const engine = new ConversationEngine(config());
  await engine.start();
  await engine.answer({ text, durationSec: 20, latencySec: 1 });
  return engine.snapshot();
}
afterEach(() => vi.unstubAllGlobals());

it.each(['de la identificación ', 'a ir ', 'de la información '])(
  'señala el bucle %s sin recortar ni corregir el original',
  (part) => {
    const original = `Inicio. ${part.repeat(90)} Final.`;
    expect(transcriptQuality(original).review).toBe(true);
    expect(original).toContain(part.repeat(90));
  },
);
it('acepta términos técnicos recurrentes y repeticiones breves', () => {
  expect(transcriptQuality('No, no, no; el error de odometría no mide el error del mapa.').review).toBe(
    false,
  );
  const technical = Array.from(
    { length: 12 },
    (_, i) => `La prueba ${i} usa ROS 2, con un sensor ${i * 3}, y muestra un resultado ${i * 7}.`,
  ).join(' ');
  expect(transcriptQuality(technical).review).toBe(false);
});
it('bloquea una transcripción degenerada antes de recuperar o generar y acepta su confirmación explícita', async () => {
  const retrieve = vi.fn(async () => []);
  const engine = new ConversationEngine(config(), { retrieve });
  await engine.start();
  const before = retrieve.mock.calls.length;
  await expect(engine.answer({ text: loop, durationSec: 30, latencySec: 1 })).rejects.toThrow(
    'Revisa la transcripción',
  );
  expect(retrieve).toHaveBeenCalledTimes(before);
  expect(engine.currentTurn?.answer).toBeNull();
  await engine.answer({ text: loop, durationSec: 30, latencySec: 1, transcriptReviewed: true });
  expect(engine.snapshot().turns[0]?.answer).toMatchObject({ text: loop, transcriptReviewed: true });
});
it('excluye bucles de sesiones antiguas de las reglas y las citas de IA sin modificar la sesión', async () => {
  const saved = await snapshot();
  saved.turns[0]!.answer!.text = loop;
  const llm: LlmPort = { model: 'doble', complete: vi.fn() };
  const result = await evaluateSession({
    snapshot: saved,
    findings: [],
    llm,
    criteria: SCENARIOS.tesis.criteria.filter((c) =>
      ['pertinencia', 'sintesis', 'asertividad'].includes(c.id),
    ),
  });
  expect(result.criteria.every((c) => c.level === null)).toBe(true);
  expect(llm.complete).not.toHaveBeenCalled();
  expect(verifyQuote('de la identificación', 'T1', saved)).toBeNull();
  expect(saved.turns[0]?.answer?.text).toBe(loop);
  expect(result.notes.join(' ')).toContain('Se excluyeron 1');
});
it('evalúa bloques de hasta tres criterios, recupera un JSON cortado y conserva los demás bloques', async () => {
  const saved = await snapshot();
  let attempt = 0;
  const complete = vi.fn<LlmPort['complete']>(async (_messages, options) => {
    if (++attempt === 1) return '{"criterios":[';
    const ids = (options.schema as BatchSchema).properties.criterios.items.properties.id.enum;
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(options.maxOutputTokens).toBe(2048);
    return JSON.stringify({
      criterios: ids.map((id) => ({
        id,
        nivel: 2,
        evidencias: [{ turno: 'T1', cita: 'registré doce conversaciones' }],
        observacion: 'Evidencia literal.',
        mejora: 'Explicitar el contraste.',
      })),
    });
  });
  const result = await evaluateSession({
    snapshot: saved,
    findings: [],
    llm: { model: 'prueba-local', complete },
  });
  expect(complete.mock.calls.length).toBeGreaterThan(2);
  expect(result.criteria.filter((c) => c.method === 'ia').length).toBeGreaterThan(3);
  expect(result.notes.join(' ')).toContain('Se recuperó el bloque 1');
  expect(result.evaluatorModel).toBe('prueba-local');
});
it('un bloque que falla dos veces conserva las valoraciones verificadas de otros bloques', async () => {
  const saved = await snapshot();
  const complete = vi.fn<LlmPort['complete']>(async (_messages, options) => {
    const ids = (options.schema as BatchSchema).properties.criterios.items.properties.id.enum;
    if (ids.includes('fundamentacion')) return '{';
    return JSON.stringify({
      criterios: ids.map((id) => ({
        id,
        nivel: 2,
        evidencias: [{ turno: 'T1', cita: 'registré doce conversaciones' }],
      })),
    });
  });
  const result = await evaluateSession({
    snapshot: saved,
    findings: [],
    llm: { model: 'parcial', complete },
  });
  expect(result.criteria.find((c) => c.id === 'fundamentacion')?.method).toBe('reglas');
  expect(result.criteria.some((c) => c.method === 'ia')).toBe(true);
  expect(result.notes.join(' ')).toContain('No se obtuvo el bloque 1');
});
it('Piper inicia con un fragmento corto y conserva cifras, siglas y todo el texto', () => {
  const original =
    'La odometría del robot ROS 2 registra 3,63% de error, una medida distinta de la precisión del mapa; ¿cómo comprobaría esa diferencia mediante una referencia externa y un criterio de aceptación reproducible en otro escenario?';
  const parts = piperPhrases(original);
  expect(parts[0]!.text.length).toBeLessThanOrEqual(96);
  expect(parts.every((p) => p.text.length <= 160)).toBe(true);
  expect(parts.map((p) => p.text).join(' ')).toBe(original);
  expect(parts.some((p) => p.text.includes('3,63%'))).toBe(true);
});
it('una sigla nueva exige una hipótesis explícita; una pregunta anterior no sirve como evidencia', () => {
  const evidence = 'El sistema usa ROS 2 y Arduino mediante enlace serie.';
  expect(unsupportedPremise('¿Cómo evitó saturar el bus CAN entre ROS 2 y Arduino?', evidence)).toBe(true);
  expect(unsupportedPremise('Como alternativa, si usara CAN, ¿qué cambiaría?', evidence)).toBe(false);
  expect(unsupportedPremise('¿Cómo configuró el enlace entre ROS 2 y Arduino?', evidence)).toBe(false);
  expect(unsupportedPremise("Si afirma que 'el mapa fue perfecto', ¿cómo lo midió?", evidence)).toBe(true);
});
it('el motor descarta una premisa CAN ajena a las fuentes sin una segunda inferencia', async () => {
  const complete = vi.fn<LlmPort['complete']>(async () =>
    JSON.stringify({
      pregunta: '¿Cómo evitó saturar el bus CAN entre ROS 2 y Arduino?',
      fuentes: ['S1'],
    }),
  );
  const source = {
    docId: 'd',
    docName: 'estudio.md',
    chunkId: 'd:1',
    location: 'sección Hardware',
    excerpt: 'El sistema usa ROS 2 y Arduino mediante enlace serie.',
    text: 'El sistema usa ROS 2 y Arduino mediante enlace serie.',
    score: 1,
  };
  const engine = new ConversationEngine(config(), {
    llm: { model: 'prueba', complete },
    dialogue: 'directo',
    retrieve: async () => [source],
  });
  await engine.start();
  expect(engine.currentTurn?.question.generator).toBe('reglas');
  expect(engine.currentTurn?.question.text).not.toContain('CAN');
  expect(complete).toHaveBeenCalledTimes(1);
});
it('la captura local entrega un fragmento al llegar una pausa sin esperar al final del turno', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ text: 'Texto reconocido.' })));
  vi.stubGlobal('fetch', fetcher);
  const onFinal = vi.fn();
  const stt = new ServerStt({ baseUrl: 'http://localhost:9999/v1', model: 'prueba' }, { onFinal });
  stt.setListening(true, 0);
  stt.feed(new Float32Array(16000 * 4).fill(0.03), 16000, 0);
  stt.feed(new Float32Array(16000 * 0.7), 16000, 4);
  await stt.flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(onFinal).toHaveBeenCalledWith('Texto reconocido.', 0);
});
it('detener el reconocimiento descarta resultados tardíos del turno cancelado', async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  const onFinal = vi.fn();
  const stt = new ServerStt({ baseUrl: 'http://localhost:9999/v1', model: 'prueba' }, { onFinal });
  stt.setListening(true, 0);
  stt.feed(new Float32Array(16000).fill(0.05), 16000, 0);
  const pending = stt.flush();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  stt.stop();
  resolve(new Response(JSON.stringify({ text: 'Resultado obsoleto.' })));
  await pending;
  expect(onFinal).not.toHaveBeenCalled();
});
