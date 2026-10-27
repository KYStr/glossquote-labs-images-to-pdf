import test from 'node:test';
import assert from 'node:assert/strict';
import { writePdf, PDF_FILENAME, MAX_PDF_BYTES } from '../public/js/core/pdf-writer.mjs';
import { computePageLayout } from '../public/js/core/page-layout.mjs';
const payload = Uint8Array.of(255, 216, 0, 10, 255, 217);
const page = (bytes = payload) => ({ jpegBytes: bytes, widthPx: 1000, heightPx: 500, layout: computePageLayout(1000, 500) });
function inspect(pdf) {
  const data = Buffer.from(pdf), text = data.toString('latin1');
  const match = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
  assert.ok(match);
  const at = Number(match[1]);
  assert.equal(data.subarray(at, at + 5).toString(), 'xref\n');
  const lines = text.slice(at).split('\n');
  const count = Number(lines[1].split(' ')[1]);
  assert.equal(lines[2], '0000000000 65535 f ');
  const objects = [];
  for (let id = 1; id < count; id++) {
    const line = lines[id + 2];
    assert.match(line, /^\d{10} 00000 n $/);
    assert.equal(Buffer.byteLength(line + '\n'), 20);
    const offset = Number(line.slice(0, 10));
    assert.equal(data.subarray(offset, offset + `${id} 0 obj\n`.length).toString(), `${id} 0 obj\n`);
    const next = id === count - 1 ? at : Number(lines[id + 3].slice(0, 10));
    objects[id] = data.subarray(offset, next);
  }
  const streams = [];
  for (let id = 1; id < objects.length; id++) {
    const object = objects[id], start = object.indexOf(Buffer.from('stream\n'));
    if (start < 0) continue;
    const length = Number(/\/Length (\d+)/.exec(object.subarray(0, start).toString())[1]);
    const bytes = object.subarray(start + 7, start + 7 + length);
    const tail = object.subarray(start + 7 + length).toString();
    assert.ok(tail === '\nendstream\nendobj\n' || tail === 'endstream\nendobj\n');
    streams.push({ id, bytes, length });
  }
  assert.match(text.slice(at), new RegExp(`/Size ${count} /Root 1 0 R`));
  return { data, text, streams, objects, at, count };
}
test('A11 two pages, fixed object graph and caller order', () => {
  const second = Uint8Array.of(255, 216, 33, 66, 77, 255, 217);
  const p = inspect(writePdf([page(), page(second)]));
  assert.match(p.objects[2].toString(), /\/Count 2 \/Kids \[3 0 R 6 0 R\]/);
  assert.equal(p.count, 9);
  assert.equal((p.text.match(/\/Type \/Page\b/g) ?? []).length, 2);
  assert.deepEqual(p.streams.find(s => s.id === 4).bytes, Buffer.from(payload));
  assert.deepEqual(p.streams.find(s => s.id === 7).bytes, Buffer.from(second));
});
test('A12 fake opaque JPEG stream preserves 6 exact bytes including NUL and LF', () => {
  const p = inspect(writePdf([page()]));
  const stream = p.streams.find(s => s.id === 4);
  assert.equal(stream.length, 6);
  assert.deepEqual([...stream.bytes], [255, 216, 0, 10, 255, 217]);
  assert.match(p.objects[4].toString(), /\/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 6/);
});
test('A13 precise ASCII operations and direct length', () => {
  const p = inspect(writePdf([page()]));
  const expected = 'q\n538.58 0 0 269.29 28.35 286.30 cm\n/Im0 Do\nQ\n';
  const stream = p.streams.find(s => s.id === 5);
  assert.equal(stream.bytes.toString('ascii'), expected);
  assert.equal(stream.length, Buffer.byteLength(expected, 'ascii'));
});
test('A14/A15 all xref offsets, UTF8 comment bytes, startxref and EOF', () => {
  const p = inspect(writePdf([page(Uint8Array.of(255, 216, 128, 0, 255, 217)), page()]));
  assert.equal(p.objects[1].toString(), '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const byteOffset = p.data.indexOf(Buffer.from('1 0 obj'));
  const utf16Offset = p.data.toString('utf8').indexOf('1 0 obj');
  assert.equal(byteOffset, 19);
  assert.equal(utf16Offset, 15);
  assert.notEqual(byteOffset, utf16Offset);
});
test('A16 fixed template and filename; user labels cannot enter the writer schema', () => {
  assert.equal(PDF_FILENAME, 'images-document.pdf');
  const text = inspect(writePdf([page()])).text;
  for (const marker of ['secret-gps-name.jpg', 'Exif', 'GPS', '/Metadata', '/Info', '/Title', '/Author', '/CreationDate', '/JavaScript', '/OpenAction', '/Encrypt', '/EmbeddedFile']) assert.ok(!text.includes(marker));
  assert.throws(() => writePdf([{ ...page(), filename: 'secret-gps-name.jpg' }]), { code: 'PDF_STRUCTURE_ERROR' });
});
test('A17 maxBytes exact length and one less reject before returning bytes', () => {
  // Independent byte accounting for the fixed one-page layout: every literal here is a format oracle.
  const header = Buffer.byteLength('%PDF-1.4\n%âãÏÓ\n');
  const catalog = Buffer.byteLength('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const pages = Buffer.byteLength('2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n');
  const pg = Buffer.byteLength('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
  const operations = 'q\n538.58 0 0 269.29 28.35 286.30 cm\n/Im0 Do\nQ\n';
  const contents = Buffer.byteLength(`5 0 obj\n<< /Length ${Buffer.byteLength(operations)} >>\nstream\n${operations}endstream\nendobj\n`);
  function independentlyCount(n) {
    const image = Buffer.byteLength(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width 1000 /Height 500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${n} >>\nstream\n\nendstream\nendobj\n`) + n;
    const beforeXref = header + catalog + pages + pg + image + contents;
    return beforeXref + Buffer.byteLength(`xref\n0 6\n${'0000000000 65535 f \n'}${'0000000000 00000 n \n'.repeat(5)}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${beforeXref}\n%%EOF\n`);
  }
  const n = MAX_PDF_BYTES - (independentlyCount(MAX_PDF_BYTES) - MAX_PDF_BYTES);
  assert.equal(independentlyCount(n), 67_108_864);
  const large = new Uint8Array(n); large.set([255, 216]); large.set([255, 217], n - 2);
  assert.equal(writePdf([page(large)]).byteLength, 67_108_864);
  const extra = new Uint8Array(n + 1); extra.set([255, 216]); extra.set([255, 217], n - 1);
  assert.throws(() => writePdf([page(extra)]), { code: 'OUTPUT_TOO_LARGE' });
  assert.throws(() => writePdf([page()], { maxBytes: independentlyCount(6) - 1 }), { code: 'OUTPUT_TOO_LARGE' });
  assert.equal(writePdf([page()], { maxBytes: independentlyCount(6) }).byteLength, independentlyCount(6));
});
test('invalid schema, count, JPEG, fit and paper rejected', () => {
  for (const pages of [[], Array(21).fill(page()), [{ ...page(), jpegBytes: new Uint8Array([0]) }], [{ ...page(), widthPx: Infinity }], [{ ...page(), layout: { ...page().layout, xPt: 0 } }]]) assert.throws(() => writePdf(pages), { code: 'PDF_STRUCTURE_ERROR' });
});
