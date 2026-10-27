import test from 'node:test';
import assert from 'node:assert/strict';
import { computePageLayout, pdfNumber } from '../public/js/core/page-layout.mjs';
import { moveItem, rotateItem, pageSpecs } from '../public/js/core/selection.mjs';
test('A08 ordering and turns serialized without mutation', () => {
  const source = ['A', 'B', 'C'].map(id => ({ id, metadata: { id }, rotationQuarterTurns: 0 }));
  let items = moveItem(source, 2, -1);
  items = rotateItem(rotateItem(items, 1), 1);
  assert.deepEqual(items.map(i => i.id), ['A', 'C', 'B']);
  assert.deepEqual(pageSpecs(items), [{ id: 'A', rotationQuarterTurns: 0 }, { id: 'C', rotationQuarterTurns: 2 }, { id: 'B', rotationQuarterTurns: 0 }]);
  assert.equal(source[2].rotationQuarterTurns, 0);
  assert.equal(rotateItem(rotateItem(items, 1), 1)[1].rotationQuarterTurns, 0);
});
test('A09 independent A4 1000x500 oracle', () => {
  const p = computePageLayout(1000, 500);
  assert.deepEqual(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, pdfNumber(v)])), {
    pageWidthPt: '595.28', pageHeightPt: '841.89', xPt: '28.35', yPt: '286.30', widthPt: '538.58', heightPt: '269.29',
  });
  assert.ok(Math.abs(p.widthPt / 1000 - 0.53858) < 1e-12);
});
test('A10 Letter landscape explicit contain oracle', () => {
  const p = computePageLayout(100, 200, { paper: 'Letter', orientation: 'landscape' });
  assert.deepEqual(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, pdfNumber(v)])), {
    pageWidthPt: '792.00', pageHeightPt: '612.00', xPt: '257.18', yPt: '28.35', widthPt: '277.65', heightPt: '555.30',
  });
});
test('all supported papers contain extreme tall/wide images with margin and matching aspect', () => {
  for (const paper of ['A4', 'Letter']) for (const orientation of ['portrait', 'landscape']) {
    for (const [w, h] of [[1, 8192], [8192, 1], [4000, 4000]]) {
      const p = computePageLayout(w, h, { paper, orientation });
      assert.ok(p.xPt >= 28.35 - 1e-8 && p.yPt >= 28.35 - 1e-8);
      assert.ok(p.xPt + p.widthPt <= p.pageWidthPt - 28.35 + 1e-8);
      assert.ok(p.yPt + p.heightPt <= p.pageHeightPt - 28.35 + 1e-8);
      assert.ok(Math.abs(p.widthPt / p.heightPt - w / h) < 1e-8);
    }
  }
});
test('invalid numbers/settings and raised hard caps fail closed', () => {
  for (const [w, h] of [[NaN, 1], [Infinity, 1], [-1, 1], [0, 0], [8193, 1], [4001, 4000], [1.5, 1]]) assert.throws(() => computePageLayout(w, h), { code: 'PDF_STRUCTURE_ERROR' });
  for (const settings of [{ paper: 'A3' }, { paper: 'toString' }, { orientation: 'auto' }, { marginPt: 0 }]) assert.throws(() => computePageLayout(1, 1, settings), { code: 'PDF_STRUCTURE_ERROR' });
});
