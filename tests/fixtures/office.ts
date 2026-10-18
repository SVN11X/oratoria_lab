/** Generadores de documentos mínimos (PDF, DOCX, PPTX) para pruebas unitarias y de extremo a extremo. */
import { strToU8, zipSync } from 'fflate';

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
