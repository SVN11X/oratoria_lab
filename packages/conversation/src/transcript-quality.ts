/** Señal de revisión, no una estimación de exactitud ni un corrector del texto reconocido. */
export function transcriptQuality(text: string): { review: boolean; reason: string } {
  const words = text.toLocaleLowerCase('es').match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < 40) return { review: false, reason: '' };
  // Detecta bucles consecutivos largos. Repeticiones breves o términos técnicos recurrentes
  // no bastan para bloquear una respuesta. El texto original siempre queda disponible.
  for (let size = 1; size <= 12; size++) {
    for (let start = 0; start + size * 8 <= words.length; start++) {
      let end = start + size;
      while (end < words.length && words[end] === words[start + ((end - start) % size)]) end++;
      const span = end - start;
      if (span >= Math.max(40, size * 8) && span / words.length >= 0.2)
        return {
          review: true,
          reason:
            'La transcripción contiene un bucle largo de palabras repetidas. Revisa el texto antes de enviarlo; podría ser un error del reconocimiento.',
        };
      start = Math.max(start, end - size * 8);
    }
  }
  return { review: false, reason: '' };
}

export class TranscriptReviewRequired extends Error {
  constructor() {
    super('Revisa la transcripción repetitiva antes de continuar.');
    this.name = 'TranscriptReviewRequired';
  }
}
