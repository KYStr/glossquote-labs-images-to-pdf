import { fail } from './errors.mjs';
import { computePageLayout, pdfNumber, PAPERS } from './page-layout.mjs';

export const MAX_PDF_BYTES = 67_108_864;
export const PDF_FILENAME = 'images-document.pdf';
const encoder = new TextEncoder();
const layoutKeys = ['pageWidthPt', 'pageHeightPt', 'xPt', 'yPt', 'widthPt', 'heightPt'];
function exactKeys(object, keys) {
  if (!object || typeof object !== 'object' || Object.keys(object).length !== keys.length || !keys.every(key => Object.hasOwn(object, key))) fail('PDF_STRUCTURE_ERROR');
}
function validatePage(page) {
  exactKeys(page, ['jpegBytes', 'widthPx', 'heightPx', 'layout']);
  const { jpegBytes, widthPx, heightPx, layout } = page;
  if (!(jpegBytes instanceof Uint8Array) || jpegBytes.length < 4 || jpegBytes[0] !== 255 || jpegBytes[1] !== 216 || jpegBytes.at(-2) !== 255 || jpegBytes.at(-1) !== 217) fail('PDF_STRUCTURE_ERROR');
  exactKeys(layout, layoutKeys);
  let expected = null;
  for (const [paper, [pw, ph]] of Object.entries(PAPERS)) {
    if (layout.pageWidthPt === pw && layout.pageHeightPt === ph) expected = computePageLayout(widthPx, heightPx, { paper });
    if (layout.pageWidthPt === ph && layout.pageHeightPt === pw) expected = computePageLayout(widthPx, heightPx, { paper, orientation: 'landscape' });
  }
  if (!expected || layoutKeys.some(key => !Number.isFinite(layout[key]) || Math.abs(layout[key] - expected[key]) > 1e-7)) fail('PDF_STRUCTURE_ERROR');
}
export function writePdf(pages, { maxBytes = MAX_PDF_BYTES } = {}) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 20 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PDF_BYTES) fail('PDF_STRUCTURE_ERROR');
  for (const page of pages) validatePage(page);
  const chunks = [], offsets = [0];
  let size = 0;
  function append(bytes) {
    if (size > maxBytes - bytes.byteLength) fail('OUTPUT_TOO_LARGE');
    chunks.push(bytes); size += bytes.byteLength;
  }
  const syntax = text => append(encoder.encode(text));
  const begin = id => { offsets[id] = size; syntax(`${id} 0 obj\n`); };
  const end = () => syntax('endobj\n');
  try {
    // Fixed non-ASCII binary comment. TextEncoder bytes, never string length, affect all offsets.
    syntax('%PDF-1.4\n%âãÏÓ\n');
    begin(1); syntax('<< /Type /Catalog /Pages 2 0 R >>\n'); end();
    begin(2); syntax(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>\n`); end();
    for (const [i, page] of pages.entries()) {
      const id = 3 + i * 3, p = page.layout;
      begin(id);
      syntax(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(p.pageWidthPt)} ${pdfNumber(p.pageHeightPt)}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>\n`);
      end();
      begin(id + 1);
      syntax(`<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.byteLength} >>\nstream\n`);
      append(page.jpegBytes); syntax('\nendstream\n'); end();
      const operations = encoder.encode(`q\n${pdfNumber(p.widthPt)} 0 0 ${pdfNumber(p.heightPt)} ${pdfNumber(p.xPt)} ${pdfNumber(p.yPt)} cm\n/Im0 Do\nQ\n`);
      begin(id + 2); syntax(`<< /Length ${operations.byteLength} >>\nstream\n`);
      append(operations); syntax('endstream\n'); end();
    }
    const xref = size, count = 3 + 3 * pages.length;
    syntax(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let id = 1; id < count; id++) syntax(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    syntax(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const result = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { result.set(chunk, at); at += chunk.byteLength; }
    return result;
  } finally { chunks.length = 0; offsets.length = 0; }
}
