import { extractFile, segment, prepareAcademicProfile, type Extracted } from '@oratoria/knowledge';

self.onmessage = async (
  event: MessageEvent<{
    doc: { id: string; name: string };
    type: string;
    bytes?: Uint8Array;
    extracted?: Extracted;
  }>,
) => {
  try {
    const { doc, type, bytes } = event.data;
    const extracted = event.data.extracted ?? (await extractFile({ name: doc.name, type, bytes: bytes! }));
    self.postMessage({ phase: 'segmentando', detail: `${extracted.blocks.length} bloques` });
    const chunks = segment(doc, extracted);
    self.postMessage({ phase: 'preparando', detail: `${chunks.length} fragmentos` });
    const academicProfile = prepareAcademicProfile(chunks);
    self.postMessage({ result: { extracted, chunks, academicProfile } });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'No se pudo procesar el archivo.' });
  }
};
