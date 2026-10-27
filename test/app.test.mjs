import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountApp } from '../public/js/app.js';
import { createOutputState } from '../public/js/core/output-state.mjs';
import { COPY } from '../public/js/i18n.mjs';
import { fakeDocument } from './fixtures/fake-dom.mjs';
import { jpeg, fakeFile } from './fixtures/headers.mjs';

async function setup(lang = 'en', { holdEncode = false, capabilities = true } = {}) {
  const html = await readFile(new URL(`../public/${lang === 'en' ? 'en/' : ''}index.html`, import.meta.url), 'utf8');
  const doc = fakeDocument(html, lang), pending = [], revoked = [], blobs = [], timers = new Map();
  let urls = 0, active = 0, maxActive = 0, decodes = 0;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ setTransform() {}, fillRect() {}, drawImage() {} }),
    toBlob(callback) {
      const bytes = jpeg(canvas.width, canvas.height);
      const complete = () => callback({ type: 'image/jpeg', size: bytes.length, arrayBuffer: async () => bytes.buffer });
      if (holdEncode) pending.push(complete); else complete();
    },
  };
  const adapter = {
    decode() { decodes++; active++; maxActive = Math.max(maxActive, active); return Promise.resolve({ width: 1000, height: 500, close() { active--; } }); },
    getCanvas: () => canvas,
  };
  const output = createOutputState({
    urlApi: { createObjectURL(blob) { blobs.push(blob); return `blob:unit-${++urls}`; }, revokeObjectURL: url => revoked.push(url) },
    makeBlob: (parts, options) => ({ parts, options }),
    setTimer: callback => { timers.set(urls, callback); return urls; }, clearTimer: id => timers.delete(id),
  });
  const app = mountApp(doc, { adapter, output, capabilities });
  const get = id => doc.getElementById(id);
  function add(files) { get('files').files = files; get('files').emit('change'); }
  function action(row, kind) { return get('image-list').children[row].children[2].children.find(node => node.dataset.action === kind); }
  return { doc, get, app, output, pending, revoked, blobs, timers, add, action, get decodes() { return decodes; }, get maxActive() { return maxActive; }, get active() { return active; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const lang of ['zh-Hant', 'en']) test(`offline UI wiring ${lang}: choose/order/rotate/preview/build/download/stale/reset`, async () => {
  const r = await setup(lang), c = COPY[lang];
  assert.equal(r.get('generate').disabled, true);
  r.add(['A', 'B', 'C'].map(name => fakeFile(jpeg(), name)));
  await r.app.whenIdle();
  assert.equal(r.decodes, 0); assert.equal(r.get('generate').disabled, false);
  assert.equal(r.action(2, 'select').disabled, false);
  r.action(2, 'up').click(); r.action(1, 'rotate').click();
  const names = r.get('image-list').children.map(row => row.children[0].children[1].textContent);
  assert.deepEqual(names, ['A', 'C', 'B']);
  assert.equal(r.doc.activeElement.dataset.action, 'rotate');
  r.doc.changeRadio('Letter'); r.doc.changeRadio('landscape');
  r.action(1, 'select').click(); r.get('preview-photo').click();
  await r.app.whenIdle();
  assert.equal(r.decodes, 1); assert.equal(r.blobs[0].options.type, 'image/jpeg');
  assert.equal(r.get('photo-preview').hidden, false);
  r.get('generate').click();
  assert.equal(r.get('photo-preview').hidden, true); assert.equal(r.get('download').hidden, true);
  await r.app.whenIdle();
  assert.equal(r.output.pageCount, 3); assert.equal(r.maxActive, 1); assert.equal(r.active, 0);
  assert.equal(r.decodes, 4); assert.equal(r.get('download').hidden, false);
  r.get('download').click();
  assert.equal(r.doc.downloads[0].filename, 'images-document.pdf');
  const pdf = Buffer.from(r.blobs.at(-1).parts[0]).toString('latin1');
  assert.match(pdf, /\/Count 3 \/Kids \[3 0 R 6 0 R 9 0 R\]/);
  assert.match(pdf, /\/MediaBox \[0 0 792.00 612.00\]/);
  assert.match(pdf, /\/Width 500 \/Height 1000/);
  r.action(0, 'rotate').click(); // Invalidates download synchronously.
  assert.equal(r.get('download').hidden, true); assert.equal(r.output.hasResult, false);
  assert.match(r.get('status').textContent, new RegExp(c.stale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  r.get('clear').click();
  assert.equal(r.get('image-list').children.length, 0); assert.equal(r.get('generate').disabled, true);
  assert.equal(r.get('files').value, ''); assert.equal(r.timers.size, 0);
  r.app.dispose();
});
test('offline UI wiring: malicious filename is text, failed second source clears old result, remove/retry', async () => {
  const r = await setup();
  r.add([fakeFile(jpeg(), '<img src=x onerror=alert(1)>.jpg')]); await r.app.whenIdle();
  const row = r.get('image-list').children[0];
  assert.equal(row.children[0].children[1].textContent, '<img src=x onerror=alert(1)>.jpg');
  assert.ok(row.children.every(node => node.tagName !== 'IMG'));
  r.get('generate').click(); await r.app.whenIdle(); assert.equal(r.output.hasResult, true);
  r.add([fakeFile(new Uint8Array([0]), 'invalid.jpg')]);
  assert.equal(r.get('download').hidden, true); await r.app.whenIdle();
  assert.equal(r.get('error').hidden, false);
  assert.match(r.get('error').textContent, /Image 2, “invalid.jpg”.*UNSUPPORTED_FORMAT/);
  assert.equal(r.output.hasResult, false);
  r.action(1, 'remove').click(); await r.app.whenIdle();
  r.get('generate').click(); await r.app.whenIdle(); assert.equal(r.output.pageCount, 1);
  r.app.dispose();
});
test('offline UI wiring: setting change while encode pending, then retry stays serialized', async () => {
  const r = await setup('en', { holdEncode: true });
  r.add([fakeFile(jpeg())]); await r.app.whenIdle();
  r.get('generate').click(); await settle(); assert.equal(r.pending.length, 1);
  r.doc.changeRadio('landscape');
  assert.equal(r.get('download').hidden, true);
  r.get('generate').click();
  r.pending.shift()(); await settle();
  assert.equal(r.maxActive, 1); assert.equal(r.pending.length, 1);
  r.pending.shift()(); await r.app.whenIdle();
  assert.equal(r.output.hasResult, true); assert.equal(r.output.pageCount, 1);
  r.app.dispose();
});
test('offline UI wiring: cancel pending encode and pagehide never revive old output', async () => {
  const r = await setup('en', { holdEncode: true });
  r.add([fakeFile(jpeg()), fakeFile(jpeg())]); await r.app.whenIdle();
  r.get('generate').click(); await settle(); r.get('cancel').click();
  assert.equal(r.get('cancel').disabled, true); assert.match(r.get('status').textContent, /Stopping/);
  r.pending.shift()(); await r.app.whenIdle(); await settle();
  assert.equal(r.decodes, 1); assert.equal(r.output.hasResult, false); assert.match(r.get('status').textContent, /Cancelled/);
  r.get('generate').click(); await settle(); r.doc.fireWindow('pagehide');
  assert.equal(r.get('image-list').children.length, 0);
  r.pending.shift()(); await r.app.whenIdle();
  assert.equal(r.active, 0); assert.equal(r.output.hasResult, false); assert.equal(r.get('download').hidden, true);
  r.app.dispose();
});
test('offline UI wiring: missing native capabilities clearly block controls; translations match codes', async () => {
  const r = await setup('zh-Hant', { capabilities: false });
  assert.equal(r.get('files').disabled, true); assert.equal(r.get('generate').disabled, true);
  assert.match(r.get('error').textContent, /CANVAS_UNAVAILABLE/);
  assert.deepEqual(Object.keys(COPY.en.errors), Object.keys(COPY['zh-Hant'].errors));
  assert.equal(Object.keys(COPY.en.errors).length, 16);
  r.app.dispose();
});
test('offline UI wiring: download allocation failure clears result and exposes only a fixed error', async () => {
  const r = await setup();
  r.add([fakeFile(jpeg())]); await r.app.whenIdle();
  r.get('generate').click(); await r.app.whenIdle();
  const create = r.doc.createElement;
  r.doc.createElement = tag => { if (tag === 'a') throw new Error('private raw'); return create(tag); };
  r.get('download').click();
  assert.equal(r.output.hasResult, false); assert.equal(r.get('download').hidden, true);
  assert.match(r.get('error').textContent, /PDF_STRUCTURE_ERROR/);
  assert.ok(!r.get('error').textContent.includes('private raw'));
  r.app.dispose();
});
