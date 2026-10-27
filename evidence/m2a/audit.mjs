import assert from 'node:assert/strict';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../../scripts/files.mjs';

const evidence = path.join(ROOT, 'evidence/m2a');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sort = files => files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const aggregate = files => sha(files.map(file => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''));
const save = (file, value) => writeFile(path.join(evidence, file), JSON.stringify(value, null, 2) + '\n');
async function scan(relative = '') {
  if (relative === 'evidence/m2a') return [];
  const target = path.join(ROOT, relative), info = await lstat(target);
  assert.ok(!info.isSymbolicLink());
  if (info.isFile()) {
    const bytes = await readFile(target);
    return [{ path: relative, bytes: bytes.length, sha256: sha(bytes) }];
  }
  assert.ok(info.isDirectory());
  const records = [];
  for (const name of (await readdir(target)).sort()) records.push(...await scan(relative ? `${relative}/${name}` : name));
  return sort(records);
}
function unified(file, before, after) {
  if (before?.equals(after)) return '';
  const lines = bytes => {
    if (!bytes?.length) return [];
    const values = bytes.toString('utf8').replaceAll('\r\n', '\n').split('\n');
    if (values.at(-1) === '') values.pop();
    return values;
  };
  const a = lines(before), b = lines(after), dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { ops.push([' ', a[i++]]); j++; }
    else if (i < a.length && (j === b.length || dp[i + 1][j] >= dp[i][j + 1])) ops.push(['-', a[i++]]);
    else ops.push(['+', b[j++]]);
  }
  const ranges = [];
  for (let at = 0; at < ops.length; at++) if (ops[at][0] !== ' ') {
    const start = Math.max(0, at - 3), end = Math.min(ops.length, at + 4), last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  let text = `diff --git a/${file} b/${file}\n--- ${before === null ? '/dev/null' : `a/${file}`}\n+++ b/${file}\n`;
  for (const [start, end] of ranges) {
    const prefix = ops.slice(0, start), hunk = ops.slice(start, end);
    const oldCount = hunk.filter(([type]) => type !== '+').length, newCount = hunk.filter(([type]) => type !== '-').length;
    const oldStart = prefix.filter(([type]) => type !== '+').length + (oldCount ? 1 : 0);
    const newStart = prefix.filter(([type]) => type !== '-').length + (newCount ? 1 : 0);
    text += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${hunk.map(([type, line]) => type + line).join('\n')}\n`;
  }
  return text;
}

const before = JSON.parse(await readFile(path.join(evidence, 'before-tree.json'))).files;
const after = await scan(), old = new Map(before.map(row => [row.path, row])), current = new Map(after.map(row => [row.path, row]));
const allowedModified = new Set(['HANDOFF.md', 'scripts/check.mjs', 'scripts/release.mjs', 'scripts/release-html.mjs', 'test/release.test.mjs', 'release-artifacts/manifest.json', 'release-artifacts/site/index.html', 'release-artifacts/site/en/index.html']);
const allowedAdded = new Set(['wrangler.jsonc', 'scripts/worker-config.mjs', 'release-artifacts/site/_redirects']);
for (const row of before) {
  assert.ok(current.has(row.path), `Unexpected removal: ${row.path}`);
  if (!allowedModified.has(row.path)) assert.deepEqual(current.get(row.path), row, `Protected bytes changed: ${row.path}`);
}
const changes = [];
for (const row of after) if (!old.has(row.path) || row.sha256 !== old.get(row.path).sha256) {
  assert.ok((old.has(row.path) ? allowedModified : allowedAdded).has(row.path), `Out-of-scope change: ${row.path}`);
  changes.push({ path: row.path, kind: old.has(row.path) ? 'modified' : 'added', before: old.get(row.path) ?? null, after: row });
}
assert.equal(changes.filter(row => !row.path.startsWith('release-artifacts/')).length, 7);
assert.equal(changes.filter(row => row.path.startsWith('release-artifacts/')).length, 4);
const protectedFiles = before.filter(row => !allowedModified.has(row.path));
await save('protected-files.json', { status: 'PASS', unchanged: true, files: protectedFiles });
await save('source-changes.json', { protectedFilesUnchanged: true, changes: changes.filter(row => !row.path.startsWith('release-artifacts/')) });
await save('artifact-changes.json', { changes: changes.filter(row => row.path.startsWith('release-artifacts/')) });

let sourceDiff = '', artifactDiff = '';
for (const row of changes) {
  const priorPath = row.path.startsWith('release-artifacts/')
    ? path.join(evidence, 'previous-release-artifacts', row.path.slice('release-artifacts/'.length))
    : path.join(evidence, 'before-files', row.path === 'HANDOFF.md' ? 'HANDOFF.md.before' : row.path);
  const prior = row.before ? await readFile(priorPath) : null;
  if (prior) assert.equal(sha(prior), row.before.sha256);
  const diff = unified(row.path, prior, await readFile(path.join(ROOT, row.path)));
  if (row.path.startsWith('release-artifacts/')) artifactDiff += diff;
  else sourceDiff += diff;
}
await writeFile(path.join(evidence, 'source.diff'), sourceDiff);
await writeFile(path.join(evidence, 'release.diff'), artifactDiff);

const oldRelease = JSON.parse(await readFile(path.join(evidence, 'previous-release-preservation.json')));
assert.deepEqual((await scan('evidence/m2a/previous-release-artifacts')).map(row => ({ ...row, path: row.path.slice('evidence/m2a/previous-release-artifacts/'.length) })), oldRelease.files);
for (const row of oldRelease.files) {
  const bytes = await readFile(path.join(evidence, 'previous-release-artifacts', row.path));
  assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256);
}
const bodyProof = [];
for (const [file, footer] of [
  ['index.html', '<footer>Gloss Tools by GlossQuote · 本地候選版，尚未公開發布。</footer>'],
  ['en/index.html', '<footer>Gloss Tools by GlossQuote · Local candidate; not publicly released.</footer>'],
]) {
  const previous = await readFile(path.join(evidence, 'previous-release-artifacts/site', file), 'utf8');
  const next = await readFile(path.join(ROOT, 'release-artifacts/site', file), 'utf8');
  assert.equal(previous.split(footer).length, 2);
  assert.equal(next, previous.replace(footer, '<footer>Gloss Tools by GlossQuote</footer>'));
  bodyProof.push({ file, exactAllowlistedFooterOnly: true, seoAndEveryOtherByteUnchanged: true });
}
const template = await readFile(path.resolve(ROOT, '../42-table-reconcile/wrangler.jsonc'));
const config = await readFile(path.join(ROOT, 'wrangler.jsonc'));
assert.equal(config.toString(), template.toString().replace('glossquote-table-reconcile', 'glossquote-images-to-pdf').replace('reconcile.glossquote.com', 'image-pdf.glossquote.com'));
const redirects = await readFile(path.join(ROOT, 'release-artifacts/site/_redirects'));
assert.deepEqual(redirects, Buffer.from('/ /index.html 301\n/en /en/index.html 301\n/en/ /en/index.html 301\n'));
const sources = after.filter(row => !/^(?:dist|release-artifacts|evidence)\//.test(row.path));
const artifacts = after.filter(row => row.path.startsWith('release-artifacts/'));
await save('sources-final.json', { files: sources, aggregateSha256: aggregate(sources), aggregateFormat: 'SHA256 of sorted path + NUL + decimal bytes + NUL + lowercase SHA256 + LF records; UTF-8' });
await save('artifacts-final.json', { files: artifacts, aggregateSha256: aggregate(artifacts) });
await save('release-delta-proof.json', { status: 'PASS', html: bodyProof, unchangedOtherOldSiteFiles: oldRelease.files.filter(row => row.path !== 'manifest.json' && !row.path.endsWith('.html')).length, configTemplate: { path: 'tool-projects/42-table-reconcile/wrangler.jsonc', bytes: template.length, sha256: sha(template), exactExceptNameAndDomain: true }, redirects: { bytes: redirects.length, sha256: sha(redirects), lines: 3, finalLF: true, CRBytes: 0 }, oldReleaseManifestSha256: oldRelease.manifestSha256, newReleaseManifestSha256: current.get('release-artifacts/manifest.json').sha256 });
const summary = {
  task: 'B20-46-M2A', status: 'PASS', protectedFilesUnchanged: protectedFiles.length,
  sourceChanged: 7, sources: sources.length, sourceBytes: sources.reduce((n, row) => n + row.bytes, 0), sourceAggregateSha256: aggregate(sources),
  artifacts: artifacts.length, artifactBytes: artifacts.reduce((n, row) => n + row.bytes, 0), artifactAggregateSha256: aggregate(artifacts),
  releaseManifestSha256: current.get('release-artifacts/manifest.json').sha256,
};
await save('audit-summary.json', summary);
console.log(JSON.stringify(summary, null, 2));
