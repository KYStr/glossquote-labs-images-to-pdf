import { readFile, writeFile, readdir, lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const protectedRoots = ['public', 'dist', 'evidence/m1', 'AGENTS.md', 'START-HERE.md', 'README.md', 'PRODUCT.md', 'TECHNICAL.md', 'UX-SEO.md', 'ACCEPTANCE.md', 'TASKS.md', 'docs'];
const sourceRoots = ['.gitignore', 'package.json', 'AGENTS.md', 'START-HERE.md', 'README.md', 'PRODUCT.md', 'TECHNICAL.md', 'UX-SEO.md', 'ACCEPTANCE.md', 'TASKS.md', 'HANDOFF.md', 'TASK-ENTRY.md', 'docs', 'public', 'scripts', 'test'];
async function scan(relative) {
  const target = path.join(root, relative), stat = await lstat(target);
  if (stat.isSymbolicLink()) throw Error('Audit refused link');
  if (stat.isFile()) {
    const bytes = await readFile(target);
    return [{ path: relative, bytes: bytes.length, sha256: sha(bytes) }];
  }
  const out = [];
  for (const name of (await readdir(target)).sort()) out.push(...await scan(`${relative}/${name}`));
  return out;
}
async function snapshot(roots) {
  const files = [];
  for (const relative of roots) files.push(...await scan(relative));
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
async function save(file, data) { await writeFile(path.join(root, 'evidence/m1b', file), JSON.stringify(data, null, 2) + '\n'); }
const mode = process.argv[2];
if (mode === 'before') {
  const protectedFiles = await snapshot(protectedRoots), sources = await snapshot(sourceRoots);
  const m1 = JSON.parse(await readFile(path.join(root, 'evidence/m1/frozen-sources.json')));
  for (const file of protectedFiles.filter(file => file.path.startsWith('public/'))) {
    const old = m1.files.find(entry => entry.path === file.path);
    if (!old || old.bytes !== file.bytes || old.sha256 !== file.sha256) throw Error('Public differs from frozen M1');
  }
  await save('protected-before.json', { files: protectedFiles });
  await save('sources-before.json', { files: sources });
  await mkdir(path.join(root, 'evidence/m1b/baseline'), { recursive: true });
  for (const name of ['package.json', '.gitignore', 'HANDOFF.md', 'TASK-ENTRY.md']) await writeFile(path.join(root, 'evidence/m1b/baseline', `${name}.before`), await readFile(path.join(root, name)));
  console.log(`PASS baseline: ${protectedFiles.length} protected files; ${sources.length} source files; public equals frozen M1.`);
} else if (mode === 'after') {
  const after = await snapshot(protectedRoots);
  const before = JSON.parse(await readFile(path.join(root, 'evidence/m1b/protected-before.json'))).files;
  await save('protected-after.json', { files: after });
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Protected bytes changed; STOP');
  const sources = [...await snapshot(sourceRoots), ...await scan('M1B-RELEASE.md')].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const old = JSON.parse(await readFile(path.join(root, 'evidence/m1b/sources-before.json'))).files;
  const changes = [];
  for (const file of sources) {
    const previous = old.find(entry => entry.path === file.path);
    if (!previous || previous.sha256 !== file.sha256) changes.push({ path: file.path, kind: previous ? 'modified' : 'added', before: previous ?? null, after: file });
  }
  if (old.some(file => !sources.some(entry => entry.path === file.path))) throw Error('Source removed');
  if (changes.some(file => !['package.json', '.gitignore', 'HANDOFF.md', 'TASK-ENTRY.md', 'M1B-RELEASE.md'].includes(file.path) && !/^(scripts|test)\//.test(file.path))) throw Error('Out-of-scope source change');
  await save('source-changes.json', { protectedFilesUnchanged: true, changes });
  await save('sources-final.json', { files: sources, aggregateSha256: sha(sources.map(file => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('')) });
  const artifacts = await scan('release-artifacts');
  await save('artifacts-final.json', { files: artifacts, aggregateSha256: sha(artifacts.map(file => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('')) });
  console.log(JSON.stringify({ status: 'PASS', protectedFiles: after.length, changedSourceFiles: changes.length, sources: sources.length, sourceBytes: sources.reduce((n, f) => n + f.bytes, 0), sourceAggregate: sha(sources.map(file => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('')), artifactFiles: artifacts.length, artifactBytes: artifacts.reduce((n, f) => n + f.bytes, 0), artifactAggregate: sha(artifacts.map(file => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('')) }, null, 2));
} else throw Error('Audit mode must be before or after');
