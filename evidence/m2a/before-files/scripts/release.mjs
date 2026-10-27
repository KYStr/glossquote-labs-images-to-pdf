import { readFile, writeFile, readdir, lstat, realpath, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import baseline from './release-baseline.json' with { type: 'json' };
import { ROOT, PUBLIC_FILES, requireNode } from './files.mjs';
import { CSP } from './serve.mjs'; // Import only: its CLI entry guard does not start a listener.
import { renderReleaseHtml, validateReleaseHtml } from './release-html.mjs';

export const RELEASE_ORIGIN = 'https://image-pdf.glossquote.com';
export const TOOL_SLUG = 'images-to-pdf';
const SITE_FILES = Object.freeze([...new Set([...PUBLIC_FILES, 'robots.txt', '_headers', 'sitemap.xml'])].sort());
const OUTPUT_FILES = Object.freeze(['manifest.json', ...SITE_FILES.map(file => `site/${file}`)].sort());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function reject(code) { throw new Error(code); }
function sameKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function safePath(relative) {
  if (typeof relative !== 'string' || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(relative) || relative.split('/').some(part => part === '.' || part === '..')) reject('RELEASE_PATH_INVALID');
  return relative;
}
function local(root, relative) { return path.join(root, ...safePath(relative).split('/')); }
async function inventory(directory, allowlist, { optional = false } = {}) {
  let info;
  try { info = await lstat(directory); }
  catch (error) { if (error.code === 'ENOENT' && optional) return null; reject('RELEASE_INPUT_OR_OUTPUT_MISSING'); }
  if (!info.isDirectory() || info.isSymbolicLink()) reject('RELEASE_LINK_OR_DIRECTORY_INVALID');
  const canonical = await realpath(directory), files = [];
  async function walk(current, relative) {
    for (const name of (await readdir(current)).sort()) {
      const rel = relative ? `${relative}/${name}` : name;
      safePath(rel);
      const target = path.join(current, name), stat = await lstat(target);
      if (stat.isSymbolicLink()) reject('RELEASE_LINK_OR_DIRECTORY_INVALID');
      const resolved = await realpath(target), suffix = path.relative(canonical, resolved);
      if (suffix.startsWith('..') || path.isAbsolute(suffix)) reject('RELEASE_PATH_INVALID');
      if (stat.isDirectory()) {
        if (!allowlist.some(file => file.startsWith(rel + '/'))) reject('RELEASE_UNKNOWN_PATH');
        await walk(target, rel);
      } else if (stat.isFile() && allowlist.includes(rel)) files.push(rel);
      else reject('RELEASE_UNKNOWN_PATH');
    }
  }
  await walk(directory, '');
  return files.sort();
}
function validateRecords(records) {
  if (!Array.isArray(records)) reject('RELEASE_MANIFEST_INVALID');
  let previous = '';
  for (const record of records) {
    if (!sameKeys(record, ['path', 'bytes', 'sha256'])) reject('RELEASE_MANIFEST_INVALID');
    safePath(record.path);
    if (record.path <= previous || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.sha256)) reject('RELEASE_MANIFEST_INVALID');
    previous = record.path;
  }
}
function validateManifest(bytes) {
  if (bytes.length > 1_048_576) reject('RELEASE_MANIFEST_INVALID');
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { reject('RELEASE_MANIFEST_INVALID'); }
  if (!sameKeys(data, ['schemaVersion', 'mode', 'origin', 'toolSlug', 'files', 'sourceFiles']) || data.schemaVersion !== 1 || data.mode !== 'release-candidate' || data.origin !== RELEASE_ORIGIN || data.toolSlug !== TOOL_SLUG) reject('RELEASE_MANIFEST_INVALID');
  validateRecords(data.files); validateRecords(data.sourceFiles);
  return data;
}
async function sourceBytes(root) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) reject('RELEASE_LINK_OR_DIRECTORY_INVALID');
  const names = await inventory(path.join(root, 'public'), PUBLIC_FILES);
  if (JSON.stringify(names) !== JSON.stringify([...PUBLIC_FILES].sort())) reject('RELEASE_SOURCE_CHANGED');
  if (baseline.schemaVersion !== 1) reject('RELEASE_SOURCE_CHANGED');
  validateRecords(baseline.publicFiles);
  const source = new Map(), records = [];
  for (const file of names) {
    const bytes = await readFile(local(path.join(root, 'public'), file));
    source.set(file, bytes); records.push({ path: file, bytes: bytes.length, sha256: hash(bytes) });
  }
  // This pin comes from frozen M1 bytes, not the mutable release manifest.
  if (JSON.stringify(records) !== JSON.stringify(baseline.publicFiles)) reject('RELEASE_SOURCE_CHANGED');
  if (baseline.securitySource.path !== 'scripts/serve.mjs') reject('RELEASE_SOURCE_CHANGED');
  const scriptsInfo = await lstat(path.join(root, 'scripts'));
  const serveInfo = await lstat(path.join(root, 'scripts', 'serve.mjs'));
  if (!scriptsInfo.isDirectory() || scriptsInfo.isSymbolicLink() || !serveInfo.isFile() || serveInfo.isSymbolicLink()) reject('RELEASE_LINK_OR_DIRECTORY_INVALID');
  const serve = await readFile(path.join(root, 'scripts', 'serve.mjs'));
  if (serve.length !== baseline.securitySource.bytes || hash(serve) !== baseline.securitySource.sha256) reject('RELEASE_SOURCE_CHANGED');
  return { source, records };
}
export async function prepareRelease(root = ROOT) {
  requireNode();
  const origin = new URL(RELEASE_ORIGIN);
  if (origin.origin !== RELEASE_ORIGIN || origin.protocol !== 'https:' || origin.hostname !== 'image-pdf.glossquote.com' || origin.port || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) reject('RELEASE_ORIGIN_INVALID');
  const { source, records } = await sourceBytes(root);
  const site = new Map();
  for (const [file, bytes] of source) site.set(file, file.endsWith('.html') ? Buffer.from(renderReleaseHtml(bytes.toString('utf8'), file)) : bytes);
  site.set('robots.txt', Buffer.from(`User-agent: *\nAllow: /\nSitemap: ${RELEASE_ORIGIN}/sitemap.xml\n`));
  site.set('sitemap.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${RELEASE_ORIGIN}/index.html</loc></url>\n  <url><loc>${RELEASE_ORIGIN}/en/index.html</loc></url>\n</urlset>\n`));
  site.set('_headers', Buffer.from(`/*\n  Content-Security-Policy: ${CSP}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Robots-Tag: index, follow\n  Cache-Control: no-store\n`));
  const files = SITE_FILES.map(file => ({ path: file, bytes: site.get(file).length, sha256: hash(site.get(file)) }));
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, mode: 'release-candidate', origin: RELEASE_ORIGIN, toolSlug: TOOL_SLUG, files, sourceFiles: records }, null, 2) + '\n');
  return { site, manifest, files, sourceFiles: records };
}
async function verifyExisting(root, expected, { optional = false } = {}) {
  const directory = path.join(root, 'release-artifacts');
  const files = await inventory(directory, OUTPUT_FILES, { optional });
  if (files === null) return false;
  if (JSON.stringify(files) !== JSON.stringify(OUTPUT_FILES)) reject('RELEASE_INPUT_OR_OUTPUT_MISSING');
  const manifest = await readFile(path.join(directory, 'manifest.json'));
  validateManifest(manifest);
  // Rebuild expectations from pinned sources and semantic rules, never from this manifest.
  for (const file of SITE_FILES) {
    const bytes = await readFile(local(path.join(directory, 'site'), file));
    if (file.endsWith('.html')) validateReleaseHtml(bytes.toString('utf8'), file);
    if (!bytes.equals(expected.site.get(file))) reject('RELEASE_OUTPUT_CHANGED');
  }
  if (!manifest.equals(expected.manifest)) reject('RELEASE_MANIFEST_CHANGED');
  return true;
}
export async function checkRelease(root = ROOT) {
  const expected = await prepareRelease(root);
  await verifyExisting(root, expected);
  return { mode: 'release-candidate', origin: RELEASE_ORIGIN, toolSlug: TOOL_SLUG, files: expected.files.length, sourceFiles: expected.sourceFiles.length, manifestSha256: hash(expected.manifest) };
}
export async function buildRelease(root = ROOT) {
  const expected = await prepareRelease(root);
  if (await verifyExisting(root, expected, { optional: true })) return { ...await checkRelease(root), reused: true };
  const directory = path.join(root, 'release-artifacts');
  // All inputs and any existing outputs were checked before the first mutation.
  // Exclusive creation preserves unknown/concurrently added files; no deletion/repair/overwrite path.
  await mkdir(directory);
  const dirs = new Set(['site']);
  for (const file of SITE_FILES) {
    let parent = path.posix.dirname(`site/${file}`);
    while (parent !== '.') { dirs.add(parent); parent = path.posix.dirname(parent); }
  }
  for (const dir of [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1))) await mkdir(local(directory, dir));
  for (const file of SITE_FILES) await writeFile(local(path.join(directory, 'site'), file), expected.site.get(file), { flag: 'wx' });
  // The sibling manifest is the last file written; a failed I/O leaves an incomplete candidate,
  // which subsequent build/check refuse to overwrite. It never destroys pre-existing data.
  await writeFile(path.join(directory, 'manifest.json'), expected.manifest, { flag: 'wx' });
  return { ...await checkRelease(root), reused: false };
}
export function parseReleaseArgs(args) {
  if (args.length !== 1 || !['build', 'check'].includes(args[0])) reject('RELEASE_ARGUMENTS_INVALID');
  return args[0];
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = parseReleaseArgs(process.argv.slice(2));
    const report = mode === 'build' ? await buildRelease() : await checkRelease();
    console.log(`PASS ${mode}: ${report.files} release-candidate assets, ${report.sourceFiles} frozen M1 inputs, manifest ${report.manifestSha256}. Offline only; not deployed.`);
  } catch (error) {
    console.error(/^RELEASE_[A-Z_]+$/.test(error.message) ? error.message : 'RELEASE_FAILED');
    process.exitCode = 1;
  }
}
