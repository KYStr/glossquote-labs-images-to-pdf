import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../../scripts/files.mjs';

const repository = path.resolve(ROOT, '../..');
const run = '.runs/batch20-browser-release-2026-10-25/isolated/b20-46-r3';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receipts = [];
for (const file of ['result.json', 'cases/results.json', 'cleanup-job.json', 'parent-cleanup.json']) {
  const bytes = await readFile(path.join(repository, run, file));
  receipts.push({ path: `${run}/${file}`, bytes: bytes.length, sha256: sha(bytes) });
}
const result = JSON.parse(await readFile(path.join(repository, run, 'result.json')));
const cleanup = JSON.parse(await readFile(path.join(repository, run, 'parent-cleanup.json')));
const counts = result.cases.reduce((out, item) => { out[item.status] = (out[item.status] ?? 0) + 1; return out; }, {});
assert.deepEqual(counts, { PASS: 32, NOT_RUN: 10 });
assert.deepEqual(result.failures, []); assert.deepEqual(result.prohibited, []);
assert.equal(result.browserVersion, '145.0.7632.6'); assert.equal(cleanup.status, 'PASS');
const report = {
  task: 'B20-46-M2A', authority: 'Primary B20-46-M2A dispatch: isolated Chromium145 acceptance + actual screenshots reviewed; no browser executed by this owner in M2A.',
  run, browserVersion: result.browserVersion, counts: { PASS: 32, NOT_RUN: 10, FAIL: 0 }, failures: result.failures, prohibited: result.prohibited,
  cases: result.cases.map(item => ({ id: item.id, language: item.language, status: item.status, ...(item.status === 'NOT_RUN' ? { reason: item.observed.notRun } : {}) })),
  downloadedPdfExamples: result.cases.filter(item => ['46-a4-order-rotation-native-jpeg', '46-exif-1-to-8-native-pixels', '46-letter-landscape-fixed-oracle'].includes(item.id)).map(item => {
    const pdf = item.observed.pdf ?? item.observed;
    return { id: item.id, language: item.language, status: item.status, bytes: pdf.bytes, sha256: pdf.sha256, pageCount: pdf.pageCount, pixelResultCount: Array.isArray(item.observed.pixels) ? item.observed.pixels.length : null };
  }),
  cleanup, cleanupNote: 'cleanup-job captured two pending conhost generations; the subsequent primary parent-cleanup receipt verifies both absent. Nothing terminated by M2A.',
  receipts, boundary: 'Old browser acceptance applies to frozen product/runtime. New release footer/config/redirects have offline M2A proof only; live routing/headers and remaining browser NOT_RUN are not promoted to PASS.',
};
await writeFile(path.join(ROOT, 'evidence/m2a/browser-acceptance-reference.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log('PASS browser receipt reference: 32 PASS / 10 NOT_RUN / 0 FAIL, prohibited[], primary cleanup PASS; no browser launched.');
