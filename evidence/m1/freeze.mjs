import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Background bytes-only inventory. No browser/server/process launch or environment read.
const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = 'evidence/m1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function safe(relative) {
  if (!relative || relative.includes('\\') || relative.includes(':') || path.posix.isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === '')) throw Error('Unsafe portable path');
  return path.join(root, ...relative.split('/'));
}
async function entries(relative) {
  const target = safe(relative), stat = await lstat(target);
  if (stat.isSymbolicLink()) throw Error('Link refused');
  if (stat.isFile()) {
    const bytes = await readFile(target);
    return [{ path: relative, bytes: bytes.length, sha256: hash(bytes) }];
  }
  if (!stat.isDirectory()) throw Error('Special file refused');
  const files = [];
  for (const item of (await readdir(target)).sort()) files.push(...await entries(`${relative}/${item}`));
  return files;
}
async function emit(relative, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  await writeFile(safe(relative), bytes);
  return { path: relative, bytes: bytes.length, sha256: hash(bytes) };
}
const sourceRoots = ['.gitignore', 'package.json', 'AGENTS.md', 'START-HERE.md', 'README.md', 'PRODUCT.md', 'TECHNICAL.md', 'UX-SEO.md', 'ACCEPTANCE.md', 'TASKS.md', 'HANDOFF.md', 'TASK-ENTRY.md', 'docs', 'public', 'scripts', 'test'];
const sources = [];
for (const name of sourceRoots) sources.push(...await entries(name));
sources.sort((a, b) => a.path.localeCompare(b.path, 'en'));
const dist = await entries('dist');
for (const file of dist) {
  const source = sources.find(source => source.path === file.path.replace(/^dist\//, 'public/'));
  if (!source || source.bytes !== file.bytes || source.sha256 !== file.sha256) throw Error('dist/public byte mismatch');
}
let links = 0;
for (const file of sources.filter(file => file.path.endsWith('.md'))) {
  const markdown = await readFile(safe(file.path), 'utf8');
  for (const [, href] of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    if (/^https?:\/\//.test(href)) continue;
    const target = href.split('#')[0];
    if (!target) continue;
    const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), target));
    // Links to manifests are emitted below. Other documents must already exist.
    if (!['evidence/m1/FREEZE.json', 'evidence/m1/frozen-sources.json', 'evidence/m1/frozen-dist.json'].includes(normalized)) await lstat(safe(normalized));
    links++;
  }
}
const sourceManifest = await emit(`${evidence}/frozen-sources.json`, { format: 1, scope: 'M1 source and read-only specifications; excludes dist/evidence', files: sources });
const distManifest = await emit(`${evidence}/frozen-dist.json`, { format: 1, scope: 'preview dist; each file equals corresponding public bytes', files: dist });
const evidenceFiles = (await entries(evidence)).filter(file => !['evidence/m1/evidence-files.json', 'evidence/m1/FREEZE.json'].includes(file.path));
const evidenceManifest = await emit(`${evidence}/evidence-files.json`, { format: 1, scope: 'excludes this manifest and FREEZE.json to avoid circular hashing', files: evidenceFiles });
const commands = JSON.parse(await readFile(safe(`${evidence}/final-commands.json`)));
const guard = JSON.parse(await readFile(safe(`${evidence}/environment-comparison.json`), 'utf8'));
if (commands.results.some(result => result.exit !== 0) || commands.results[0].counts.tests !== 49 || guard.Status !== 'PASS' || guard.FullSnapshotsEqual !== true) throw Error('Verification/guard mismatch');
const sourceAggregate = hash(sources.map(file => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''));
const record = await emit(`${evidence}/FREEZE.json`, {
  candidate: 'B20-46-M1 / 0.1.0-m1', status: 'M1_NODE_CANDIDATE_BROWSER_REQUIRED',
  sourceFileCount: sources.length, sourceTotalBytes: sources.reduce((total, file) => total + file.bytes, 0), sourceAggregateSha256: sourceAggregate,
  distFileCount: dist.length, distTotalBytes: dist.reduce((total, file) => total + file.bytes, 0),
  sourceManifest, distManifest, evidenceManifest, portableDocumentLinksChecked: links,
  tests: commands.results[0].counts, environmentFullSnapshotsEqual: true,
  browser: 'NOT_RUN_USER_FOCUS_INCIDENT', sourceCommit: null, reviewedCommit: null, releasedCommit: null,
  github: 'NOT_PUBLISHED', hosting: 'NOT_PUBLISHED', homepage: 'NOT_INTEGRATED', archive: 'PRIMARY_SINGLE_COMBINED_ZIP',
});
for (const file of [...sources, ...dist, ...evidenceFiles, sourceManifest, distManifest, evidenceManifest, record]) {
  const bytes = await readFile(safe(file.path));
  if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw Error('Frozen bytes changed');
}
console.log(JSON.stringify({ status: 'PASS', sourceFiles: sources.length, sourceTotalBytes: sources.reduce((n, file) => n + file.bytes, 0), sourceAggregateSha256: sourceAggregate, distFiles: dist.length, portableDocumentLinksChecked: links, freeze: record }, null, 2));
