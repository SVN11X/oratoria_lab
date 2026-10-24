const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Comprobaciones parciales: no equivalen a verificar la verdad de toda una pregunta. */
export function unsupportedPremise(text: string, evidence: string): boolean {
  const hypothetical =
    /\b(?:supongamos|suponga|hipot[eé]tic[oa]|como alternativa|en un escenario|si (?:usara|utilizara|se empleara))\b/i.test(
      text,
    );
  if (!hypothetical) {
    const acronyms = text.match(/\b[A-Z][A-Z0-9-]{1,14}\b/g) ?? [];
    for (const token of acronyms) {
      if (/^(?:[IVXLCDM]+|[ST]\d+|OE\d+)$/.test(token)) continue;
      if (!new RegExp(`\\b${token}\\b`, 'i').test(evidence)) return true;
    }
  }
  const quoted = [...text.matchAll(/[«“']([^»”']{10,240})[»”']/g)];
  for (const match of quoted) {
    const prefix = text.slice(Math.max(0, match.index - 45), match.index);
    if (
      /(?:porque|afirma|dijo|mencion[aó]|admite|admiti[oó])[^.!?]*$/i.test(prefix) &&
      !fold(evidence).includes(fold(match[1]!))
    )
      return true;
  }
  return false;
}
