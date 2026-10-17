import { unzipSync, strFromU8 } from 'fflate';

/** Unidad de texto extraída con su ubicación de origen. */
export type Block = {
  text: string;
  page?: number;
  slide?: number;
  /** Encabezado vigente (sección) y su nivel, si se detectó. */
  heading?: string;
  level?: number;
  /** El bloque es en sí un encabezado. */
  isHeading?: boolean;
  /** Notas del orador (PPTX). */
  notes?: boolean;
};
export type Extracted = {
  format: 'pdf' | 'docx' | 'pptx' | 'txt' | 'md' | 'tex';
  blocks: Block[];
  pages: number | null;
  slides: number | null;
  warnings: string[];
};

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e]!);
}
const clean = (s: string) =>
  s
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

export function detectFormat(name: string, mime = ''): Extracted['format'] | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'docx';
  if (ext === 'pptx' || mime.includes('presentationml')) return 'pptx';
  if (ext === 'md' || ext === 'markdown' || mime === 'text/markdown') return 'md';
  if (ext === 'tex') return 'tex';
  if (ext === 'txt' || mime.startsWith('text/')) return 'txt';
  return null;
}

/* --------------------------------- Texto, Markdown, LaTeX --------------------------------- */
const LATEX_HEAD = /^\\(part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\{(.+)\}\s*$/;
const LATEX_LEVEL: Record<string, number> = {
  part: 1,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
};
function stripLatexInline(line: string): string {
  return line
    .replace(/(^|[^\\])%.*$/, '$1')
    .replace(/\\(textbf|textit|emph|underline|texttt|textsc|mathrm|text)\{([^}]*)\}/g, '$2')
    .replace(
      /\\(cite|ref|label|eqref|autoref|cref|footnote|url|href)\*?(\[[^\]]*\])?\{[^}]*\}(\{[^}]*\})?/g,
      '',
    )
    .replace(/\\(begin|end)\{[^}]*\}(\[[^\]]*\])?/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, ' ')
    .replace(/\$([^$]*)\$/g, '$1')
    .replace(/[{}]/g, ' ')
    .replace(/~/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function extractText(content: string, format: 'txt' | 'md' | 'tex'): Extracted {
  const blocks: Block[] = [];
  let heading: string | undefined, level: number | undefined;
  const paragraphs: string[] = [];
  const flush = () => {
    const t = clean(paragraphs.join(' '));
    paragraphs.length = 0;
    if (t) blocks.push({ text: t, heading, level });
  };
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let head: { text: string; level: number } | null = null;
    if (format === 'md') {
      const m = /^(#{1,6})\s+(.+)$/.exec(line);
      if (m) head = { text: m[2]!.replace(/[#*_`]+/g, '').trim(), level: m[1]!.length };
    } else if (format === 'tex') {
      const m = LATEX_HEAD.exec(line.trim());
      if (m) head = { text: stripLatexInline(m[2]!), level: LATEX_LEVEL[m[1]!] ?? 2 };
    } else {
      const m = /^((?:\d+\.)*\d+\.?)\s+([A-ZÁÉÍÓÚÑ][^.!?]{2,90})$/.exec(line.trim());
      if (m || /^(CAP[IÍ]TULO|ANEXO)\s+\w+/i.test(line.trim()))
        head = { text: line.trim(), level: m ? m[1]!.split('.').filter(Boolean).length : 1 };
    }
    if (head) {
      flush();
      heading = head.text;
      level = head.level;
      blocks.push({ text: head.text, heading, level, isHeading: true });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (format === 'tex') {
      if (
        /^\s*\\(documentclass|usepackage|newcommand|renewcommand|maketitle|tableofcontents|bibliographystyle|input|include)/.test(
          line,
        )
      )
        continue;
      const t = stripLatexInline(line);
      if (t) paragraphs.push(t);
    } else
      paragraphs.push(
        format === 'md' ? line.replace(/^[-*+]\s+|^\d+\.\s+/, '').replace(/[*_`]+/g, '') : line,
      );
  }
  flush();
  return { format, blocks, pages: null, slides: null, warnings: [] };
}

/* ------------------------------------------ DOCX ------------------------------------------ */
function docxParagraphText(p: string): string {
  let out = '';
  const rx = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
  for (let m = rx.exec(p); m; m = rx.exec(p))
    out += m[1] !== undefined ? decodeXml(m[1]) : m[0] === '<w:tab/>' ? ' ' : '\n';
  return out;
}
/** Detecta el nivel de encabezado por el estilo (Heading1, Ttulo1, Título 1) o el nivel de esquema. */
function docxHeadingLevel(p: string, styles: Map<string, number>): number | null {
  const outline = /<w:outlineLvl w:val="(\d)"/.exec(p);
  if (outline) return Number(outline[1]) + 1;
  const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1];
  if (!style) return null;
  if (styles.has(style)) return styles.get(style)!;
  const m = /^(?:heading|ttulo|titulo|título|encabezado)\s*(\d)$/i.exec(style.replace(/\s+/g, ''));
  if (m) return Number(m[1]);
  if (/^(title|ttulo|titulo)$/i.test(style)) return 1;
  return null;
}
export function extractDocx(bytes: Uint8Array): Extracted {
  const files = unzipSync(bytes, {
    filter: (f) => f.name === 'word/document.xml' || f.name === 'word/styles.xml',
  });
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('El archivo DOCX no contiene word/document.xml.');
  const styles = new Map<string, number>();
  const stylesXml = files['word/styles.xml'] ? strFromU8(files['word/styles.xml']) : '';
  for (const m of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const lvl = /<w:outlineLvl w:val="(\d)"/.exec(m[2]!);
    const name = /<w:name w:val="([^"]+)"/.exec(m[2]!)?.[1] ?? '';
    const n = /^(?:heading|título|titulo)\s*(\d)$/i.exec(name);
    if (lvl) styles.set(m[1]!, Number(lvl[1]) + 1);
    else if (n) styles.set(m[1]!, Number(n[1]));
  }
  const xml = strFromU8(doc);
  const body = xml.slice(xml.indexOf('<w:body'));
  const blocks: Block[] = [];
  let heading: string | undefined, level: number | undefined;
  // Tablas: cada fila se convierte en una línea con celdas separadas por «|».
  const rx = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g;
  for (let m = rx.exec(body); m; m = rx.exec(body)) {
    const chunk = m[0];
    if (chunk.startsWith('<w:tbl>')) {
      const rows = [...chunk.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) =>
        [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)]
          .map((c) =>
            clean(
              [...c[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => docxParagraphText(p[0])).join(' '),
            ),
          )
          .join(' | '),
      );
      const t = rows.filter(Boolean).join('\n');
      if (t) blocks.push({ text: `Tabla:\n${t}`, heading, level });
      continue;
    }
    const text = clean(docxParagraphText(chunk));
    if (!text) continue;
    const lv = docxHeadingLevel(chunk, styles);
    if (lv && text.length <= 200) {
      heading = text;
      level = lv;
      blocks.push({ text, heading, level, isHeading: true });
    } else blocks.push({ text, heading, level });
  }
  const warnings = ['Un DOCX no guarda números de página: las citas indican la sección.'];
  if (!blocks.length) warnings.push('No se encontró texto en el documento.');
  return { format: 'docx', blocks, pages: null, slides: null, warnings };
}

/* ------------------------------------------ PPTX ------------------------------------------ */
function slideParagraphs(xml: string): { title: string; body: string[] } {
  let title = '';
  const body: string[] = [];
  for (const sp of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const isTitle = /<p:ph[^>]*type="(title|ctrTitle)"/.test(sp[0]);
    const paras = [...sp[0].matchAll(/<a:p>[\s\S]*?<\/a:p>/g)]
      .map((p) => clean([...p[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1]!)).join('')))
      .filter(Boolean);
    if (isTitle && !title) title = paras.join(' ');
    else body.push(...paras);
  }
  // Tablas y otros objetos con texto fuera de formas.
  for (const tbl of xml.matchAll(/<a:tbl>[\s\S]*?<\/a:tbl>/g))
    for (const row of tbl[0].matchAll(/<a:tr[ >][\s\S]*?<\/a:tr>/g))
      body.push([...row[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1]!)).join(' | '));
  return { title, body };
}
export function extractPptx(bytes: Uint8Array): Extracted {
  const files = unzipSync(bytes, {
    filter: (f) =>
      /^ppt\/(slides\/slide\d+\.xml|notesSlides\/notesSlide\d+\.xml|presentation\.xml|_rels\/presentation\.xml\.rels|slides\/_rels\/slide\d+\.xml\.rels)$/.test(
        f.name,
      ),
  });
  const pres = files['ppt/presentation.xml'] ? strFromU8(files['ppt/presentation.xml']) : '';
  const rels = files['ppt/_rels/presentation.xml.rels']
    ? strFromU8(files['ppt/_rels/presentation.xml.rels'])
    : '';
  const target = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]),
  );
  let order = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map(
    (m) => `ppt/${target.get(m[1]!)?.replace(/^\/?(ppt\/)?/, '')}`,
  );
  const available = Object.keys(files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  if (!order.length || order.some((o) => !files[o]))
    order = available.sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const blocks: Block[] = [];
  order.forEach((path, i) => {
    const slide = i + 1;
    const { title, body } = slideParagraphs(strFromU8(files[path]!));
    const heading = title || `Diapositiva ${slide}`;
    if (title) blocks.push({ text: title, slide, heading, level: 1, isHeading: true });
    if (body.length) blocks.push({ text: body.join('\n'), slide, heading, level: 1 });
    const relPath = path.replace('slides/', 'slides/_rels/') + '.rels';
    const rel = files[relPath] ? strFromU8(files[relPath]) : '';
    const notesTarget = /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rel)?.[1];
    const notesXml = notesTarget ? files[`ppt/notesSlides/${notesTarget}`] : undefined;
    if (notesXml) {
      const notes = slideParagraphs(strFromU8(notesXml))
        .body.filter((t) => !/^\d+$/.test(t))
        .join('\n');
      if (notes.trim()) blocks.push({ text: notes, slide, heading, level: 1, notes: true });
    }
  });
  const warnings: string[] = [];
  if (!blocks.length)
    warnings.push('La presentación no tiene texto extraíble (puede estar hecha solo de imágenes).');
  return { format: 'pptx', blocks, pages: null, slides: order.length, warnings };
}

/* ------------------------------------------- PDF ------------------------------------------- */
/** Interfaz mínima de pdf.js que se usa; permite inyectar la versión de navegador o de Node. */
export type PdfJs = {
  getDocument: (src: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
    standardFontDataUrl?: string;
    verbosity?: number;
  }) => {
    promise: Promise<{
      numPages: number;
      getPage: (
        n: number,
      ) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }>; cleanup?: () => void }>;
    }>;
    destroy: () => Promise<void>;
  };
};
type PdfItem = { str: string; transform: number[]; height?: number; hasEOL?: boolean };
const NUMBERED_HEAD = /^((?:\d+\.){0,3}\d+)\.?\s+([A-ZÁÉÍÓÚÑ][^\n]{2,100})$/u;
const NAMED_HEAD =
  /^(CAP[IÍ]TULO\s+[\dIVXLC]+.*|ANEXO\s+[A-Z\d]+.*|INTRODUCCI[OÓ]N|CONCLUSI[OÓ]N(ES)?|RESUMEN|ABSTRACT|REFERENCIAS|BIBLIOGRAF[IÍ]A|AGRADECIMIENTOS|METODOLOG[IÍ]A|RESULTADOS|DISCUSI[OÓ]N|MARCO TE[OÓ]RICO|ESTADO DEL ARTE)$/iu;
export async function extractPdf(
  bytes: Uint8Array,
  pdfjs: PdfJs,
  onProgress?: (page: number, total: number) => void,
  standardFontDataUrl?: string,
): Promise<Extracted> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  });
  const pdf = await task.promise;
  const blocks: Block[] = [];
  const warnings: string[] = [];
  let heading: string | undefined, level: number | undefined;
  let emptyPages = 0;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items = (content.items as PdfItem[]).filter((i) => typeof i.str === 'string');
      // Reconstruye líneas por coordenada vertical.
      const lines: { y: number; h: number; text: string }[] = [];
      for (const it of items) {
        const y = Math.round(it.transform[5] ?? 0),
          h = Math.abs(it.height ?? it.transform[3] ?? 0);
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.y - y) <= Math.max(2, h * 0.4)) {
          last.text += (last.text.endsWith(' ') || it.str.startsWith(' ') ? '' : ' ') + it.str;
          last.h = Math.max(last.h, h);
        } else lines.push({ y, h, text: it.str });
      }
      const texts = lines
        .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
        .filter((l) => l.text);
      if (!texts.length) {
        emptyPages++;
        continue;
      }
      const heights = texts.map((l) => l.h).sort((a, b) => a - b);
      const body = heights[Math.floor(heights.length / 2)] || 10;
      let para: string[] = [];
      const flush = () => {
        const t = clean(para.join(' ').replace(/-\s+([a-záéíóúñ])/g, '$1'));
        para = [];
        if (t) blocks.push({ text: t, page: n, heading, level });
      };
      let prevY: number | null = null;
      for (const l of texts) {
        if (/^\d{1,4}$/.test(l.text) && (l === texts[texts.length - 1] || l === texts[0])) continue; // número de página
        const big = l.h >= body * 1.18;
        const numbered = NUMBERED_HEAD.exec(l.text);
        const isHead =
          l.text.length <= 110 &&
          !/[.,;:]$/.test(l.text) &&
          (NAMED_HEAD.test(l.text) ||
            (numbered && (big || l.text.split(' ').length <= 9)) ||
            (big && l.text.split(' ').length <= 12 && /^[A-ZÁÉÍÓÚÑ0-9]/.test(l.text)));
        if (isHead) {
          flush();
          heading = l.text;
          level = numbered ? numbered[1]!.split('.').length : 1;
          blocks.push({ text: l.text, page: n, heading, level, isHeading: true });
        } else {
          const gap = prevY !== null ? Math.abs(prevY - l.y) : 0;
          if (gap > body * 1.9) flush();
          para.push(l.text);
        }
        prevY = l.y;
      }
      flush();
      page.cleanup?.();
      onProgress?.(n, pdf.numPages);
    }
  } finally {
    await task.destroy();
  }
  if (emptyPages === pdf.numPages)
    warnings.push('El PDF no tiene texto seleccionable (parece escaneado). No se aplicó OCR.');
  else if (emptyPages) warnings.push(`${emptyPages} páginas no tienen texto seleccionable y se omitieron.`);
  return { format: 'pdf', blocks, pages: pdf.numPages, slides: null, warnings };
}

export async function extractFile(
  file: { name: string; type?: string; bytes: Uint8Array },
  options: {
    pdfjs?: PdfJs;
    onProgress?: (page: number, total: number) => void;
    standardFontDataUrl?: string;
  } = {},
): Promise<Extracted> {
  const format = detectFormat(file.name, file.type);
  if (!format) throw new Error(`Formato no admitido: ${file.name}. Usa PDF, DOCX, PPTX, TXT, MD o TEX.`);
  if (format === 'pdf') {
    if (!options.pdfjs) throw new Error('Falta el lector de PDF.');
    return extractPdf(file.bytes, options.pdfjs, options.onProgress, options.standardFontDataUrl);
  }
  if (format === 'docx') return extractDocx(file.bytes);
  if (format === 'pptx') return extractPptx(file.bytes);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(file.bytes);
  return extractText(text, format);
}
