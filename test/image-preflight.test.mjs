import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectImageHeader, validateFiles, validateFileSizes, preflightFiles } from '../public/js/core/image-preflight.mjs';
import { jpeg, png, tiff, chunk, fakeFile, concat } from './fixtures/headers.mjs';
const meta = { format: 'JPEG', rawWidth: 1000, rawHeight: 500, orientation: 1, visualWidth: 1000, visualHeight: 500 };
const rejects = (run, code) => assert.throws(run, error => error.code === code);
test('A01 20 accepted, 21 rejected before a read/decode', async () => {
  const file = fakeFile(jpeg());
  assert.equal((await preflightFiles(Array(20).fill(file))).items.length, 20);
  let reads = 0;
  const neverRead = { size: 1, slice() { reads++; throw Error(); } };
  await assert.rejects(preflightFiles(Array(21).fill(neverRead)), { code: 'TOO_MANY_FILES' });
  assert.equal(reads, 0);
});
test('A02 per-file bytes: exact hard cap and +1', () => {
  assert.equal(validateFiles([{ size: 8_388_608 }], [meta]).totalBytes, 8_388_608);
  rejects(() => validateFiles([{ size: 8_388_609 }], [meta]), 'FILE_TOO_LARGE');
});
test('A03 20 files total: 64MiB and one extra byte', () => {
  const sizes = [...Array(8).fill(8_388_606), ...Array(11).fill(1), 5];
  assert.equal(validateFileSizes(sizes.map(size => ({ size }))), 67_108_864);
  sizes[19]++;
  rejects(() => validateFileSizes(sizes.map(size => ({ size }))), 'TOTAL_TOO_LARGE');
});
test('A04 magic rather than name/MIME; PNG and JPEG dimensions', async () => {
  assert.deepEqual(inspectImageHeader(jpeg()), meta);
  assert.deepEqual(inspectImageHeader(png(50, 20)), { format: 'PNG', rawWidth: 50, rawHeight: 20, orientation: 1, visualWidth: 50, visualHeight: 20 });
  await assert.rejects(preflightFiles([fakeFile(new TextEncoder().encode('<svg/>'), 'looks-like.jpg')]), { code: 'UNSUPPORTED_FORMAT', index: 0 });
});
test('A05 APNG rejected in metadata preflight', async () => {
  await assert.rejects(preflightFiles([fakeFile(png(10, 10, [chunk('acTL', new Uint8Array(8))]))]), { code: 'ANIMATED_PNG', index: 0 });
});
test('A06 exact pixel and edge limits', () => {
  const validate = (w, h) => validateFiles([{ size: 1 }], [inspectImageHeader(png(w, h))]);
  assert.equal(validate(4000, 4000).items.length, 1);
  assert.equal(validate(8192, 1).items.length, 1);
  rejects(() => validate(4001, 4000), 'PIXEL_LIMIT');
  rejects(() => validate(8193, 1), 'EDGE_LIMIT');
});
test('A07 EXIF all orientations, both endian orders, PNG eXIf', () => {
  for (let n = 1; n <= 8; n++) {
    for (const little of [true, false]) {
      const m = inspectImageHeader(jpeg(4000, 3000, tiff(n, little)));
      assert.equal(m.orientation, n);
      assert.equal(m.visualWidth, n < 5 ? 4000 : 3000);
      assert.equal(m.visualHeight, n < 5 ? 3000 : 4000);
    }
  }
  assert.equal(inspectImageHeader(png(10, 20, [chunk('eXIf', tiff(8))])).visualWidth, 20);
});
test('A07 invalid EXIF never falls back silently', () => {
  for (const n of [0, 9]) rejects(() => inspectImageHeader(jpeg(5, 6, tiff(n))), 'EXIF_INVALID');
  const bad = tiff(6); bad[0] = 0;
  rejects(() => inspectImageHeader(jpeg(5, 6, bad)), 'EXIF_INVALID');
  const offset = tiff(6); offset[4] = 255;
  rejects(() => inspectImageHeader(jpeg(5, 6, offset)), 'EXIF_INVALID');
  const count = tiff(6); count[14] = 2;
  rejects(() => inspectImageHeader(jpeg(5, 6, count)), 'EXIF_INVALID');
  const malformedOtherTag = tiff();
  new DataView(malformedOtherTag.buffer).setUint16(10, 0x010e, true); // Description, not parsed or retained.
  new DataView(malformedOtherTag.buffer).setUint16(12, 2, true);
  new DataView(malformedOtherTag.buffer).setUint32(14, 200, true);
  new DataView(malformedOtherTag.buffer).setUint32(18, 1000, true);
  rejects(() => inspectImageHeader(jpeg(5, 6, malformedOtherTag)), 'EXIF_INVALID');
  rejects(() => inspectImageHeader(png(10, 20, [chunk('eXIf', tiff(1)), chunk('eXIf', tiff(6))])), 'EXIF_INVALID');
});
test('truncated/zero/CRC/unknown critical/chunk overflow rejected', () => {
  rejects(() => inspectImageHeader(jpeg().subarray(0, 15)), 'IMAGE_HEADER_INVALID');
  rejects(() => inspectImageHeader(png(0, 1)), 'IMAGE_HEADER_INVALID');
  const crc = png(); crc[32] ^= 1;
  rejects(() => inspectImageHeader(crc), 'IMAGE_HEADER_INVALID');
  rejects(() => inspectImageHeader(png(1, 1, [chunk('ABCD', [1])])), 'IMAGE_HEADER_INVALID');
  const length = png(); length[8] = 255;
  rejects(() => inspectImageHeader(length), 'IMAGE_HEADER_INVALID');
  rejects(() => inspectImageHeader(concat(png(), [0])), 'IMAGE_HEADER_INVALID');
});
test('all selections preflight before use; failures identify the source, no raw errors', async () => {
  const files = [fakeFile(jpeg()), fakeFile(new Uint8Array([0]))];
  await assert.rejects(preflightFiles(files), { code: 'UNSUPPORTED_FORMAT', index: 1 });
  await assert.rejects(preflightFiles([{ size: 2, slice() { throw new Error('private raw message'); } }]), error => error.code === 'IMAGE_HEADER_INVALID' && !error.message.includes('private'));
});
test('late preflight result is discarded after cancel or generation change', async () => {
  let release;
  const file = fakeFile(jpeg());
  file.slice = () => ({ arrayBuffer: () => new Promise(resolve => { release = resolve; }) });
  let current = true;
  const pending = preflightFiles([file], { generation: 1, isCurrent: () => current });
  current = false; release(jpeg().buffer);
  await assert.rejects(pending, { code: 'CANCELLED' });
});
