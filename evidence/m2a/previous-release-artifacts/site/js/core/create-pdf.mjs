import { ImagePdfError, fail, fence } from './errors.mjs';
import { preflightFiles, validateFiles, inspectImageHeader } from './image-preflight.mjs';
import { computePageLayout } from './page-layout.mjs';
import { writePdf, MAX_PDF_BYTES } from './pdf-writer.mjs';

function validateItems(items) {
  if (!Array.isArray(items)) fail('IMAGE_HEADER_INVALID');
  validateFiles(items.map(item => item.file), items.map(item => item.metadata));
  for (const item of items) if (!Number.isInteger(item.rotationQuarterTurns) || item.rotationQuarterTurns < 0 || item.rotationQuarterTurns > 3) fail('IMAGE_HEADER_INVALID');
}
export async function rasterizePage(item, paperSettings, options) {
  validateItems([item]);
  fence(options);
  const { adapter, onProgress, index = 0, total = 1 } = options;
  let bitmap = null, canvas = null, blob = null, jpegBytes = null;
  let phase = 'DECODE_FAILED';
  try {
    onProgress?.({ state: 'decoding', index, total });
    fence(options);
    bitmap = await adapter.decode(item.file);
    fence(options);
    if (bitmap?.width !== item.metadata.visualWidth || bitmap?.height !== item.metadata.visualHeight) fail('ORIENTATION_MISMATCH', index);
    phase = 'CANVAS_UNAVAILABLE';
    canvas = adapter.getCanvas();
    const odd = item.rotationQuarterTurns % 2;
    const widthPx = odd ? bitmap.height : bitmap.width, heightPx = odd ? bitmap.width : bitmap.height;
    const layout = computePageLayout(widthPx, heightPx, paperSettings);
    canvas.width = widthPx; canvas.height = heightPx;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) fail('CANVAS_UNAVAILABLE', index);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, widthPx, heightPx);
    const transforms = [[1, 0, 0, 1, 0, 0], [0, 1, -1, 0, bitmap.height, 0], [-1, 0, 0, -1, bitmap.width, bitmap.height], [0, -1, 1, 0, 0, bitmap.width]];
    context.setTransform(...transforms[item.rotationQuarterTurns]);
    context.drawImage(bitmap, 0, 0);
    phase = 'JPEG_ENCODE_FAILED';
    onProgress?.({ state: 'encoding', index, total });
    fence(options);
    blob = await new Promise((resolve, reject) => {
      try { canvas.toBlob(resolve, 'image/jpeg', 0.92); } catch { reject(new ImagePdfError('JPEG_ENCODE_FAILED', index)); }
    });
    fence(options);
    if (!blob || blob.type !== 'image/jpeg' || !Number.isSafeInteger(blob.size) || blob.size < 4) fail('JPEG_ENCODE_FAILED', index);
    if (blob.size > MAX_PDF_BYTES) fail('OUTPUT_TOO_LARGE', index);
    const buffer = await blob.arrayBuffer();
    fence(options);
    jpegBytes = new Uint8Array(buffer);
    if (jpegBytes.byteLength !== blob.size || jpegBytes[0] !== 255 || jpegBytes[1] !== 216 || jpegBytes.at(-2) !== 255 || jpegBytes.at(-1) !== 217) fail('JPEG_ENCODE_FAILED', index);
    let encoded;
    try { encoded = inspectImageHeader(jpegBytes); } catch { fail('JPEG_ENCODE_FAILED', index); }
    if (encoded.format !== 'JPEG' || encoded.rawWidth !== widthPx || encoded.rawHeight !== heightPx || encoded.orientation !== 1) fail('JPEG_ENCODE_FAILED', index);
    return { jpegBytes, widthPx, heightPx, layout };
  } catch (error) {
    if (error instanceof ImagePdfError) throw error;
    throw new ImagePdfError(phase, index);
  } finally {
    try { bitmap?.close(); }
    finally {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      bitmap = null; canvas = null; blob = null; jpegBytes = null;
    }
  }
}
export async function encodeImagePages(items, paperSettings, options) {
  validateItems(items);
  const pages = [];
  let totalJpegBytes = 0;
  try {
    // Read every header again before any expensive decode. Source bytes cannot bypass preflight.
    const verified = await preflightFiles(items.map(item => item.file), options);
    for (let index = 0; index < items.length; index++) {
      const original = items[index].metadata, fresh = verified.items[index].metadata;
      if (Object.keys(fresh).some(key => fresh[key] !== original[key])) fail('IMAGE_HEADER_INVALID', index);
    }
    for (let index = 0; index < items.length; index++) {
      fence(options);
      const page = await rasterizePage(items[index], paperSettings, { ...options, index, total: items.length });
      fence(options);
      totalJpegBytes += page.jpegBytes.byteLength;
      if (totalJpegBytes > MAX_PDF_BYTES) fail('OUTPUT_TOO_LARGE');
      pages.push(page);
    }
    options.onProgress?.({ state: 'writing-pdf', index: items.length, total: items.length });
    fence(options);
    const bytes = writePdf(pages);
    fence(options);
    return { bytes, pageCount: pages.length };
  } finally { pages.length = 0; totalJpegBytes = 0; }
}
