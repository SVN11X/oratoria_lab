import { describe, expect, it } from 'vitest';
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
import { makeDocx, makePdf, makePptx } from '../fixtures/office';

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
