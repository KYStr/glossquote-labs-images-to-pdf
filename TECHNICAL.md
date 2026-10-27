# 技術契約：多張圖片合成 PDF

狀態：規格，尚未實作。本產品的風險核心是瀏覽器 decode/Canvas JPEG 與自行建 PDF bytes，須將 pure binary checks 和真瀏覽器能力 gates 分開。使用原生 HTML/CSS/ESM、Node.js 24+ built-ins、node:test；runtime 零套件，禁止 PDF/image libraries、CDN、API、上傳和 server processing。

## 建議檔案樹

```text
package.json
public/index.html
public/styles/app.css
public/js/app.js
public/js/core/image-preflight.mjs
public/js/core/page-layout.mjs
public/js/core/pdf-writer.mjs
public/js/core/create-pdf.mjs
scripts/serve.mjs
scripts/check.mjs
scripts/build.mjs
test/image-preflight.test.mjs
test/page-layout.test.mjs
test/pdf-writer.test.mjs
test/fixtures/ (由 Node 程式合成的 bounded headers/payloads)
```

## API / 演算法介面

```js
inspectImageHeader(bytes)
// -> { format, rawWidth, rawHeight, orientation:1..8, visualWidth, visualHeight }

validateFiles(files, metadata, { maxCount:20, maxFileBytes:8_388_608,
  maxTotalBytes:67_108_864, maxPixels:16_000_000, maxEdge:8192 })
// -> { items:[{file, metadata, rotationQuarterTurns:0}], totalBytes }

computePageLayout(imageWidth, imageHeight, { paper:'A4'|'Letter', orientation:'portrait'|'landscape', marginPt:28.35 })
// -> { pageWidthPt, pageHeightPt, xPt, yPt, widthPt, heightPt }

writePdf(pages, { maxBytes:67_108_864 })
// pages: [{ jpegBytes:Uint8Array, widthPx, heightPx, layout }]
// -> Uint8Array PDF 1.4 | PdfBuildError

async encodeImagePages(items, paperSettings, { signal, generation, isCurrent, onProgress })
// -> { bytes:Uint8Array, pageCount:number } | ImagePdfError
```

### Header preflight

Never trust filename, extension or `File.type`; bytes determine acceptance. Use bounded slices, one file at a time. Enforce selection/file/total byte caps before reading metadata. JPEG scanner starts SOI, parses marker bytes and 16-bit big-endian segment lengths until first SOS; reject malformed marker/length, no SOF, zero dimensions or unsupported/truncated EXIF. Extract width/height from SOF markers with bounds checks; APP1 `Exif\0\0` TIFF IFD0 reads orientation tag `0x0112` only. PNG scanner validates signature, first IHDR and bounded chunks; read width/height, look for `eXIf` and `acTL`; any `acTL` rejects APNG. Validate TIFF endian/magic/offsets/count; orientation absent=1, present must be SHORT 1..8. Do not parse/persist GPS, timestamps, camera, thumbnail or comments. Unknown files never reach decoder.

Check `rawWidth*rawHeight ≤16_000_000` and `max(width,height) ≤8192` using safe integer arithmetic before decode. For EXIF orientation 5–8 swap `visualWidth/visualHeight`. After `createImageBitmap(file)` (default from-image orientation), check decoded dimensions exactly equal expected visual dims. Decoder failures are `DECODE_FAILED`; mismatch is `ORIENTATION_MISMATCH`. Browser fixtures with asymmetric marks verify mirrors/rotation because dimensions alone do not distinguish mirror cases.

### One-at-a-time raster pipeline

Preflight all files before decoding any. Then for each item, in sequence:

1. `bitmap = await createImageBitmap(file)`; test abort/generation and decoded dims before allocation.
2. Set one reusable Canvas to oriented dimensions after user rotation (swap width/height for odd quarter turns; pixel count stays bounded). Fill entire Canvas white, apply 0/90/180/270 clockwise transform, draw bitmap. PNG transparency is flattened to white.
3. Await `canvas.toBlob(callback,'image/jpeg',0.92)`. The quality is a browser hint; bytes may vary. Verify non-null blob, reported MIME exactly `image/jpeg`, and resulting bytes begin `FF D8` and end `FF D9`; record actual width/height and `byteLength`.
4. Append just this JPEG byte array and its numeric page layout to the PDF assembly list. In `finally`, always `bitmap.close()`, set canvas width/height to 0, and drop the per-page Blob/ref before moving on. `maxConcurrentBitmaps` invariant = 1.

There is no AbortSignal support promised for native decode/toBlob; cancellation marks a fence. Stop scheduling additional source files, wait for the one in-flight promise/callback, then close/discard it. Check generation after each await and before final PDF Blob/URL creation. If stale, clear all accumulated page JPEG arrays and produce no PDF. `Promise.all` is forbidden. Browser memory/canvas limits remain runtime conditions: catch allocation/encode failures, clear all temporary bytes, report recoverable failure and preserve source File refs.

### Page layout and PDF byte writer

All calculations use full-precision Numbers from exact paper constants; emitted PDF numbers are rounded to 2 decimal places, decimal point only, no locale format. A4 portrait = 595.28×841.89 pt; Letter portrait = 612×792 pt; landscape swaps. Margin 28.35 pt, so A4 portrait content=538.58×785.19. For 1000×500 image: `scale=min(538.58/1000,785.19/500)=0.53858`; `width=538.58`, `height=269.29`, `x=28.35`, `y=286.30`.

`writePdf` uses byte chunks, not giant JS strings. Header is `%PDF-1.4\n` plus a fixed binary comment. Object allocation is deterministic: `1 Catalog`, `2 Pages`, then each page `Page`, `Image`, `Contents` at object IDs `3+3*i`, `4+3*i`, `5+3*i`. Encode all syntax with ASCII `TextEncoder`; user strings and file names never enter PDF bytes.

Each Image XObject dictionary includes `/Type /XObject /Subtype /Image /Width W /Height H /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length N`; write `stream\n`, the exact N JPEG bytes, then `\nendstream`. Content stream is ASCII `q\nW 0 0 H X Y cm\n/Im0 Do\nQ\n`; `/Length` equals the exact ASCII content bytes only. Page resources map `/Im0` to its image object; Pages `/Kids` preserves order and `/Count` equals selection length. No metadata/catalog strings that derive from input.

Before writing each `${id} 0 obj`, record current byte count as object offset. At file end, record the byte index of the `xref` keyword; write classic xref table entry 0 and fixed 10-digit offsets for all objects, then `trailer` with `/Size` and `/Root 1 0 R`, `startxref` equal to that `xref` byte offset and `%%EOF`. All offsets and stream lengths are byte counts over `Uint8Array` pieces, including binary bytes; never use JS string `.length` for binary streams. Check maximum PDF 67,108,864 bytes before final Blob. Output MIME `application/pdf`, fixed name `images-document.pdf`.

## 狀態與輸出清理

States: `idle`, `preflighting`, `ready`, `decoding`, `encoding`, `writing-pdf`, `result`, `stale`, `cancelling`, `cancelled`, `blocked`, `failed`. Change files/order/paper/orientation/rotation synchronously increments generation, disables downloads, revokes old pending URLs and releases current PDF/JPEG bytes. `finally` closes bitmap, zeros Canvas, and drops byte references. Reset/pagehide same, idempotent. A download already dispatched cannot be withdrawn; any active object URL is revoked after 60 seconds at latest/pagehide, and stale outputs are never reusable.

Package: ESM/private, Node 24+, no dependencies. `npm test` runs `node --test`; `npm run check` runs `node scripts/check.mjs`; `npm run build` copies reviewed `public/` to `dist/`; future local preview is `127.0.0.1:4226`. This spec task does not install packages or launch server/browser.

## 離線與真瀏覽器檢查界線

Node can test page math, fake JPEG byte handling, PDF object numbering, xref byte offsets, stream `/Length`, page count and output caps. For these binary-writer tests, fake payload bytes are opaque stand-ins; they do **not** prove Canvas produced a valid JPEG or that a PDF viewer can decode it. A real browser gate must generate tiny synthetic PNG/JPEGs via Canvas, verify the browser-created JPEG is `image/jpeg` and decodes with expected pixels, then inspect/open the emitted PDF through an approved isolated browser surface. It must not trigger OS print/save dialogs. Because of the focus incident, browser gate is **NOT_RUN_USER_FOCUS_INCIDENT** until primary confirms isolation.

## 官方參考

- [Adobe PDF Reference 1.4](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.4.pdf): PDF 1.4 classic file structure, cross-reference tables/trailers, stream objects and direct `/Length`.
- [HTML Standard — Canvas](https://html.spec.whatwg.org/multipage/canvas.html): `toBlob()` behavior and Canvas origin cleanliness; browser output must be verified directly.
- [HTML Standard — ImageBitmap](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html): `createImageBitmap(Blob)`, orientation metadata default, `close()` and decode rejection.
- [W3C PNG Specification, Third Edition](https://www.w3.org/TR/png/): PNG signature/chunk framing, `eXIf`, alpha and animation markers.
- [CIPA Exif DC-008 standards page](https://www.cipa.jp/e/std/std-sec.html): TIFF/Exif structure and orientation metadata reference.
- [ITU-T T.81](https://www.itu.int/ITU-T/recommendations/rec.aspx?lang=en&rec=2633): JPEG-1 structure reference. The file generator does not implement JPEG coding; browser Canvas does.
