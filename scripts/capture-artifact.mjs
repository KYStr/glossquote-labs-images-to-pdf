import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT, requireNode } from './files.mjs';
import { writePdf } from '../public/js/core/pdf-writer.mjs';
import { computePageLayout } from '../public/js/core/page-layout.mjs';

requireNode();
const directory = path.join(ROOT, 'evidence', 'm1', 'artifacts');
await mkdir(directory, { recursive: true });
const bytes = writePdf([
  { jpegBytes: Uint8Array.of(255, 216, 0, 10, 255, 217), widthPx: 1000, heightPx: 500, layout: computePageLayout(1000, 500) },
  { jpegBytes: Uint8Array.of(255, 216, 128, 0, 255, 217), widthPx: 1000, heightPx: 500, layout: computePageLayout(1000, 500) },
]);
const buffer = Buffer.from(bytes), text = buffer.toString('latin1');
const start = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
if (!start || buffer.subarray(Number(start[1]), Number(start[1]) + 5).toString() !== 'xref\n') throw Error('startxref oracle failed');
const rows = text.slice(Number(start[1])).split('\n');
if (rows[1] !== '0 9') throw Error('Object count oracle failed');
const offsets = [];
for (let id = 1; id <= 8; id++) {
  const offset = Number(rows[id + 2].slice(0, 10));
  if (buffer.subarray(offset, offset + `${id} 0 obj\n`.length).toString() !== `${id} 0 obj\n`) throw Error('Object offset oracle failed');
  offsets.push({ id, offset });
}
if (!text.includes('/Count 2 /Kids [3 0 R 6 0 R]') || !text.includes('538.58 0 0 269.29 28.35 286.30 cm')) throw Error('Pages/layout oracle failed');
const filename = 'writer-structure-only.pdf';
await writeFile(path.join(directory, filename), bytes);
await writeFile(path.join(directory, 'structure-report.json'), JSON.stringify({
  scope: 'ACTUAL_PDF_BYTES_WITH_OPAQUE_FAKE_JPEG_STREAMS_ONLY', filename, bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), pageCount: 2, offsets, startxref: Number(start[1]),
  browserCanvasJpegDecodePdfViewer: 'NOT_RUN_USER_FOCUS_INCIDENT',
}, null, 2) + '\n');
await writeFile(path.join(directory, 'README.md'), '# 結構測試產物\n\nwriter-structure-only.pdf 是本次 writer 實際輸出的 PDF 位元組，有兩頁和精確 xref/stream framing。內嵌的是兩段 6-byte opaque fake JPEG payload，不是可解碼圖片，不適合用來檢查照片或 viewer 相容性。不要以此檔代表 Canvas JPEG/PDF viewer PASS。\n\n真 Canvas、EXIF 鏡像/旋轉、透明白底、實際 PDF viewer、下載與視覺/Network/Storage 驗收：NOT_RUN_USER_FOCUS_INCIDENT。結構與 hash 見 structure-report.json。\n');
console.log(`PASS structural artifact: ${bytes.length} bytes, 2 pages, 8 object offsets; image/viewer capability NOT_RUN.`);
