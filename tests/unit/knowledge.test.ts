import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  KnowledgeIndex,
  comparePresentation,
  extractDocx,
  extractFile,
  extractPptx,
  extractText,
  segment,
  tokenize,
  type PdfJs,
} from '@oratoria/knowledge';

/** PDF mínimo válido escrito a mano (Helvetica, WinAnsi) para probar la extracción real con pdf.js. */
export function makePdf(pages: { size: number; text: string }[][]): Uint8Array {
  const esc = (s: string) =>
    [...s]
      .map((ch) => {
        const c = ch.charCodeAt(0);
        if (ch === '(' || ch === ')' || ch === '\\') return `\\${ch}`;
        return c > 126 ? `\\${c.toString(8).padStart(3, '0')}` : ch;
      })
      .join('');
  const objects: string[] = [];
  const pageIds: number[] = [];
  const font = 3 + pages.length * 2;
  pages.forEach((lines, p) => {
    const pageId = 3 + p * 2,
      contentId = pageId + 1;
    pageIds.push(pageId);
    let y = 740;
    const stream = lines
      .map((l) => {
        const s = `BT /F1 ${l.size} Tf 60 ${y} Td (${esc(l.text)}) Tj ET`;
        y -= l.size * 1.6;
        return s;
      })
      .join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[font] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
export function makeDocx(paragraphs: { text: string; style?: string }[]): Uint8Array {
  const body = paragraphs
    .map(
      (p) =>
        `<w:p>${p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${p.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`,
    )
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    'word/document.xml': strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Error</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>4,2 cm</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    ),
  });
}
export function makePptx(
  slides: { title: string; body: string[]; notes?: string }[],
  reverse = false,
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'ppt/presentation.xml': strToU8(
      `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>${(reverse ? (a: string[]) => a.reverse() : (a: string[]) => a)(slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)).join('')}</p:sldIdLst></p:presentation>`,
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(
      `<Relationships>${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`,
    ),
  };
  slides.forEach((s, i) => {
    const sp = (ph: string, paras: string[]) =>
      `<p:sp>${ph}<p:txBody>${paras.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(
      `<p:sld><p:cSld><p:spTree>${sp('<p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>', [s.title])}${sp('', s.body)}</p:spTree></p:cSld></p:sld>`,
    );
    if (s.notes) {
      files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(
        `<Relationships><Relationship Id="rId9" Target="../notesSlides/notesSlide${i + 1}.xml"/></Relationships>`,
      );
      files[`ppt/notesSlides/notesSlide${i + 1}.xml`] = strToU8(
        `<p:notes><p:cSld><p:spTree>${sp('', [s.notes, String(i + 1)])}</p:spTree></p:cSld></p:notes>`,
      );
    }
  });
  return zipSync(files);
}

const LONG = 'El robot navega por pasillos del laboratorio usando un mapa de ocupación. '.repeat(40);

describe('Extracción de documentos', () => {
  it('lee un PDF real con pdf.js, detecta páginas y secciones numeradas', async () => {
    const pdf = makePdf([
      [
        { size: 18, text: '3.2 Metodología' },
        { size: 11, text: 'Se utilizó un sensor LiDAR de 360 grados para construir el mapa.' },
        { size: 11, text: 'Se eligió Cartographer frente a GMapping por su menor deriva.' },
      ],
      [
        { size: 18, text: '4.1 Resultados' },
        { size: 11, text: 'El error de posición fue de 4,2 cm en promedio en 30 pruebas.' },
      ],
    ]);
    const r = await extractFile(
      { name: 'tesis.pdf', type: 'application/pdf', bytes: pdf },
      { pdfjs: pdfjs as unknown as PdfJs },
    );
    expect(r.pages).toBe(2);
    const heads = r.blocks.filter((b) => b.isHeading).map((b) => b.text);
    expect(heads).toEqual(['3.2 Metodología', '4.1 Resultados']);
    const result = r.blocks.find((b) => b.text.includes('4,2 cm'))!;
    expect(result.page).toBe(2);
    expect(result.heading).toBe('4.1 Resultados');
    const chunks = segment({ id: 'd', name: 'tesis.pdf' }, r);
    expect(chunks.find((c) => c.text.includes('4,2 cm'))!.location).toBe('pág. 2 · 4.1 Resultados');
  });
  it('avisa cuando un PDF no tiene texto (escaneado) en lugar de inventarlo', async () => {
    const r = await extractFile(
      { name: 'scan.pdf', bytes: makePdf([[]]) },
      { pdfjs: pdfjs as unknown as PdfJs },
    );
    expect(r.blocks).toEqual([]);
    expect(r.warnings.join(' ')).toContain('escaneado');
  });
  it('lee DOCX con estilos de título en inglés y español, y tablas', () => {
    const r = extractDocx(
      makeDocx([
        { text: 'Capítulo 3: Metodología', style: 'Heading1' },
        { text: 'El sistema usa ROS 2 & un LiDAR.' },
        { text: 'Resultados', style: 'Ttulo1' },
        { text: 'El error fue bajo.' },
      ]),
    );
    expect(r.blocks.filter((b) => b.isHeading).map((b) => b.text)).toEqual([
      'Capítulo 3: Metodología',
      'Resultados',
    ]);
    expect(r.blocks.find((b) => b.text.includes('ROS 2 & un LiDAR'))!.heading).toBe(
      'Capítulo 3: Metodología',
    );
    expect(r.blocks.some((b) => b.text.includes('Error | 4,2 cm'))).toBe(true);
  });
  it('lee PPTX en el orden de la presentación, con títulos y notas del orador', () => {
    const r = extractPptx(
      makePptx(
        [
          { title: 'Problema', body: ['Los robots se pierden en pasillos'] },
          { title: 'Resultados', body: ['Error de 5 cm'], notes: 'Recordar mencionar las 30 pruebas' },
        ],
        true,
      ),
    );
    expect(r.slides).toBe(2);
    // El orden lo define presentation.xml (aquí invertido a propósito).
    expect(r.blocks[0]!.text).toBe('Resultados');
    expect(r.blocks.find((b) => b.notes)!.text).toContain('30 pruebas');
    expect(r.blocks.find((b) => b.notes)!.text).not.toMatch(/\b2\b$/);
  });
  it('limpia LaTeX y Markdown conservando los encabezados', () => {
    const tex = extractText(
      '\\section{Introducción}\nEl \\textbf{robot} usa \\cite{x} un LiDAR. % comentario\n\\subsection{Objetivos}\nNavegar.',
      'tex',
    );
    expect(tex.blocks.map((b) => b.text)).toEqual([
      'Introducción',
      'El robot usa un LiDAR.',
      'Objetivos',
      'Navegar.',
    ]);
    const md = extractText('# Título\n\n- punto **uno**\n- punto dos', 'md');
    expect(md.blocks[1]!.text).toBe('punto uno punto dos');
  });
});

describe('Segmentación e índice', () => {
  it('no trunca: un texto de más de 20.000 caracteres se conserva completo en fragmentos', () => {
    const text = Array.from({ length: 60 }, (_, i) => `## Sección ${i}\n\n${LONG}`).join('\n\n');
    expect(text.length).toBeGreaterThan(20000);
    const r = extractText(text, 'md');
    const chunks = segment({ id: 'd', name: 'larga.md' }, r);
    const kept = chunks.map((c) => c.text).join(' ');
    for (let i = 0; i < 60; i++) expect(kept).toContain(`Sección ${i}`);
    expect(chunks.every((c) => c.text.length < 2000)).toBe(true);
    expect(new Set(chunks.map((c) => c.section)).size).toBe(60);
  });
  it('recupera el fragmento pertinente con BM25 y diversifica', () => {
    const r = extractText(
      '# Métodos\n\nSe eligió Cartographer frente a GMapping.\n\n# Resultados\n\nEl error de posición fue 4,2 cm.\n\n# Limitaciones\n\nNo se consideró el vidrio.',
      'md',
    );
    const index = new KnowledgeIndex(segment({ id: 'd', name: 'tesis.md' }, r));
    const hits = index.search('¿qué error de posición obtuvo?', { k: 2 });
    expect(hits[0]!.section).toBe('Resultados');
    expect(hits[0]!.chunkId).toBe(hits[0]!.id);
    expect(index.search('', { k: 3 })).toEqual([]);
  });
  it('usa embeddings cuando existen y los fusiona con BM25', () => {
    const chunks = segment(
      { id: 'd', name: 'x.md' },
      extractText('# A\n\nalpha uno\n\n# B\n\nbeta dos\n\n# C\n\ngamma tres', 'md'),
    );
    const vec = (i: number) => Float32Array.from([i === 2 ? 1 : 0, i === 2 ? 0 : 1]);
    const index = new KnowledgeIndex(chunks, new Map(chunks.map((c, i) => [c.id, vec(i)])));
    const hits = index.search('palabra sin coincidencia léxica', { k: 1, queryVector: [1, 0] });
    expect(hits[0]!.section).toBe('C');
  });
  it('normaliza tildes, plurales y palabras vacías', () => {
    expect(tokenize('Los Resultados de la Navegación')).toEqual(tokenize('resultado navegacion'));
  });
});

describe('Comparación presentación y documento', () => {
  it('detecta secciones ausentes, cifras distintas y diapositivas sin respaldo', () => {
    const doc = segment(
      { id: 't', name: 'tesis.md' },
      extractText(
        `# Metodología\n\nSe utilizó un sensor LiDAR y el algoritmo Cartographer para construir el mapa de ocupación del pasillo. ${'Detalle metodológico del LiDAR y Cartographer. '.repeat(12)}\n\n# Resultados\n\nEl error de posición del robot fue de 4,2 cm en promedio en el pasillo. ${'Análisis de resultados del error de posición. '.repeat(12)}\n\n# Trabajo futuro\n\nSe propone integrar visión estéreo y aprendizaje para superficies de vidrio. ${'Propuestas de trabajo futuro con visión estéreo. '.repeat(12)}`,
        'md',
      ),
    );
    const slides = segment(
      { id: 'p', name: 'pres.pptx' },
      extractPptx(
        makePptx([
          {
            title: 'Metodología',
            body: ['Sensor LiDAR y algoritmo Cartographer para el mapa de ocupación del pasillo'],
          },
          {
            title: 'Resultados',
            body: ['El error de posición del robot fue de 6 cm en promedio en el pasillo'],
          },
          {
            title: 'Mercado',
            body: [
              'Las ventas de helados crecieron mucho durante el verano en las playas de la costa central del país este año',
            ],
          },
        ]),
      ),
    );
    const { findings } = comparePresentation(doc, slides);
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toContain('cobertura');
    expect(findings.find((f) => f.kind === 'cobertura')!.text).toContain('Trabajo futuro');
    expect(findings.find((f) => f.kind === 'cifra_distinta')!.text).toContain('6 cm');
    expect(findings.find((f) => f.kind === 'sin_respaldo')!.slide).toBe(3);
  });
});
