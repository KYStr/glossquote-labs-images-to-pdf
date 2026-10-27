import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeImagePages, rasterizePage } from '../public/js/core/create-pdf.mjs';
import { preflightFiles } from '../public/js/core/image-preflight.mjs';
import { createOutputState } from '../public/js/core/output-state.mjs';
import { jpeg, png, tiff, fakeFile, concat } from './fixtures/headers.mjs';

function rig({ holdDecode = false, holdEncode = false, nullBlob = false, mime = 'image/jpeg', badSignature = false, mismatch = false, contextMissing = false } = {}) {
  const events = [], transforms = [], callbacks = [];
  let active = 0, maxActive = 0, count = 0, releaseDecode;
  const context = {
    setTransform: (...args) => transforms.push(args),
    fillRect: (...args) => events.push(['white', context.fillStyle, ...args]),
    drawImage: () => events.push('draw'),
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => contextMissing ? null : context,
    toBlob(callback, type, quality) {
      events.push(['encode', canvas.width, canvas.height, type, quality]);
      const bytes = badSignature ? new Uint8Array([0, 0, 0, 0]) : jpeg(canvas.width, canvas.height);
      const blob = nullBlob ? null : { size: bytes.length, type: mime, arrayBuffer: async () => bytes.buffer };
      if (holdEncode) callbacks.push(() => callback(blob)); else callback(blob);
    },
  };
  const adapter = {
    decode(file) {
      count++; active++; maxActive = Math.max(maxActive, active);
      events.push(['decode', file.name, canvas.width, canvas.height]);
      const bitmap = { width: mismatch ? 3 : file.visualWidth ?? 1000, height: file.visualHeight ?? 500, close() { events.push('close'); active--; } };
      return holdDecode ? new Promise(resolve => { releaseDecode = () => resolve(bitmap); }) : Promise.resolve(bitmap);
    },
    getCanvas: () => canvas,
  };
  return { events, transforms, callbacks, adapter, canvas, get maxActive() { return maxActive; }, get active() { return active; }, get count() { return count; }, releaseDecode: () => releaseDecode() };
}
const inputs = async (n = 3) => (await preflightFiles(Array.from({ length: n }, (_, i) => fakeFile(jpeg(), `source-${i}.jpg`)))).items;
const settle = () => new Promise(resolve => setImmediate(resolve));

test('A18 three sources: maximum one bitmap; close/reset before next; no source metadata', async () => {
  const items = await inputs(), r = rig();
  const progress = [];
  const result = await encodeImagePages(items, {}, { adapter: r.adapter, onProgress: p => progress.push(p.state) });
  assert.equal(result.pageCount, 3);
  assert.equal(r.maxActive, 1); assert.equal(r.active, 0);
  assert.equal(r.canvas.width, 0); assert.equal(r.canvas.height, 0);
  assert.deepEqual(r.events.filter(e => Array.isArray(e) && e[0] === 'decode').map(e => e.slice(2)), [[0, 0], [0, 0], [0, 0]]);
  assert.equal(r.events.filter(e => e === 'close').length, 3);
  const firstDecode = progress.indexOf('decoding');
  assert.deepEqual(progress.slice(0, firstDecode), ['preflighting', 'preflighting', 'preflighting']);
  for (const e of r.events.filter(e => Array.isArray(e) && e[0] === 'encode')) assert.deepEqual(e, ['encode', 1000, 500, 'image/jpeg', 0.92]);
  for (const e of r.events.filter(e => Array.isArray(e) && e[0] === 'white')) assert.deepEqual(e, ['white', '#ffffff', 0, 0, 1000, 500]);
  const text = Buffer.from(result.bytes).toString('latin1');
  assert.ok(!text.includes('source-0.jpg') && !text.includes('Exif') && !text.includes('/Metadata'));
});
test('A19 cancel pending decode: wait, close, no next bitmap or PDF', async () => {
  const items = await inputs(), r = rig({ holdDecode: true }), abort = new AbortController();
  const pending = encodeImagePages(items, {}, { adapter: r.adapter, signal: abort.signal });
  await settle(); assert.equal(r.count, 1);
  abort.abort(); r.releaseDecode();
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(r.count, 1); assert.equal(r.active, 0); assert.equal(r.canvas.width, 0);
});
test('A19 cancel second pending encode: previously encoded page also cannot return', async () => {
  const items = await inputs(), r = rig({ holdEncode: true }), abort = new AbortController();
  const pending = encodeImagePages(items, {}, { adapter: r.adapter, signal: abort.signal });
  await settle(); r.callbacks.shift()(); await settle();
  assert.equal(r.count, 2);
  abort.abort(); r.callbacks.shift()();
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(r.count, 2); assert.equal(r.active, 0); assert.equal(r.canvas.height, 0);
});
test('A20 settings generation change while toBlob is pending: no downloadable URL', async () => {
  const items = await inputs(), r = rig({ holdEncode: true });
  let urlCount = 0;
  const output = createOutputState({ urlApi: { createObjectURL() { urlCount++; }, revokeObjectURL() {} } });
  const token = output.generation;
  const pending = encodeImagePages(items, { orientation: 'portrait' }, { adapter: r.adapter, generation: token, isCurrent: output.isCurrent });
  await settle(); output.invalidate(); r.callbacks.shift()();
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(output.hasResult, false); assert.equal(output.downloadUrl(), null); assert.equal(urlCount, 0);
  assert.equal(r.count, 1); assert.equal(r.active, 0);
});
test('decode failure/mismatch, unavailable Canvas, null/wrong MIME/bad JPEG all fail with cleanup', async () => {
  const items = await inputs(1);
  for (const [options, code] of [[{ mismatch: true }, 'ORIENTATION_MISMATCH'], [{ contextMissing: true }, 'CANVAS_UNAVAILABLE'], [{ nullBlob: true }, 'JPEG_ENCODE_FAILED'], [{ mime: 'image/png' }, 'JPEG_ENCODE_FAILED'], [{ badSignature: true }, 'JPEG_ENCODE_FAILED']]) {
    const r = rig(options);
    await assert.rejects(encodeImagePages(items, {}, { adapter: r.adapter }), { code });
    assert.equal(r.active, 0); assert.equal(r.canvas.width, 0); assert.equal(r.canvas.height, 0);
  }
  await assert.rejects(encodeImagePages(items, {}, { adapter: { decode() { throw Error('private raw'); } } }), { code: 'DECODE_FAILED' });
});
test('invalid batch never reaches decode even if fabricated metadata was supplied', async () => {
  const items = await inputs(1), r = rig();
  items.push({ ...items[0], file: fakeFile(new TextEncoder().encode('<svg/>')) });
  await assert.rejects(encodeImagePages(items, {}, { adapter: r.adapter }), { code: 'UNSUPPORTED_FORMAT', index: 1 });
  assert.equal(r.count, 0);
});
test('rotations use explicit clockwise transforms and white canvas before draw', async () => {
  const items = await inputs(1);
  const expected = [[1, 0, 0, 1, 0, 0], [0, 1, -1, 0, 500, 0], [-1, 0, 0, -1, 1000, 500], [0, -1, 1, 0, 0, 1000]];
  for (let turns = 0; turns < 4; turns++) {
    const r = rig();
    const page = await rasterizePage({ ...items[0], rotationQuarterTurns: turns }, {}, { adapter: r.adapter });
    assert.deepEqual(r.transforms[1], expected[turns]);
    assert.equal(page.widthPx, turns % 2 ? 500 : 1000);
    assert.equal(page.heightPx, turns % 2 ? 1000 : 500);
    assert.equal(r.events.findIndex(e => Array.isArray(e) && e[0] === 'white') < r.events.indexOf('draw'), true);
  }
});
test('EXIF visual dimensions drive user rotation; mirror pixels remain a browser gate', async () => {
  const file = fakeFile(jpeg(4000, 3000, tiff(6)));
  file.visualWidth = 3000; file.visualHeight = 4000;
  const item = (await preflightFiles([file])).items[0], r = rig();
  const page = await rasterizePage({ ...item, rotationQuarterTurns: 1 }, {}, { adapter: r.adapter });
  assert.equal(page.widthPx, 4000); assert.equal(page.heightPx, 3000);
});
test('transparent PNG follows the white flattening path (operation assertions only)', async () => {
  const item = (await preflightFiles([fakeFile(png())])).items[0], r = rig();
  await rasterizePage(item, {}, { adapter: r.adapter });
  assert.deepEqual(r.events.find(e => Array.isArray(e) && e[0] === 'white'), ['white', '#ffffff', 0, 0, 1000, 500]);
});
test('cancel after JPEG arrayBuffer settles fences the last asynchronous boundary', async () => {
  const item = (await inputs(1))[0], r = rig(), abort = new AbortController();
  let finish;
  r.canvas.toBlob = callback => callback({ type: 'image/jpeg', size: jpeg().length, arrayBuffer: () => new Promise(resolve => { finish = resolve; }) });
  const pending = rasterizePage(item, {}, { adapter: r.adapter, signal: abort.signal });
  await settle(); abort.abort(); finish(jpeg().buffer);
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(r.active, 0); assert.equal(r.canvas.width, 0);
});
test('A16 source EXIF/canary and filename never passed to the output writer', async () => {
  const bytes = jpeg(1000, 500, concat(tiff(1), new TextEncoder().encode('FAKE_GPS_CANARY')));
  assert.ok(Buffer.from(bytes).includes(Buffer.from('FAKE_GPS_CANARY')));
  const file = fakeFile(bytes, 'secret-gps-name.jpg'), r = rig();
  const items = (await preflightFiles([file])).items;
  const result = await encodeImagePages(items, {}, { adapter: r.adapter });
  const output = Buffer.from(result.bytes);
  for (const marker of ['FAKE_GPS_CANARY', 'secret-gps-name.jpg', 'Exif']) assert.ok(!output.includes(Buffer.from(marker)));
  // The fake Canvas returns fresh bytes. Actual native Canvas metadata stripping remains NOT_RUN.
});
