import { describe, expect, it } from 'vitest';
import {
  keyTerms,
  fallbackQuestions,
  fallbackFollowUp,
  fallbackInterruption,
  countHedges,
  headAngles,
  classifyFace,
  classifyPose,
  nextAttention,
  buildReport,
  priorities,
  pitchSpread,
  longSilences,
  parseQuestions,
  parseAnswer,
  parseContent,
  extractJson,
  questionsPrompt,
  reportText,
  seeded,
  type Tick,
} from '@oratoria/defense';

const SUMMARY =
  'Este trabajo desarrolla un robot de navegación autónoma con ROS 2. El robot usa un sensor LiDAR para construir un mapa de ocupación. La navegación autónoma se evalúa en pasillos y el mapa de ocupación se compara con mediciones manuales. El sensor LiDAR entrega datos ruidosos en superficies de vidrio.';
const tick = (t: number, p: Partial<Tick> = {}): Tick => ({
  t,
  seconds: 1,
  phase: 'exposicion',
  speaking: 0.8,
  db: -25,
  nearThreshold: 0.1,
  pitch: [],
  clipped: false,
  face: null,
  contact: null,
  down: null,
  smile: null,
  pose: null,
  handsVisible: null,
  handsMoving: null,
  touchFace: null,
  tilt: null,
  midX: null,
  shoulderW: null,
  ...p,
});

describe('Términos y preguntas sin IA', () => {
  it('extrae siglas y expresiones repetidas sin palabras vacías', () => {
    const terms = keyTerms(SUMMARY, 6);
    expect(terms).toContain('LiDAR');
    expect(terms).toContain('ROS');
    expect(terms.some((t) => t.includes('mapa de ocupación'))).toBe(true);
    expect(terms.some((t) => /^(este|trabajo|robot)$/.test(t))).toBe(false);
  });
  it('genera la cantidad pedida, sin repetir y repartida entre los tres integrantes', () => {
    const q = fallbackQuestions({ text: SUMMARY, count: 6, difficulty: 'estandar', seed: 3 });
    expect(q).toHaveLength(6);
    expect(new Set(q.map((x) => x.text)).size).toBe(6);
    expect(new Set(q.map((x) => x.member))).toEqual(new Set([0, 1, 2]));
    expect(q.some((x) => x.source === 'tema')).toBe(true);
    expect(
      fallbackQuestions({ text: '', count: 4, difficulty: 'amable' }).every((x) => x.source === 'banco'),
    ).toBe(true);
  });
  it('es reproducible con la misma semilla', () => {
    const a = fallbackQuestions({ text: SUMMARY, count: 5, difficulty: 'exigente', seed: 9 });
    const b = fallbackQuestions({ text: SUMMARY, count: 5, difficulty: 'exigente', seed: 9 });
    expect(a).toEqual(b);
  });
  it('repregunta por reglas según brevedad, dudas y nivel', () => {
    const rng = seeded(1);
    expect(fallbackFollowUp('Sí, porque sí.', 'estandar', rng)).toMatch(/breve/);
    expect(
      fallbackFollowUp(
        'Creo que funciona, tal vez porque el mapa es bueno y la prueba salió bien en general.',
        'estandar',
        rng,
      ),
    ).toMatch(/dudas/);
    expect(
      fallbackFollowUp(
        'Elegí ese método porque reduce el error medido en las pruebas del pasillo principal.',
        'amable',
        rng,
      ),
    ).toBeNull();
    expect(fallbackInterruption('el filtro de partículas y el filtro de partículas', seeded(2))).toMatch(
      /interrump|Perdón/,
    );
  });
  it('cuenta expresiones de duda como frases completas', () => {
    expect(countHedges('Creo que sí. No sé si quizás funcione. Creo.').total).toBe(3);
  });
});

describe('Señales de cámara', () => {
  it('obtiene ángulos de una rotación conocida', () => {
    const a = (30 * Math.PI) / 180;
    // Rotación de 30° en Y, matriz por columnas.
    const m = [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
    expect(Math.abs(headAngles(m).yaw)).toBeCloseTo(30, 5);
    expect(Math.abs(headAngles(m).pitch)).toBeCloseTo(0, 5);
  });
  it('separa contacto, mirada abajo y rostro girado', () => {
    expect(classifyFace({}, { yaw: 5, pitch: 3 }).contact).toBe(true);
    expect(classifyFace({ eyeLookDownLeft: 0.8, eyeLookDownRight: 0.7 }, { yaw: 0, pitch: 0 })).toMatchObject(
      {
        contact: false,
        down: true,
      },
    );
    expect(classifyFace({}, { yaw: 40, pitch: 0 }).contact).toBe(false);
  });
  it('detecta movimiento de manos y mano en la cara en anchos de hombro', () => {
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
    lm[0] = { x: 0.5, y: 0.3, visibility: 1 };
    lm[11] = { x: 0.4, y: 0.6, visibility: 1 };
    lm[12] = { x: 0.6, y: 0.6, visibility: 1 };
    lm[15] = { x: 0.52, y: 0.35, visibility: 1 };
    const first = classifyPose(lm, null)!;
    expect(first.touchFace).toBe(true);
    expect(first.tilt).toBeCloseTo(0, 5);
    expect(first.handsMoving).toBe(false);
    lm[15] = { x: 0.3, y: 0.7, visibility: 1 };
    const second = classifyPose(lm, first.wrists)!;
    expect(second.handsMoving).toBe(true);
    expect(second.touchFace).toBe(false);
    lm[11] = { x: 0.4, y: 0.6, visibility: 0.1 };
    expect(classifyPose(lm, null)).toBeNull();
  });
  it('mantiene la atención simulada entre 0 y 100', () => {
    let a = 70;
    for (let i = 0; i < 200; i++)
      a = nextAttention(a, { speaking: 0, silenceSeconds: 10, contact: 0, fillersRecent: 4, wpm: 200 });
    expect(a).toBe(0);
    for (let i = 0; i < 400; i++)
      a = nextAttention(a, { speaking: 1, silenceSeconds: 0, contact: 1, fillersRecent: 0, wpm: 140 });
    expect(a).toBeGreaterThan(70);
    expect(a).toBeLessThanOrEqual(100);
  });
});

describe('Informe de la defensa', () => {
  it('mide silencios largos y variación de tono', () => {
    const ticks = [
      tick(0),
      tick(1, { speaking: 0 }),
      tick(2, { speaking: 0 }),
      tick(3, { speaking: 0 }),
      tick(4, { speaking: 0 }),
      tick(5),
    ];
    expect(longSilences(ticks)).toBe(1);
    expect(pitchSpread(Array(40).fill(150))!.semitones).toBe(0);
    const varied = Array.from({ length: 60 }, (_, i) => 150 * 2 ** ((i % 2 ? 3 : -3) / 12));
    expect(pitchSpread(varied)!.semitones).toBeGreaterThan(2.9);
    expect(pitchSpread([100, 200])).toBeNull();
  });
  it('construye hallazgos y prioridades con datos sintéticos conocidos', () => {
    const ticks: Tick[] = [];
    for (let t = 0; t < 300; t++)
      ticks.push(
        tick(t, {
          speaking: t % 50 < 44 ? 0.9 : 0,
          pitch: [150, 152],
          face: 1,
          contact: t % 10 < 3 ? 1 : 0,
          down: t % 10 >= 3 ? 1 : 0,
          smile: 0,
          pose: 1,
          handsVisible: 1,
          handsMoving: 0.3,
          touchFace: 0,
          tilt: 2,
          midX: 0.5,
          shoulderW: 0.2,
        }),
      );
    for (let t = 300; t < 340; t++) ticks.push(tick(t, { phase: t < 305 ? 'pregunta' : 'respuesta' }));
    const words = (n: number) => Array.from({ length: n }, () => 'palabra').join(' ');
    const report = buildReport({
      id: 'r1',
      createdAt: '2026-10-17T12:00:00.000Z',
      title: 'Prueba',
      difficulty: 'estandar',
      mode: 'completa',
      targetMinutes: 5,
      transcriptUsed: true,
      ticks,
      chunks: [
        { text: `${words(900)} o sea o sea o sea este bueno`, t: 10, phase: 'exposicion' },
        {
          text: 'creo que tal vez no sé si funciona bien en todos los casos que probé',
          t: 320,
          phase: 'respuesta',
        },
      ],
      answers: [
        {
          member: 1,
          kind: 'pregunta',
          question: '¿Cómo validó?',
          source: 'banco',
          askedAt: 305,
          startedAt: 313,
          endedAt: 339,
          text: 'creo que tal vez no sé si funciona bien en todos los casos que probé, creo que en el pasillo principal sí funcionó bastante bien',
          feedback: null,
        },
      ],
    });
    const byId = Object.fromEntries(report.findings.map((f) => [f.id, f]));
    expect(byId.tiempo!.level).toBe('fortaleza');
    expect(byId.ritmo!.level).toBe('mejorar');
    expect(report.exposition.wpm).toBeCloseTo((908 * 60) / 300, 5);
    expect(byId.contacto!.level).toBe('mejorar');
    expect(byId.contacto!.explanation).toMatch(/abajo/);
    expect(byId.entonacion!.level).toBe('mejorar');
    expect(byId.latencia!.level).toBe('mejorar');
    expect(byId.seguridad!.level).toBe('mejorar');
    expect(byId.expresion!.level).toBe('adecuado');
    expect(report.exposition.topFillers[0]).toEqual(['o sea', 3]);
    expect(priorities(report)[0]!.id).toBe('contacto');
    expect(report.timeline.length).toBe(12);
    expect(reportText(report)).toContain('PRIORIDADES PARA MEJORAR');
  });
  it('no inventa mediciones cuando faltan cámara y transcripción', () => {
    const report = buildReport({
      id: 'r2',
      createdAt: '2026-10-17T12:00:00.000Z',
      title: 'Sin datos',
      difficulty: 'amable',
      mode: 'preguntas',
      targetMinutes: 10,
      transcriptUsed: false,
      ticks: Array.from({ length: 30 }, (_, t) => tick(t, { phase: 'respuesta' })),
      chunks: [],
      answers: [],
    });
    expect(report.findings.map((f) => f.id)).not.toContain('contacto');
    expect(report.findings.map((f) => f.id)).not.toContain('ritmo');
    expect(report.notes.join(' ')).toMatch(/Sin cámara/);
  });
});

describe('Respuestas del modelo de lenguaje', () => {
  it('valida preguntas y descarta texto alrededor del JSON', () => {
    const q = parseQuestions(
      'Aquí van:\n```json\n{"preguntas":[{"integrante":"1","pregunta":"¿Por qué eligió ROS 2?"},{"integrante":2,"pregunta":"¿Qué limitaciones tiene?"}]}\n```',
      1,
    );
    expect(q).toEqual([{ member: 1, text: '¿Por qué eligió ROS 2?', kind: 'pregunta', source: 'ia' }]);
    expect(() => parseQuestions('{"preguntas":[{"integrante":5,"pregunta":"¿Algo largo?"}]}', 3)).toThrow();
    expect(() => extractJson('sin json')).toThrow(/JSON/);
  });
  it('normaliza repreguntas nulas y valida el comentario de contenido', () => {
    expect(parseAnswer('{"comentario":"Bien.","repregunta":"null","calidad":3}').followUp).toBeNull();
    expect(
      parseAnswer('{"comentario":"Faltó evidencia.","repregunta":"¿Qué dato lo respalda?"}').followUp,
    ).toBe('¿Qué dato lo respalda?');
    expect(
      parseContent(
        '{"resumen":"Clara.","fortalezas":["Objetivo"],"mejoras":[],"estructura":{"metodologia":false}}',
      ).estructura.metodologia,
    ).toBe(false);
  });
  it('incluye la comisión, el nivel y el formato en la indicación', () => {
    const [sys, user] = questionsPrompt({
      title: 'T',
      summary: SUMMARY,
      exposition: '',
      count: 4,
      difficulty: 'exigente',
    });
    expect(sys!.content).toContain('Profesor informante');
    expect(sys!.content).toContain('Exigente');
    expect(user!.content).toContain('"preguntas"');
    expect(user!.content).toContain('4 preguntas');
  });
});
