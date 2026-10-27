import { fail, fence, ImagePdfError } from './errors.mjs';

export const LIMITS = Object.freeze({ maxCount: 20, maxFileBytes: 8_388_608, maxTotalBytes: 67_108_864, maxPixels: 16_000_000, maxEdge: 8192 });
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function bounds(offset, length, end, code = 'IMAGE_HEADER_INVALID') {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > end - length) fail(code);
}
function tiffOrientation(bytes) {
  const invalid = () => fail('EXIF_INVALID');
  if (bytes.length < 8) invalid();
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => { bounds(offset, 2, bytes.length, 'EXIF_INVALID'); return view.getUint16(offset, little); };
  const u32 = offset => { bounds(offset, 4, bytes.length, 'EXIF_INVALID'); return view.getUint32(offset, little); };
  if (u16(2) !== 42) invalid();
  const ifd = u32(4);
  if (ifd < 8) invalid();
  const count = u16(ifd);
  bounds(ifd + 2, count * 12 + 4, bytes.length, 'EXIF_INVALID');
  let orientation = null;
  const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    const type = u16(entry + 2), values = u32(entry + 4);
    if (!Object.hasOwn(typeSizes, type) || values < 1) invalid();
    const byteLength = typeSizes[type] * values;
    if (byteLength > 4) {
      const dataAt = u32(entry + 8);
      if (dataAt < 8) invalid();
      bounds(dataAt, byteLength, bytes.length, 'EXIF_INVALID');
    }
    if (u16(entry) !== 0x0112) continue;
    if (orientation !== null || u16(entry + 2) !== 3 || u32(entry + 4) !== 1) invalid();
    orientation = u16(entry + 8);
    if (orientation < 1 || orientation > 8) invalid();
  }
  const next = u32(ifd + 2 + count * 12);
  if (next !== 0 && (next < 8 || next === ifd || next > bytes.length - 2)) invalid();
  return orientation ?? 1;
}
function mergeOrientation(current, next) {
  if (current !== null && current !== next) fail('EXIF_INVALID');
  return next;
}
function inspectJpeg(bytes) {
  if (bytes.length < 4 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) fail('IMAGE_HEADER_INVALID');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2, dimensions = null, orientation = null, sawScan = false;
  while (at < bytes.length - 2) {
    if (bytes[at++] !== 0xff) fail('IMAGE_HEADER_INVALID');
    while (bytes[at] === 0xff) at++;
    bounds(at, 1, bytes.length);
    const marker = bytes[at++];
    if (marker === 0 || marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) fail('IMAGE_HEADER_INVALID');
    bounds(at, 2, bytes.length);
    const length = view.getUint16(at);
    if (length < 2) fail('IMAGE_HEADER_INVALID');
    bounds(at, length, bytes.length - 2);
    const start = at + 2, end = at + length;
    if (sofMarkers.has(marker)) {
      if (dimensions || length < 11 || bytes[start] !== 8) fail('IMAGE_HEADER_INVALID');
      const components = bytes[start + 5];
      if (![1, 3, 4].includes(components) || length !== 8 + 3 * components) fail('IMAGE_HEADER_INVALID');
      dimensions = { rawWidth: view.getUint16(start + 3), rawHeight: view.getUint16(start + 1) };
    }
    if (marker === 0xe1 && bytes[start] === 0x45 && bytes[start + 1] === 0x78 && bytes[start + 2] === 0x69 && bytes[start + 3] === 0x66) {
      if (length < 8 || bytes[start + 4] !== 0 || bytes[start + 5] !== 0) fail('EXIF_INVALID');
      orientation = mergeOrientation(orientation, tiffOrientation(bytes.subarray(start + 6, end)));
    }
    if (marker === 0xda) {
      if (!dimensions || length < 8 || length !== 6 + 2 * bytes[start]) fail('IMAGE_HEADER_INVALID');
      sawScan = true;
      break; // Entropy coding is the decoder's job; the header scan never interprets pixel data.
    }
    at = end;
  }
  if (!dimensions || !sawScan) fail('IMAGE_HEADER_INVALID');
  return { format: 'JPEG', ...dimensions, orientation: orientation ?? 1 };
}
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let value = i;
  for (let b = 0; b < 8; b++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes, from, to) {
  let crc = 0xffffffff;
  for (let at = from; at < to; at++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[at]) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function inspectPng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8, dimensions = null, orientation = null, sawData = false, sawEnd = false, sawPalette = false;
  let dataEnded = false;
  while (at < bytes.length) {
    bounds(at, 12, bytes.length);
    const length = view.getUint32(at);
    bounds(at + 8, length + 4, bytes.length);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) fail('IMAGE_HEADER_INVALID');
    if (view.getUint32(at + 8 + length) !== crc32(bytes, at + 4, at + 8 + length)) fail('IMAGE_HEADER_INVALID');
    if (!dimensions && type !== 'IHDR') fail('IMAGE_HEADER_INVALID');
    if (type === 'IHDR') {
      if (dimensions || at !== 8 || length !== 13) fail('IMAGE_HEADER_INVALID');
      const depth = bytes[at + 16], color = bytes[at + 17];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[at + 18] !== 0 || bytes[at + 19] !== 0 || bytes[at + 20] > 1) fail('IMAGE_HEADER_INVALID');
      dimensions = { rawWidth: view.getUint32(at + 8), rawHeight: view.getUint32(at + 12) };
    } else if (type === 'acTL') fail('ANIMATED_PNG');
    else if (type === 'eXIf') orientation = mergeOrientation(orientation, tiffOrientation(bytes.subarray(at + 8, at + 8 + length)));
    else if (type === 'PLTE') {
      if (sawPalette || sawData || length === 0 || length % 3 !== 0 || length > 768) fail('IMAGE_HEADER_INVALID');
      sawPalette = true;
    } else if (type === 'IDAT') {
      if (dataEnded) fail('IMAGE_HEADER_INVALID');
      sawData = true;
    } else if (type === 'IEND') {
      if (length !== 0 || !sawData || at + 12 !== bytes.length) fail('IMAGE_HEADER_INVALID');
      sawEnd = true;
    } else if (type[0] === type[0].toUpperCase()) fail('IMAGE_HEADER_INVALID');
    if (sawData && type !== 'IDAT') dataEnded = true;
    at += length + 12;
  }
  if (!sawEnd) fail('IMAGE_HEADER_INVALID');
  return { format: 'PNG', ...dimensions, orientation: orientation ?? 1 };
}
export function inspectImageHeader(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('IMAGE_HEADER_INVALID');
  let info;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) info = inspectJpeg(bytes);
  else if (PNG.every((value, index) => bytes[index] === value)) info = inspectPng(bytes);
  else fail('UNSUPPORTED_FORMAT');
  if (!Number.isSafeInteger(info.rawWidth) || !Number.isSafeInteger(info.rawHeight) || info.rawWidth < 1 || info.rawHeight < 1) fail('IMAGE_HEADER_INVALID');
  const swap = info.orientation >= 5;
  return { ...info, visualWidth: swap ? info.rawHeight : info.rawWidth, visualHeight: swap ? info.rawWidth : info.rawHeight };
}
function effectiveLimits(limits = {}) {
  return Object.fromEntries(Object.entries(LIMITS).map(([key, hard]) => {
    const value = limits[key] ?? hard;
    if (!Number.isSafeInteger(value) || value < 1 || value > hard) fail('IMAGE_HEADER_INVALID');
    return [key, value];
  }));
}
export function validateFileSizes(files, limits = {}) {
  const gate = effectiveLimits(limits);
  if (!Array.isArray(files) || files.length === 0) fail('IMAGE_HEADER_INVALID');
  if (files.length > gate.maxCount) fail('TOO_MANY_FILES');
  let total = 0;
  for (const [index, file] of files.entries()) {
    if (!Number.isSafeInteger(file?.size) || file.size < 1) fail('IMAGE_HEADER_INVALID', index);
    if (file.size > gate.maxFileBytes) fail('FILE_TOO_LARGE', index);
    total += file.size;
    if (total > gate.maxTotalBytes) fail('TOTAL_TOO_LARGE');
  }
  return total;
}
export function validateFiles(files, metadata, limits = {}) {
  const gate = effectiveLimits(limits);
  const totalBytes = validateFileSizes(files, gate);
  if (!Array.isArray(metadata) || metadata.length !== files.length) fail('IMAGE_HEADER_INVALID');
  const items = files.map((file, index) => {
    const m = metadata[index];
    if (!m || !['JPEG', 'PNG'].includes(m.format) || !Number.isInteger(m.orientation) || m.orientation < 1 || m.orientation > 8 ||
      !Number.isSafeInteger(m.rawWidth) || !Number.isSafeInteger(m.rawHeight) || m.rawWidth < 1 || m.rawHeight < 1) fail('IMAGE_HEADER_INVALID', index);
    if (Math.max(m.rawWidth, m.rawHeight) > gate.maxEdge) fail('EDGE_LIMIT', index);
    if (!Number.isSafeInteger(m.rawWidth * m.rawHeight) || m.rawWidth * m.rawHeight > gate.maxPixels) fail('PIXEL_LIMIT', index);
    const swap = m.orientation >= 5;
    if (m.visualWidth !== (swap ? m.rawHeight : m.rawWidth) || m.visualHeight !== (swap ? m.rawWidth : m.rawHeight)) fail('EXIF_INVALID', index);
    return { file, metadata: { format: m.format, rawWidth: m.rawWidth, rawHeight: m.rawHeight, orientation: m.orientation, visualWidth: m.visualWidth, visualHeight: m.visualHeight }, rotationQuarterTurns: 0 };
  });
  return { items, totalBytes };
}
export async function preflightFiles(files, options = {}) {
  validateFileSizes(files);
  const metadata = [];
  for (let index = 0; index < files.length; index++) {
    fence(options);
    options.onProgress?.({ state: 'preflighting', index, total: files.length });
    let bytes;
    try {
      const buffer = await files[index].slice(0, files[index].size).arrayBuffer();
      fence(options);
      bytes = new Uint8Array(buffer);
      if (bytes.length !== files[index].size) fail('IMAGE_HEADER_INVALID');
      const m = inspectImageHeader(bytes);
      validateFiles([files[index]], [m]);
      metadata.push(m);
    } catch (error) {
      if (error instanceof ImagePdfError) {
        if (error.code === 'CANCELLED') throw error;
        throw new ImagePdfError(error.code, index);
      }
      throw new ImagePdfError('IMAGE_HEADER_INVALID', index);
    } finally { bytes = null; }
  }
  fence(options);
  return validateFiles(files, metadata);
}
