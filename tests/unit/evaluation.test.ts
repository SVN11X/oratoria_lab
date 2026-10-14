import { describe, expect, it } from 'vitest';
import {
  TranscriptSchema,
  SessionSchema,
  newSession,
  type Transcript,
  type Evaluation,
} from '@oratoria/core';
import { analyzeText, validateRatings, INITIAL_RUBRICS, scoreEvaluation } from '@oratoria/evaluation';
import { parseWhisperResult } from '@oratoria/transcription';
function transcript(text: string): Transcript {
  return {
    source: 'manual',
    model: null,
    language: 'es',
    revision: 1,
    updatedAt: new Date().toISOString(),
    segments: [{ id: 's1', text, start: null, end: null }],
  };
}
describe('Métricas de transcripción y trazabilidad', () => {
  it('preserva la ñ como letra distinta al normalizar acentos vocálicos', () => {
    const a = analyzeText(transcript('año año año ano ano ano'), null);
    expect(a.repeatedTerms).toContainEqual(['año', 3]);
    expect(a.repeatedTerms).toContainEqual(['ano', 3]);
  });
  it('el contexto de una pregunta no se cuenta como respuesta del usuario', () => {
    const t = transcript('respuesta real');
    t.segments[0]!.prompt = 'Una pregunta larga que no es la respuesta';
    expect(analyzeText(t, null).words).toBe(2);
  });
  it('usa palabras completas para candidatos a muletilla', () => {
    const t = analyzeText(transcript('Eh, este estudio estelar, o sea, claro.'), 60);
    expect(t.words).toBe(7);
    expect(t.wordsPerMinute).toBe(7);
    expect(t.fillerCandidates.map((f) => f.term)).toEqual(['eh', 'este', 'o sea']);
  });
  it('normaliza tildes y mayúsculas sin crear tiempos', () => {
    const a = analyzeText(transcript('DIGAMOS digámos ejemplo.'), null);
    expect(a.fillerCandidates).toHaveLength(2);
    expect(a.fillerCandidates[0]?.start).toBeNull();
    expect(a.wordsPerMinute).toBeNull();
  });
  it('no calcula velocidad sin audio o texto suficiente', () => {
    expect(analyzeText(transcript(''), 20).wordsPerMinute).toBeNull();
    expect(analyzeText(transcript('hola'), 0).wordsPerMinute).toBeNull();
  });
  it('permite un diccionario regional propio', () => {
    const a = analyzeText(transcript('Cachái, cachai, ejemplo.'), 60, ['cachái']);
    expect(a.fillerCandidates).toHaveLength(2);
  });
  it('excluye palabras funcionales del listado de repetición', () => {
    const a = analyzeText(transcript('robot y robot y robot y'), 60);
    expect(a.repeatedTerms).toEqual([['robot', 3]]);
  });
  it('rechaza citas inventadas en una valoración', () => {
    const rubric = INITIAL_RUBRICS[0]!;
    const errors = validateRatings(
      [
        {
          criterionId: rubric.criteria[0]!.id,
          level: 3,
          quote: 'contenido inexistente',
          segmentId: 's1',
          note: '',
        },
      ],
      rubric,
      transcript('Evidencia real'),
    );
    expect(errors).not.toHaveLength(0);
  });
  it('acepta citas exactas y rechaza criterios duplicados', () => {
    const rubric = INITIAL_RUBRICS[0]!,
      rating = {
        criterionId: rubric.criteria[0]!.id,
        level: 2,
        quote: 'Evidencia real',
        segmentId: 's1',
        note: 'Vínculo parcial',
      };
    expect(validateRatings([rating], rubric, transcript('Evidencia real aquí'))).toEqual([]);
    expect(validateRatings([rating, rating], rubric, transcript('Evidencia real aquí'))).not.toHaveLength(0);
  });
  it('exige justificar el nivel aunque la cita sea real', () => {
    const rubric = INITIAL_RUBRICS[0]!;
    expect(
      validateRatings(
        [{ criterionId: rubric.criteria[0]!.id, level: 3, quote: 'texto', segmentId: 's1', note: '' }],
        rubric,
        transcript('texto'),
      ),
    ).not.toHaveLength(0);
  });
  it('excluye no evaluables y muestra cobertura', () => {
    const rubric = INITIAL_RUBRICS[0]!;
    const e: Evaluation = {
      method: 'manual-evidence-1.0.0',
      rubric,
      transcriptRevision: 1,
      createdAt: new Date().toISOString(),
      ratings: rubric.criteria.map((c, i) => ({
        criterionId: c.id,
        level: i === 0 ? 3 : i === 1 ? 0 : null,
        segmentId: null,
        quote: '',
        note: '',
      })),
    };
    expect(scoreEvaluation(e).percent).toBe(50);
    expect(scoreEvaluation(e).coverage).toBe(0.5);
    expect(scoreEvaluation({ ...e, ratings: [] }).percent).toBeNull();
  });
  it('valida la simetría y orden de tiempos manuales', () => {
    const t = transcript('texto');
    t.segments[0]!.start = 2;
    expect(TranscriptSchema.safeParse(t).success).toBe(false);
    t.segments[0]!.end = 1;
    expect(TranscriptSchema.safeParse(t).success).toBe(false);
  });
  it('no crea marcas para un resultado de Whisper sin timestamps', () => {
    const t = parseWhisperResult({ text: 'Texto real.' }, 10);
    expect(t.segments[0]?.text).toBe('Texto real.');
    expect(t.segments[0]?.start).toBeNull();
  });
  it('conserva marcas entregadas por el modelo dentro del audio', () => {
    const t = parseWhisperResult({ text: 'hola', chunks: [{ text: 'hola', timestamp: [1, 2] }] }, 3);
    expect(t.segments[0]?.start).toBe(1);
    expect(t.segments[0]?.end).toBe(2);
  });
  it('rechaza sesiones con metadatos estructuralmente inválidos', () => {
    const s = newSession();
    expect(SessionSchema.safeParse({ ...s, id: '../../x' }).success).toBe(false);
  });
});
