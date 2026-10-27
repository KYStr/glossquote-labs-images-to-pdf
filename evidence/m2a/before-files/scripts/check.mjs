import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, PUBLIC_FILES, inventory, requireNode } from './files.mjs';

requireNode();
const files = await inventory(path.join(ROOT, 'public'));
if (JSON.stringify(files) !== JSON.stringify([...PUBLIC_FILES].sort())) throw new Error('Missing public file');
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
if (pkg.private !== true || pkg.type !== 'module' || pkg.engines.node !== '>=24' ||
    Object.keys(pkg.dependencies ?? {}).length || Object.keys(pkg.devDependencies ?? {}).length) throw new Error('Package contract');
for (const name of files) {
  const source = await readFile(path.join(ROOT, 'public', name), 'utf8');
  if (/\b(?:innerHTML|outerHTML|insertAdjacentHTML|eval|localStorage|sessionStorage|indexedDB|serviceWorker|fetch|XMLHttpRequest|WebSocket)\b|document\.write|console\./.test(source)) throw new Error(`Forbidden API: ${name}`);
  if (/@import|url\(\s*['"]?(?:https?:|\/\/)|<(?:script|link|img|iframe)\b[^>]*(?:src|href)=["'](?:https?:|\/\/)/i.test(source)) throw new Error(`Remote resource: ${name}`);
  if (name.endsWith('.html')) {
    if (!/<meta name="robots" content="noindex,nofollow">/.test(source) || /rel="canonical"|sitemap/i.test(source)) throw new Error('Preview indexing contract');
    if (!/<html lang="(?:zh-Hant|en)">/.test(source) || !/<title>[^<]+<\/title>/.test(source) || !/<h1[^>]*>[^<]+<\/h1>/.test(source)) throw new Error('Missing localized document fields');
    const seenIds = new Set();
    for (const [, id] of source.matchAll(/\bid="([^"]+)"/g)) {
      if (seenIds.has(id)) throw new Error('Duplicate HTML id');
      seenIds.add(id);
    }
    for (const [, attr, target] of source.matchAll(/\b(src|href)="([^"]+)"/g)) {
      if (target.startsWith('#')) { if (!seenIds.has(target.slice(1))) throw new Error('Broken fragment'); continue; }
      if (target.startsWith('https://glossquote.com/') && attr === 'href') continue;
      if (/:|\\|^\/\//.test(target)) throw new Error('Unexpected URL');
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
      if (!PUBLIC_FILES.includes(resolved)) throw new Error(`Broken asset/link: ${name}`);
    }
  } else if (/\.(?:mjs|js)$/.test(name)) {
    for (const [, target] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      if (!target.startsWith('./') && !target.startsWith('../')) throw new Error('Non-local module import');
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
      if (!PUBLIC_FILES.includes(resolved)) throw new Error('Module import escapes public allowlist');
    }
  }
}
async function syntax(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Link refused');
    if (entry.isDirectory()) await syntax(target);
    else if (/\.(?:mjs|js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', target], { shell: false, windowsHide: true, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`Syntax failure: ${target}\n${result.stderr}`);
    }
  }
}
for (const folder of ['public', 'scripts', 'test']) await syntax(path.join(ROOT, folder));
console.log(`PASS check: ${files.length} public files; ESM syntax, local resources, preview noindex. Static checks are not browser/security proof.`);
