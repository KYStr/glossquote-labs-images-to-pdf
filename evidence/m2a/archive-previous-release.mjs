import assert from 'node:assert/strict';
import { lstat, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../../scripts/files.mjs';

const evidence = path.resolve(ROOT, 'evidence/m2a');
const source = path.resolve(ROOT, 'release-artifacts');
const destination = path.resolve(evidence, 'previous-release-artifacts');
const OLD_MANIFEST_SHA = 'b89031e973e6b0ba6aa54b2bfe2f8852e19217c669816598a82f7d645d16184a';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function inventory(directory) {
  const files = [];
  async function walk(current, relative = '') {
    const info = await lstat(current);
    assert.ok(info.isDirectory() && !info.isSymbolicLink());
    for (const name of (await readdir(current)).sort()) {
      assert.match(name, /^[A-Za-z0-9_.-]+$/);
      assert.ok(name !== '.' && name !== '..');
      const target = path.join(current, name), rel = relative ? `${relative}/${name}` : name;
      const stat = await lstat(target);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) await walk(target, rel);
      else {
        assert.ok(stat.isFile());
        const bytes = await readFile(target);
        files.push({ path: rel, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  await walk(directory);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export async function archivePreviousRelease() {
  // This task-authorized one-time move never repairs/deletes/overwrites release output.
  // Validate resolved absolute source and destination parents before the directory move.
  const canonicalRoot = await realpath(ROOT);
  assert.equal(path.relative(canonicalRoot, await realpath(source)), 'release-artifacts');
  assert.equal(path.relative(canonicalRoot, await realpath(evidence)), path.join('evidence', 'm2a'));
  assert.equal(path.dirname(source), path.resolve(ROOT));
  assert.equal(path.dirname(destination), evidence);
  assert.equal(path.basename(destination), 'previous-release-artifacts');
  await assert.rejects(lstat(destination), { code: 'ENOENT' });
  const manifest = await readFile(path.join(source, 'manifest.json'));
  assert.equal(hash(manifest), OLD_MANIFEST_SHA);
  const frozen = JSON.parse(await readFile(path.join(ROOT, 'evidence/m1b/artifacts-final.json')));
  const before = JSON.parse(await readFile(path.join(evidence, 'before-tree.json')));
  const expected = frozen.files.map(row => ({ ...row, path: row.path.replace(/^release-artifacts\//, '') }));
  assert.equal(expected.length, 17);
  const files = await inventory(source);
  assert.deepEqual(files, expected);
  assert.deepEqual(before.files.filter(row => row.path.startsWith('release-artifacts/')).map(row => ({ ...row, path: row.path.slice('release-artifacts/'.length) })), files);
  const report = {
    task: 'B20-46-M2A', original: 'release-artifacts', archive: 'evidence/m2a/previous-release-artifacts',
    manifestSha256: OLD_MANIFEST_SHA, files, oldEvidence: 'evidence/m1b/artifacts-final.json',
    preservation: 'full bytes retained; no deletion or overwrite',
  };
  await writeFile(path.join(evidence, 'previous-release-before-move.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  await rename(source, destination);
  assert.deepEqual(await inventory(destination), files);
  await assert.rejects(lstat(source), { code: 'ENOENT' });
  await writeFile(path.join(evidence, 'previous-release-preservation.json'), JSON.stringify({ status: 'PASS', ...report }, null, 2) + '\n', { flag: 'wx' });
  console.log('PASS previous release: all 17 frozen files moved intact inside evidence/m2a; old manifest SHA unchanged.');
}
