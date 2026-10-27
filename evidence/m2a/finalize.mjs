import assert from 'node:assert/strict';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../../scripts/files.mjs';

const evidence = path.resolve(ROOT, 'evidence/m2a');
const freezeFile = path.join(evidence, 'FREEZE.json');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async relative => JSON.parse(await readFile(path.join(ROOT, relative)));
const aggregate = files => sha(files.map(row => `${row.path}\0${row.bytes}\0${row.sha256}\n`).join(''));
async function verify(records, base = ROOT) {
  for (const row of records) {
    assert.match(row.path, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/);
    assert.ok(!row.path.split('/').some(part => part === '.' || part === '..'));
    const target = path.resolve(base, ...row.path.split('/'));
    assert.ok(path.relative(base, target) !== '..' && !path.relative(base, target).startsWith('..' + path.sep));
    const info = await lstat(target); assert.ok(info.isFile() && !info.isSymbolicLink());
    const bytes = await readFile(target);
    assert.equal(bytes.length, row.bytes, row.path); assert.equal(sha(bytes), row.sha256, row.path);
  }
}
const sources = await json('evidence/m2a/sources-final.json');
const artifacts = await json('evidence/m2a/artifacts-final.json');
const summary = await json('evidence/m2a/audit-summary.json');
const protectedFiles = await json('evidence/m2a/protected-files.json');
const previous = await json('evidence/m2a/previous-release-preservation.json');
await verify(sources.files); await verify(artifacts.files); await verify(protectedFiles.files);
await verify(previous.files, path.join(evidence, 'previous-release-artifacts'));
assert.equal(aggregate(sources.files), sources.aggregateSha256);
assert.equal(aggregate(artifacts.files), artifacts.aggregateSha256);
assert.equal(summary.status, 'PASS'); assert.equal(previous.status, 'PASS');
const commands = await json('evidence/m2a/final-commands.json');
assert.deepEqual(commands.results.map(row => row.command), ['node --test test/release.test.mjs', 'npm run check', 'npm run build:release', 'npm run check:release']);
assert.equal(commands.shell, false); assert.equal(commands.windowsHide, true);
for (const result of commands.results) {
  assert.equal(result.exit, 0); assert.equal(result.signal, null); assert.equal(result.error, null);
  assert.equal(sha(await readFile(path.join(evidence, result.log))), result.logSha256);
}
assert.deepEqual(commands.results[0].counts, { tests: 21, pass: 21, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
const before = await json('evidence/m2a/environment-before.json'), after = await json('evidence/m2a/environment-after.json');
assert.equal(before.Status, 'PASS'); assert.equal(after.Status, 'PASS'); assert.deepEqual(after.Snapshots, before.Snapshots);
assert.ok(after.Snapshots.every(row => row.EphemeralEntries.length === 0));
const browser = await json('evidence/m2a/browser-acceptance-reference.json');
await verify(browser.receipts, path.resolve(ROOT, '../..'));
assert.deepEqual(browser.counts, { PASS: 32, NOT_RUN: 10, FAIL: 0 });
assert.deepEqual(browser.prohibited, []); assert.equal(browser.cleanup.status, 'PASS');
const localLinks = [];
for (const relative of ['HANDOFF.md', 'evidence/m2a/00-START-HERE.md']) {
  const text = await readFile(path.join(ROOT, relative), 'utf8');
  for (const [, destination] of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^https:\/\//.test(destination) || destination.startsWith('#')) continue;
    assert.ok(!/[:\\]/.test(destination) && !path.isAbsolute(destination), `Nonportable document link: ${destination}`);
    const target = path.resolve(path.dirname(path.join(ROOT, relative)), destination.split('#')[0]);
    assert.ok(!path.relative(ROOT, target).startsWith('..' + path.sep));
    if (target !== freezeFile) assert.ok((await lstat(target)).isFile(), destination);
    localLinks.push({ from: relative, target: path.relative(ROOT, target).split(path.sep).join('/') });
  }
}
async function scan(directory, relative = 'evidence/m2a') {
  assert.ok(!(await lstat(directory)).isSymbolicLink());
  const out = [];
  for (const name of (await readdir(directory)).sort()) {
    const target = path.join(directory, name), rel = `${relative}/${name}`;
    if (target === freezeFile) continue;
    const info = await lstat(target); assert.ok(!info.isSymbolicLink());
    if (info.isDirectory()) out.push(...await scan(target, rel));
    else {
      assert.ok(info.isFile()); const bytes = await readFile(target);
      out.push({ path: rel, bytes: bytes.length, sha256: sha(bytes) });
    }
  }
  return out.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
const evidenceFiles = await scan(evidence);
await verify(evidenceFiles);
const freeze = {
  task: 'B20-46-M2A', status: 'PREPARED_AWAITING_PRIMARY_M2B',
  sourceFiles: sources.files.length, sourceBytes: summary.sourceBytes, sourceAggregateSha256: sources.aggregateSha256,
  artifactFiles: artifacts.files.length, artifactBytes: summary.artifactBytes, artifactAggregateSha256: artifacts.aggregateSha256,
  releaseManifestSha256: summary.releaseManifestSha256, previousReleaseManifestSha256: previous.manifestSha256,
  protectedFilesUnchanged: protectedFiles.files.length,
  commands: commands.results.map(({ command, exit, counts, log, logSha256 }) => ({ command, exit, counts, log, logSha256 })),
  environment: { status: 'PASS', fullSnapshotsIdentical: true, snapshots: after.Snapshots },
  browser: { source: 'primary b20-46-r3; no new browser run', counts: browser.counts, prohibited: [], cleanup: 'PASS', remainingNotRunPreserved: true },
  publication: 'NOT_RUN_M2A_PREP_ONLY; no repository/commit verified', deployment: 'NOT_RUN_M2A_PREP_ONLY; live routing/headers/404 not verified', homepage: 'NOT_RUN', externalReview: 'NOT_RUN',
  localDocumentLinks: { status: 'PASS', count: localLinks.length, links: localLinks },
  evidenceFiles, evidenceAggregateSha256: aggregate(evidenceFiles), evidenceIndexExcludesSelf: 'FREEZE.json',
};
await writeFile(freezeFile, JSON.stringify(freeze, null, 2) + '\n', { flag: 'wx' });
for (const link of localLinks) assert.ok((await lstat(path.join(ROOT, link.target))).isFile());
const bytes = await readFile(freezeFile);
console.log(JSON.stringify({ status: 'PASS', sourceFiles: sources.files.length, artifactFiles: artifacts.files.length, evidenceFiles: evidenceFiles.length, localLinks: localLinks.length, freezeBytes: bytes.length, freezeSha256: sha(bytes) }, null, 2));
