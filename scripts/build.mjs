import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, PUBLIC_FILES, inventory, requireNode } from './files.mjs';

export async function build(root = ROOT) {
  requireNode();
  const source = path.join(root, 'public');
  const destination = path.join(root, 'dist');
  const files = await inventory(source);
  if (JSON.stringify(files) !== JSON.stringify([...PUBLIC_FILES].sort())) throw new Error('Incomplete public allowlist');
  for (const file of files.filter(file => file.endsWith('.html'))) {
    const html = await readFile(path.join(source, file), 'utf8');
    if (!html.includes('<meta name="robots" content="noindex,nofollow">') || /rel="canonical"|sitemap/i.test(html)) throw new Error('Preview indexing contract');
  }
  await inventory(destination, { optional: true }); // Unknown/stale output is an error, never silently removed.
  await mkdir(destination, { recursive: true });
  for (const file of files) {
    await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
    await copyFile(path.join(source, file), path.join(destination, file));
  }
  await inventory(destination);
  return files.length;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'scripts', 'build.mjs')) {
  console.log(`PASS preview build: ${await build()} allowlisted files -> dist; no server started.`);
}
