import { fullText, type Session } from '@oratoria/core';
import { analyzeText, DEFAULT_FILLERS } from '@oratoria/evaluation';
export * from './backup';

export function safeFilename(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 80) || 'oratoria'
  );
}
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  const firstMeaningful = [...s].find((c) => c.charCodeAt(0) > 32 && c.trim().length > 0);
  if (
    typeof value === 'string' &&
    (['=', '+', '-', '@'].includes(firstMeaningful ?? '') || /^[\t\r\n]/.test(s))
  )
    s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
export function sessionJSON(session: Session, fillers = DEFAULT_FILLERS): string {
  return JSON.stringify(
    {
      exportMethod: 'oratoria-export-1.0.0',
      audioIncluded: false,
      session,
      textAnalysis: session.transcript
        ? analyzeText(session.transcript, session.audio?.duration ?? null, fillers)
        : null,
      fillerDictionary: session.transcript ? fillers : null,
    },
    null,
    2,
  );
}
export function sessionTXT(session: Session): string {
  return fullText(session.transcript);
}
export function sessionCSV(session: Session, fillers = DEFAULT_FILLERS): string {
  const text = session.transcript
    ? analyzeText(session.transcript, session.audio?.duration ?? null, fillers)
    : null;
  const rows: [string, unknown, string][] = [
    ['sesion', session.title, 'metadatos'],
    ['fecha', session.createdAt, 'metadatos'],
  ];
  if (session.audio) {
    const a = session.audio;
    rows.push(
      ['metodologia_audio', a.methodology, 'audio'],
      ['duracion_segundos', a.duration, 'audio'],
      ['actividad_estimada_segundos', a.activeSeconds, 'audio'],
      ['silencio_segundos', a.silenceSeconds, 'audio'],
      ['pausas_internas', a.pauses.length, 'audio'],
      ['pausa_promedio_segundos', a.meanPause, 'audio'],
      ['nivel_rms_dbfs', a.meanDbfs, 'audio'],
      ['variacion_relativa', a.variation, 'audio'],
      ['f0_mediana_hz', a.pitchMedianHz, 'audio'],
      ['umbral_dbfs', a.thresholdDbfs, 'audio'],
    );
  }
  if (text)
    rows.push(
      ['metodologia_texto', text.method, 'transcripcion'],
      ['palabras', text.words, 'transcripcion'],
      ['palabras_por_minuto_total', text.wordsPerMinute, 'transcripcion'],
      ['candidatos_muletilla', text.fillerCandidates.length, 'transcripcion'],
      ['candidatos_por_100_palabras', text.fillersPer100Words, 'transcripcion'],
    );
  return (
    '\uFEFF' + [['metrica', 'valor', 'origen'], ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  );
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function exportSession(session: Session, format: 'json' | 'csv' | 'txt', fillers = DEFAULT_FILLERS) {
  const data =
    format === 'json'
      ? sessionJSON(session, fillers)
      : format === 'csv'
        ? sessionCSV(session, fillers)
        : sessionTXT(session);
  downloadBlob(
    new Blob([data], {
      type:
        format === 'json'
          ? 'application/json'
          : format === 'csv'
            ? 'text/csv;charset=utf-8'
            : 'text/plain;charset=utf-8',
    }),
    `${safeFilename(session.title)}.${format}`,
  );
}
