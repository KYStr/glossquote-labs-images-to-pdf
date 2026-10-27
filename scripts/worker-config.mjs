import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ROOT } from './files.mjs';

// Exact assets-only contract from tool 42; the worker name and route are tool 46's.
// No executable worker, extra route, binding, environment or telemetry override.
const EXPECTED = {
  name: 'glossquote-images-to-pdf',
  compatibility_date: '2026-10-24',
  workers_dev: false,
  preview_urls: false,
  send_metrics: false,
  routes: [{ pattern: 'image-pdf.glossquote.com', custom_domain: true }],
  observability: {
    enabled: false,
    logs: { enabled: false, invocation_logs: false },
    traces: { enabled: false },
  },
  assets: {
    directory: './release-artifacts/site',
    run_worker_first: false,
    html_handling: 'none',
    not_found_handling: 'none',
  },
  build: { command: 'node scripts/release.mjs build' },
};
function invalid() { throw new Error('RELEASE_CONFIG_INVALID'); }
export function validateWorkerConfig(value) {
  if (!isDeepStrictEqual(value, EXPECTED)) invalid();
  return value;
}
export async function checkWorkerConfig(root = ROOT) {
  try {
    const directory = await lstat(root), file = path.join(root, 'wrangler.jsonc');
    const info = await lstat(file);
    if (!directory.isDirectory() || directory.isSymbolicLink() || !info.isFile() || info.isSymbolicLink() || info.size > 16_384) invalid();
    return validateWorkerConfig(JSON.parse(await readFile(file, 'utf8')));
  } catch { invalid(); }
}
