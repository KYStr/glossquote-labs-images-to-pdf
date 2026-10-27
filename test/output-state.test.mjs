import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutputState } from '../public/js/core/output-state.mjs';
function setup() {
  let count = 0;
  const revoked = [], timers = new Map();
  const output = createOutputState({
    urlApi: { createObjectURL: () => `blob:synthetic-${++count}`, revokeObjectURL: url => revoked.push(url) },
    makeBlob: (parts, options) => ({ parts, options }),
    setTimer: (callback, delay) => { assert.equal(delay, 60_000); timers.set(count, callback); return count; },
    clearTimer: id => timers.delete(id),
  });
  return { output, revoked, timers, get count() { return count; } };
}
test('publishing never creates a URL; explicit download binds to current generation', () => {
  const r = setup(), token = r.output.generation;
  assert.equal(r.output.publish(new Uint8Array([1, 2]), 2, token), true);
  assert.equal(r.count, 0); assert.equal(r.output.hasResult, true);
  assert.equal(r.output.downloadUrl(), 'blob:synthetic-1');
  r.output.invalidate();
  assert.equal(r.output.hasResult, false); assert.equal(r.output.downloadUrl(), null);
  assert.deepEqual(r.revoked, ['blob:synthetic-1']);
  assert.equal(r.output.publish(new Uint8Array([1]), 1, token), false);
});
test('preview/download expiry <=60s, reset/pagehide/dispose idempotent and no stale preview', () => {
  const r = setup(); let expired = 0;
  r.output.previewUrl(new Uint8Array([1]), r.output.generation, () => expired++);
  [...r.timers.values()][0]();
  assert.equal(expired, 1); assert.deepEqual(r.revoked, ['blob:synthetic-1']);
  const old = r.output.generation;
  r.output.dispose(); r.output.dispose();
  assert.equal(r.output.previewUrl(new Uint8Array([1]), old), null);
  assert.equal(r.count, 1); assert.equal(r.timers.size, 0);
});
test('repeated download clicks reuse one URL until expiry, then create one fresh URL', () => {
  const r = setup();
  r.output.publish(new Uint8Array([1]), 1, r.output.generation);
  assert.equal(r.output.downloadUrl(), 'blob:synthetic-1');
  for (let i = 0; i < 30; i++) assert.equal(r.output.downloadUrl(), 'blob:synthetic-1');
  assert.equal(r.count, 1);
  [...r.timers.values()][0]();
  assert.equal(r.output.downloadUrl(), 'blob:synthetic-2');
  assert.equal(r.count, 2); r.output.dispose();
});
