import { describe, expect, it } from 'vitest';
import {
  SCENARIOS,
  SCENARIO_ORDER,
  TEMPERAMENTS,
  DIFFICULTIES,
  ConversationEngine,
  analyzeAnswer,
  civilityIssues,
  createParticipants,
  evaluateSession,
  evaluationPrompt,
  similarity,
  numericClaims,
  coachPlan,
  compareCriterion,
  seeded,
  stageIndex,
  type LlmPort,
  type RetrievedChunk,
  type SessionConfig,
  type Temperament,
  type ScenarioId,
} from '@oratoria/conversation';
import { buildReport } from '@oratoria/defense';

const CHUNKS: RetrievedChunk[] = [
  {
    docId: 'd1',
    docName: 'Tesis.pdf',
    chunkId: 'c1',
    location: 'pág. 41 · 3.2 Metodología',
    excerpt: '',
    text: 'Se utilizó un sensor LiDAR de 360 grados para construir el mapa de ocupación mediante SLAM. Se eligió Cartographer frente a GMapping por su menor deriva en pasillos largos.',
    score: 3,
  },
  {
    docId: 'd1',
    docName: 'Tesis.pdf',
    chunkId: 'c2',
    location: 'pág. 58 · 4.1 Resultados',
    excerpt: '',
    text: 'Los resultados muestran que el error de posición del robot fue de 4,2 cm en promedio en las 30 pruebas realizadas en el pasillo del laboratorio.',
    score: 2,
  },
  {
    docId: 'd1',
    docName: 'Tesis.pdf',
    chunkId: 'c3',
    location: 'pág. 71 · 5.2 Limitaciones',
    excerpt: '',
    text: 'Una limitación es que no se consideró el efecto de superficies de vidrio, que producen lecturas erróneas del LiDAR.',
    score: 1,
  },
];
const retrieve = async (q: string, k: number) =>
  CHUNKS.map((c) => ({ ...c, score: similarity(q, c.text) + c.score * 0.01 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

function config(scenario: ScenarioId = 'tesis', temperament?: Temperament, questions = 5): SessionConfig {
  const s = SCENARIOS[scenario];
  const roles = s.defaultRoles.map((id) => s.roles.find((r) => r.id === id)!);
  const participants = createParticipants(roles, 'avanzada', { academic: scenario === 'tesis', seed: 3 });
  if (temperament) participants.forEach((p) => (p.temperament = temperament));
  return {
    scenario,
    topic: 'Robot de navegación autónomo',
    context: {},
    participants,
    questions,
    progressive: true,
    followUps: true,
    interruptions: true,
    openingMinutes: s.opening.kind === 'ninguna' ? 0 : 5,
  };
}
const GOOD =
  'Elegimos Cartographer porque en las pruebas obtuvimos menor deriva que con GMapping. Por ejemplo, en el pasillo del laboratorio el error de posición fue de 4,2 cm en promedio en 30 pruebas, lo que permite navegar con seguridad.';
const WEAK = 'Bueno, es importante, depende de muchas cosas y en general funciona siempre bien.';

describe('Escenarios', () => {
  it('define seis prácticas con roles, áreas y criterios coherentes', () => {
    expect(SCENARIO_ORDER).toHaveLength(6);
    for (const id of SCENARIO_ORDER) {
      const s = SCENARIOS[id];
      expect(s.roles.length).toBeGreaterThan(0);
      for (const d of s.defaultRoles) expect(s.roles.some((r) => r.id === d)).toBe(true);
      const areaIds = new Set(s.areas.map((a) => a.id));
      for (const r of s.roles)
        for (const a of r.areas) expect(areaIds.has(a), `${id}/${r.id}/${a}`).toBe(true);
      expect(s.criteria.length).toBeGreaterThan(8);
      expect(s.criteria.some((c) => c.dimension === 'interpersonal')).toBe(true);
      expect(s.criteria.some((c) => c.dimension === 'vocal')).toBe(true);
      expect(new Set(s.criteria.map((c) => c.id)).size).toBe(s.criteria.length);
    }
  });
  it('la defensa cubre todas las áreas académicas pedidas', () => {
    const names = SCENARIOS.tesis.areas.map((a) => a.id);
    for (const a of [
      'problematizacion',
      'pregunta',
      'objetivos',
      'hipotesis',
      'justificacion',
      'marco',
      'estado_arte',
      'diseno',
      'muestreo',
      'instrumentos',
      'validez',
      'analisis',
      'resultados',
      'discusion',
      'limitaciones',
      'implicancias',
      'recomendaciones',
      'referencias',
    ])
      expect(names).toContain(a);
    expect(SCENARIOS.tesis.roles).toHaveLength(6);
  });
});

describe('Temperamento y dificultad', () => {
  it('son parámetros independientes: un profesor amable puede preguntar en nivel extremo', () => {
    const [p] = createParticipants([SCENARIOS.tesis.roles[0]!], 'extrema');
    p!.temperament = 'amable';
    expect(DIFFICULTIES[p!.difficulty].maxStage).toBe('integracion');
    expect(TEMPERAMENTS[p!.temperament].followUp).toBeLessThan(TEMPERAMENTS.desafiante.followUp);
  });
  it('nombres ficticios sin repetir', () => {
    const ps = createParticipants(SCENARIOS.tesis.roles, 'intermedia', { academic: true });
    expect(new Set(ps.map((p) => p.name)).size).toBe(ps.length);
  });
  it('detecta insultos y deja pasar objeciones académicas fuertes', () => {
    expect(civilityIssues('Eso es una afirmación, no una justificación. Defienda su decisión.')).toEqual([]);
    expect(civilityIssues('Su respuesta es ridícula y usted es un incompetente.').length).toBeGreaterThan(0);
  });
});

describe('Análisis de respuestas', () => {
  const q = '¿Por qué eligió Cartographer y qué alternativas descartó?';
  it('clasifica respuesta completa, sin sustento, reformulación y vacía', () => {
    expect(analyzeAnswer({ question: q, answer: GOOD, scenario: 'tesis' }).type).toBe('correcta');
    expect(analyzeAnswer({ question: q, answer: WEAK, scenario: 'tesis' }).type).toBe('sin_sustento');
    expect(
      analyzeAnswer({ question: q, answer: '¿Podría repetir la pregunta, por favor?', scenario: 'tesis' })
        .type,
    ).toBe('pide_reformulacion');
    expect(analyzeAnswer({ question: q, answer: '', scenario: 'tesis' }).type).toBe('sin_respuesta');
  });
  it('detecta cifras que contradicen el material', () => {
    const a = analyzeAnswer({
      question: '¿Cuál fue el error de posición?',
      answer: 'El error de posición del robot fue de 12 cm en promedio en las pruebas del pasillo.',
      scenario: 'tesis',
      retrieved: CHUNKS,
    });
    expect(a.type).toBe('contradice_documento');
    expect(a.contradictions[0]!.source).toContain('4,2');
    const ok = analyzeAnswer({
      question: '¿Cuál fue el error de posición?',
      answer: 'El error de posición fue de 4,2 cm en promedio.',
      scenario: 'tesis',
      retrieved: CHUNKS,
    });
    expect(ok.contradictions).toEqual([]);
  });
  it('extrae cifras con unidad e ignora años', () => {
    expect(numericClaims('En 2024 medimos 95 % de precisión y 3,5 segundos').map((c) => c.raw)).toEqual([
      '95 %',
      '3,5 segundos',
    ]);
  });
  it('marca STAR en entrevistas', () => {
    const a = analyzeAnswer({
      question: 'Cuénteme una situación difícil.',
      answer:
        'Cuando trabajaba en la empresa, mi tarea era migrar datos. Decidí automatizar el proceso y logramos reducir el tiempo en 40 %.',
      scenario: 'entrevista',
    });
    expect(a.markers).toEqual(expect.arrayContaining(['situación', 'tarea', 'acción', 'resultado']));
  });
});

async function runRules(cfg: SessionConfig, seed = 5, answers?: (i: number) => string) {
  const engine = new ConversationEngine(cfg, { retrieve, rng: seeded(seed) });
  const opening = await engine.start();
  expect(opening[0]!.kind).toBe('saludo');
  if (engine.status === 'exposition') {
    engine.addExposition('Mi tesis usa un sensor LiDAR y SLAM con Cartographer para navegar pasillos.', 10);
    const it = await engine.interruptExposition(
      'Usamos Cartographer y un LiDAR para el mapa de ocupación en el laboratorio.',
    );
    if (it) {
      expect(it.kind).toBe('interrupcion');
      const back = await engine.answer({ text: GOOD, durationSec: 20, latencySec: 1 });
      expect(back[0]!.kind).toBe('aviso');
      expect(engine.status).toBe('exposition');
    }
    await engine.endExposition();
  }
  let guard = 0;
  while (engine.status !== 'finished' && guard++ < 40) {
    const i = engine.turns.length;
    await engine.answer({ text: answers ? answers(i) : i % 2 ? WEAK : GOOD, durationSec: 30, latencySec: 2 });
  }
  return engine;
}

describe('Motor conversacional por reglas', () => {
  it('completa una defensa: preguntas, repreguntas del mismo profesor, cierre y sin repetir', async () => {
    const cfg = config('tesis', undefined, 5);
    const engine = await runRules(cfg);
    expect(engine.status).toBe('finished');
    const main = engine.moves.filter((m) => m.kind === 'pregunta');
    expect(main).toHaveLength(5);
    const asked = engine.moves
      .filter((m) => ['pregunta', 'repregunta'].includes(m.kind))
      .map((m) => m.core ?? m.text);
    for (let i = 0; i < asked.length; i++)
      for (let j = i + 1; j < asked.length; j++) expect(similarity(asked[i]!, asked[j]!)).toBeLessThan(0.6);
    for (let i = 1; i < engine.turns.length; i++) {
      const t = engine.turns[i]!;
      if (t.question.kind === 'repregunta')
        expect(t.question.speakerId).toBe(engine.turns[i - 1]!.question.speakerId);
    }
    expect(engine.moves.at(-1)!.kind).toBe('cierre');
    expect(engine.moves.every((m) => civilityIssues(m.text).length === 0)).toBe(true);
  });
  it('las preguntas citan el material cuando existe', async () => {
    const engine = await runRules(config('tesis', undefined, 6));
    const cited = engine.moves.filter((m) => m.sources.some((s) => s.docId === 'd1'));
    expect(cited.length).toBeGreaterThan(0);
    expect(cited[0]!.sources[0]!.location).toMatch(/pág\./);
  });
  it('la presión progresiva avanza de etapa', async () => {
    const engine = await runRules(config('tesis', 'cordial', 6), 9, () => GOOD);
    const stages = engine.moves.filter((m) => m.kind === 'pregunta').map((m) => stageIndex(m.stage));
    expect(stages[0]).toBeLessThanOrEqual(1);
    expect(Math.max(...stages)).toBeGreaterThanOrEqual(3);
  });
  it('un evaluador desafiante repregunta más que uno amable ante las mismas respuestas débiles', async () => {
    const count = async (t: Temperament) => {
      let n = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const e = await runRules({ ...config('tesis', t, 4), interruptions: false }, seed, () => WEAK);
        n += e.moves.filter((m) => m.kind === 'repregunta').length;
      }
      return n;
    };
    expect(await count('desafiante')).toBeGreaterThan(await count('amable'));
  });
  it('funciona en las seis prácticas', async () => {
    for (const id of SCENARIO_ORDER) {
      const engine = await runRules(config(id, undefined, 3));
      expect(engine.status, id).toBe('finished');
      expect(engine.moves.filter((m) => m.kind === 'pregunta').length, id).toBe(3);
    }
  });
  it('interrumpe una respuesta larga según la paciencia del temperamento', async () => {
    const make = async (t: Temperament) => {
      const e = new ConversationEngine({ ...config('tesis', t, 3), openingMinutes: 0 }, { rng: seeded(2) });
      await e.start();
      return e;
    };
    const tough = await make('desafiante'),
      kind = await make('amable');
    expect(tough.shouldInterruptAnswer(70, 'texto')?.kind).toBe('interrupcion');
    expect(kind.shouldInterruptAnswer(70, 'texto')).toBeNull();
    expect(kind.shouldInterruptAnswer(200, 'texto')?.kind).toBe('interrupcion');
  });
});

function mockLlm(
  responder: (messages: { role: string; content: string }[]) => string | Error,
): LlmPort & { calls: number } {
  const port = {
    model: 'modelo-de-prueba',
    calls: 0,
    async complete(messages: { role: string; content: string }[]) {
      port.calls++;
      const r = responder(messages);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return port;
}

describe('Motor con modelo de lenguaje (doble de prueba)', () => {
  it('usa preguntas válidas del modelo con sus fuentes y descarta las abusivas o repetidas', async () => {
    let n = 0;
    const llm = mockLlm((m) => {
      const user = m[1]!.content;
      if (user.includes('Formato exacto: {"pregunta"'))
        return n++ === 1
          ? JSON.stringify({ pregunta: 'Su trabajo es ridículo, ¿por qué lo hizo?', fuentes: [] })
          : JSON.stringify({
              pregunta: `¿Cómo justifica la decisión número ${n} usando la sección citada?`,
              fuentes: ['S1'],
              motivo: 'prueba',
            });
      return JSON.stringify({ tipo: 'parcial', reaccion: 'Gracias.', repregunta: null });
    });
    const engine = new ConversationEngine(
      { ...config('tesis', 'serio', 3), openingMinutes: 0 },
      { llm, retrieve, rng: seeded(1) },
    );
    const first = await engine.start();
    expect(first[1]!.generator).toBe('ia');
    expect(first[1]!.sources[0]!.docId).toBe('d1');
    await engine.answer({ text: GOOD, durationSec: 30, latencySec: 1 });
    const q2 = engine.moves.filter((m) => m.kind === 'pregunta')[1]!;
    expect(civilityIssues(q2.text)).toEqual([]);
    expect(engine.notes.join(' ')).toContain('Se descartó');
  });
  it('si el modelo falla, la práctica continúa con reglas y lo informa', async () => {
    const llm = mockLlm(() => new Error('conexión rechazada'));
    const engine = new ConversationEngine(
      { ...config('entrevista', undefined, 3), openingMinutes: 0 },
      { llm, rng: seeded(4) },
    );
    await engine.start();
    let guard = 0;
    while (engine.status !== 'finished' && guard++ < 20)
      await engine.answer({ text: GOOD, durationSec: 20, latencySec: 1 });
    expect(engine.status).toBe('finished');
    expect(engine.llmActive).toBe(false);
    expect(engine.notes.some((x) => x.includes('reglas'))).toBe(true);
    expect(engine.moves.every((m) => m.generator === 'reglas')).toBe(true);
  });
  it('acepta una repregunta del modelo y conserva la contradicción detectada por reglas', async () => {
    const llm = mockLlm((m) =>
      m[1]!.content.includes('"tipo"')
        ? JSON.stringify({
            tipo: 'correcta',
            reaccion: 'No me convence.',
            repregunta: '¿Por qué dice 12 cm si su documento indica otra cifra?',
          })
        : JSON.stringify({
            pregunta: '¿Cuál fue el error de posición del robot en el pasillo?',
            fuentes: ['S1'],
          }),
    );
    const engine = new ConversationEngine(
      { ...config('tesis', 'esceptico', 2), openingMinutes: 0 },
      { llm, retrieve, rng: seeded(3) },
    );
    await engine.start();
    const next = await engine.answer({
      text: 'El error de posición del robot fue de 12 cm en promedio en las pruebas del pasillo.',
      durationSec: 15,
      latencySec: 1,
    });
    expect(next[0]!.kind).toBe('repregunta');
    expect(next[0]!.generator).toBe('ia');
    expect(engine.turns[0]!.answer!.analysis.type).toBe('contradice_documento');
  });
});

describe('Evaluación justa y con evidencia', () => {
  const findings = () =>
    buildReport({
      id: 'x',
      createdAt: new Date().toISOString(),
      title: 't',
      difficulty: 'estandar',
      mode: 'preguntas',
      targetMinutes: 5,
      ticks: [],
      chunks: [],
      answers: [],
      transcriptUsed: true,
    }).findings;
  it('el temperamento no cambia la calificación por reglas', async () => {
    const levels = async (t: Temperament) => {
      const e = await runRules(
        { ...config('tesis', t, 4), followUps: false, interruptions: false },
        7,
        (i) => (i % 2 ? WEAK : GOOD),
      );
      return (await evaluateSession({ snapshot: e.snapshot(), findings: findings() })).criteria.map((c) => [
        c.id,
        c.level,
      ]);
    };
    expect(await levels('amable')).toEqual(await levels('desafiante'));
  });
  it('el prompt del evaluador no contiene el temperamento de los interlocutores', async () => {
    const e = await runRules({ ...config('tesis', 'desafiante', 2) }, 2);
    const p = evaluationPrompt({
      scenario: SCENARIOS.tesis,
      config: e.config,
      criteria: SCENARIOS.tesis.criteria,
      exposition: '',
      turns: [{ id: 'T1', question: 'q', answer: 'a' }],
      chunks: [],
    });
    const text = p.messages.map((m) => m.content).join(' ');
    expect(text).not.toContain(TEMPERAMENTS.desafiante.style);
    expect(text).not.toMatch(/Temperamento:/);
  });
  it('descarta valoraciones del modelo con citas inventadas y acepta las verificadas', async () => {
    const e = await runRules(
      { ...config('tesis', 'cordial', 2), followUps: false, interruptions: false },
      3,
      () => GOOD,
    );
    const llm = mockLlm(() =>
      JSON.stringify({
        criterios: [
          {
            id: 'fundamentacion',
            nivel: 3,
            evidencias: [{ turno: 'T1', cita: 'el error de posición fue de 4,2 cm en promedio' }],
            observacion: 'Usa datos.',
          },
          {
            id: 'pertinencia',
            nivel: 0,
            evidencias: [{ turno: 'T1', cita: 'una frase que nunca dijo la persona' }],
          },
        ],
      }),
    );
    const r = await evaluateSession({ snapshot: e.snapshot(), findings: findings(), llm });
    const fund = r.criteria.find((c) => c.id === 'fundamentacion')!;
    expect(fund.method).toBe('ia');
    expect(fund.level).toBe(3);
    const pert = r.criteria.find((c) => c.id === 'pertinencia')!;
    expect(pert.method).toBe('reglas');
    expect(r.notes.join(' ')).toContain('Se descartaron 1');
  });
  it('marca «No evaluado» cuando faltan datos, en vez de inventar un nivel', async () => {
    const e = await runRules({ ...config('tesis', 'cordial', 2) }, 3, () => GOOD);
    const r = await evaluateSession({ snapshot: e.snapshot(), findings: [] });
    const contacto = r.criteria.find((c) => c.id === 'contacto')!;
    expect(contacto.level).toBeNull();
    expect(contacto.methodText).toBe('No evaluado');
    expect(r.index!.coverage).toBeLessThan(100);
  });
  it('el entrenador propone ejercicios para criterios débiles y compara sesiones', async () => {
    const e = await runRules({ ...config('tesis', 'cordial', 4), followUps: false }, 3, () => WEAK);
    const r = await evaluateSession({ snapshot: e.snapshot(), findings: findings() });
    const plan = coachPlan(r.criteria);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0]!.verify.length).toBeGreaterThan(10);
    const c = r.criteria.find((x) => x.level !== null)!;
    expect(compareCriterion(c, { ...c, level: 3 })).toBe(c.level === 3 ? 'se mantiene' : 'mejoró');
    expect(compareCriterion(c, { ...c, level: null })).toBe('sin datos');
  });
});
