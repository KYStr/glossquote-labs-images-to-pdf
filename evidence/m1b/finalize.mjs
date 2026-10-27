import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function file(relative) {
  if (!relative || path.posix.isAbsolute(relative) || relative.includes('\\') || relative.includes(':') || relative.split('/').includes('..')) throw Error('Unsafe path');
  return path.join(root, ...relative.split('/'));
}
const readJson = async relative => JSON.parse(await readFile(file(relative), 'utf8'));
async function record(relative) {
  const stat = await lstat(file(relative)); if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Non-file refused');
  const bytes = await readFile(file(relative)); return { path: relative, bytes: bytes.length, sha256: hash(bytes) };
}
async function emit(relative, value) { await writeFile(file(relative), JSON.stringify(value, null, 2) + '\n'); return record(relative); }
const sources = await readJson('evidence/m1b/sources-final.json');
const artifacts = await readJson('evidence/m1b/artifacts-final.json');
const changes = await readJson('evidence/m1b/source-changes.json');
const before = await readJson('evidence/m1b/protected-before.json');
const after = await readJson('evidence/m1b/protected-after.json');
if (JSON.stringify(before) !== JSON.stringify(after) || !changes.protectedFilesUnchanged) throw Error('Protected files differ');
for (const expected of [...sources.files, ...artifacts.files, ...after.files]) {
  const actual = await record(expected.path);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw Error('Frozen bytes differ');
}
const envBefore = await readJson('evidence/m1b/environment-before.json'), envAfter = await readJson('evidence/m1b/environment-after.json');
if (envBefore.Status !== 'PASS' || envAfter.Status !== 'PASS' || JSON.stringify(envBefore.Snapshots) !== JSON.stringify(envAfter.Snapshots)) throw Error('Environment differs');
const commands = await readJson('evidence/m1b/final-commands.json');
if (commands.results.length !== 4 || commands.results.some(command => command.exit !== 0) || commands.results[0].counts.tests !== 61 || commands.results[0].counts.pass !== 61) throw Error('Command gate mismatch');

let diff = '';
const lines = text => { const out = text.replace(/\r\n/g, '\n').split('\n'); if (out.at(-1) === '') out.pop(); return out; };
for (const change of changes.changes) {
  const next = lines(await readFile(file(change.path), 'utf8'));
  diff += `diff --git a/${change.path} b/${change.path}\n`;
  if (change.kind === 'added') {
    diff += `new file mode 100644\n--- /dev/null\n+++ b/${change.path}\n@@ -0,0 +1,${next.length} @@\n` + next.map(line => '+' + line + '\n').join('');
  } else {
    const previousBytes = await readFile(file(`evidence/m1b/baseline/${change.path}.before`));
    if (hash(previousBytes) !== change.before.sha256) throw Error('Baseline copy differs');
    const old = lines(previousBytes.toString('utf8'));
    let prefix = 0, suffix = 0;
    while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
    while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
    const begin = Math.max(prefix - 3, 0), endOld = Math.min(old.length, old.length - suffix + 3), endNew = Math.min(next.length, next.length - suffix + 3);
    diff += `--- a/${change.path}\n+++ b/${change.path}\n@@ -${begin + 1},${endOld - begin} +${begin + 1},${endNew - begin} @@\n`;
    diff += old.slice(begin, prefix).map(line => ' ' + line + '\n').join('');
    diff += old.slice(prefix, old.length - suffix).map(line => '-' + line + '\n').join('');
    diff += next.slice(prefix, next.length - suffix).map(line => '+' + line + '\n').join('');
    diff += old.slice(old.length - suffix, endOld).map(line => ' ' + line + '\n').join('');
  }
}
await writeFile(file('evidence/m1b/review.diff'), diff);
let portableLinks = 0;
for (const source of sources.files.filter(source => source.path.endsWith('.md'))) {
  const text = await readFile(file(source.path), 'utf8');
  for (const [, href] of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^https?:\/\//.test(href)) continue;
    const target = href.split('#')[0]; if (!target) continue;
    await lstat(file(path.posix.normalize(path.posix.join(path.posix.dirname(source.path), target)))); portableLinks++;
  }
}
const evidence = [];
async function walk(relative) {
  for (const entry of (await readdir(file(relative), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const next = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw Error('Evidence link refused');
    if (entry.isDirectory()) await walk(next);
    else if (!['evidence/m1b/evidence-files.json', 'evidence/m1b/FREEZE.json'].includes(next)) evidence.push(await record(next));
  }
}
await walk('evidence/m1b');
const evidenceManifest = await emit('evidence/m1b/evidence-files.json', { schemaVersion: 1, excludes: ['evidence-files.json', 'FREEZE.json'], files: evidence });
const sourceManifest = await record('evidence/m1b/sources-final.json'), artifactManifest = await record('evidence/m1b/artifacts-final.json');
const manifest = await record('release-artifacts/manifest.json');
const summary = {
  task: 'B20-RP-46 / M1B', status: 'OFFLINE_RELEASE_CANDIDATE_BROWSER_REQUIRED', origin: 'https://image-pdf.glossquote.com', toolSlug: 'images-to-pdf',
  sourceFiles: sources.files.length, sourceBytes: sources.files.reduce((n, f) => n + f.bytes, 0), sourceAggregateSha256: sources.aggregateSha256,
  artifactFiles: artifacts.files.length, artifactBytes: artifacts.files.reduce((n, f) => n + f.bytes, 0), artifactAggregateSha256: artifacts.aggregateSha256,
  changedSourceFiles: changes.changes.length, protectedFiles: before.files.length, protectedBytesUnchanged: true, environmentFullSnapshotsEqual: true,
  sourceManifest, artifactManifest, releaseManifest: manifest, evidenceManifest, portableDocumentLinksChecked: portableLinks,
  tests: commands.results[0].counts, browser: 'NOT_RUN_USER_FOCUS_INCIDENT', github: 'NOT_PUBLISHED', hosting: 'NOT_PUBLISHED', homepage: 'NOT_INTEGRATED',
};
const freeze = await emit('evidence/m1b/FREEZE.json', summary);
console.log(JSON.stringify({ ...summary, freeze }, null, 2));
