/** Lee registros completos, incluso si UTF-8 o una línea se divide entre paquetes de red. */
export async function readNdjson(
  body: ReadableStream<Uint8Array>,
  consume: (record: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  const abort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', abort, { once: true });
  const line = (value: string) => {
    if (!value.trim()) return;
    if (value.length > 131072) throw new Error('Un registro de Ollama supera el límite permitido.');
    let record: unknown;
    try {
      record = JSON.parse(value);
    } catch {
      throw new Error('Ollama envió un registro JSON incompleto o no válido.');
    }
    consume(record);
  };
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (buffer.length > 131072) throw new Error('Un registro de Ollama supera el límite permitido.');
    }
    line(buffer + decoder.decode());
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
