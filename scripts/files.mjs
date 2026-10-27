import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const PUBLIC_FILES = Object.freeze([
  'index.html', 'en/index.html', 'styles/app.css', 'js/app.js',
  'js/core/errors.mjs', 'js/core/image-preflight.mjs', 'js/core/page-layout.mjs', 'js/core/selection.mjs',
  'js/core/pdf-writer.mjs',
  'js/core/create-pdf.mjs', 'js/core/output-state.mjs', 'js/browser-raster.mjs',
  'js/i18n.mjs',
]);
export function requireNode() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24+ required');
}
export async function inventory(directory, { optional = false } = {}) {
  let root;
  try { root = await lstat(directory); } catch (error) {
    if (optional && error.code === 'ENOENT') return [];
    throw error;
  }
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Unsafe directory');
  const canonical = await realpath(directory);
  const files = [];
  async function walk(current, relative) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = await lstat(next);
      const resolved = await realpath(next);
      if (stat.isSymbolicLink() || !resolved.startsWith(canonical + path.sep)) throw new Error('Link/path escape refused');
      if (stat.isDirectory()) {
        if (!PUBLIC_FILES.some(file => file.startsWith(rel + '/'))) throw new Error(`Unknown directory: ${rel}`);
        await walk(next, rel);
      } else if (stat.isFile() && PUBLIC_FILES.includes(rel)) files.push(rel);
      else throw new Error(`Unknown file: ${rel}`);
    }
  }
  await walk(directory, '');
  return files.sort();
}
