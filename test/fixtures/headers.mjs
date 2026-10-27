// Synthetic headers/opaque scan data. These fixtures are NOT decodable image evidence.
export function tiff(orientation = 1, little = true) {
  const b = new Uint8Array(26), v = new DataView(b.buffer);
  b.set(little ? [73, 73] : [77, 77]);
  v.setUint16(2, 42, little); v.setUint32(4, 8, little); v.setUint16(8, 1, little);
  v.setUint16(10, 0x112, little); v.setUint16(12, 3, little); v.setUint32(14, 1, little); v.setUint16(18, orientation, little);
  return b;
}
export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
export function jpeg(width = 1000, height = 500, exif = null) {
  const segment = (marker, payload) => concat([255, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255], payload);
  const sof = [8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0];
  return concat([255, 216], exif ? segment(225, concat([69, 120, 105, 102, 0, 0], exif)) : [], segment(192, sof), segment(218, [3, 1, 0, 2, 0, 3, 0, 0, 63, 0]), [0, 255, 217]);
}
function fixtureCrc(data) {
  let c = -1;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
  }
  return (c ^ -1) >>> 0;
}
export function chunk(type, data) {
  const b = new Uint8Array(data.length + 12), v = new DataView(b.buffer);
  v.setUint32(0, data.length); b.set(new TextEncoder().encode(type), 4); b.set(data, 8);
  v.setUint32(data.length + 8, fixtureCrc(b.subarray(4, 8 + data.length)));
  return b;
}
export function png(width = 1000, height = 500, extras = []) {
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, width); v.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
  return concat([137, 80, 78, 71, 13, 10, 26, 10], chunk('IHDR', ihdr), ...extras, chunk('IDAT', [0]), chunk('IEND', []));
}
export function fakeFile(bytes, name = 'synthetic.jpg') {
  return { name, type: 'image/jpeg', size: bytes.length, slice: (from, to) => ({ arrayBuffer: async () => bytes.slice(from, to).buffer }) };
}
