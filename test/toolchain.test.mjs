import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, rename } from 'node:fs/promises';
import { ROOT, PUBLIC_FILES, inventory } from '../scripts/files.mjs';
import { build } from '../scripts/build.mjs';
import { createHandler, CSP } from '../scripts/serve.mjs';

async function fixture(run) {
  const taskTestRoot = path.resolve(ROOT, 'test');
  const root = await mkdtemp(path.join(taskTestRoot, '.build-'));
  try {
    for (const file of PUBLIC_FILES) {
      const target = path.join(root, 'public', file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(path.join(ROOT, 'public', file)));
    }
    await run(root);
  } finally {
    // Check both the absolute parent and task-owned generated basename before recursive cleanup.
    assert.equal(path.dirname(path.resolve(root)), taskTestRoot);
    assert.match(path.basename(root), /^\.build-[A-Za-z0-9]+$/);
    await rm(root, { recursive: true });
  }
}
test('build allowlist: exact portable assets, bytes match; unknown output is retained and rejected', async () => {
  await fixture(async root => {
    assert.equal(await build(root), 13);
    assert.deepEqual(await inventory(path.join(root, 'dist')), [...PUBLIC_FILES].sort());
    for (const file of PUBLIC_FILES) assert.deepEqual(await readFile(path.join(root, 'dist', file)), await readFile(path.join(ROOT, 'public', file)));
    await writeFile(path.join(root, 'dist', 'unreviewed.txt'), 'keep this');
    await assert.rejects(build(root), /Unknown file/);
    assert.equal(await readFile(path.join(root, 'dist', 'unreviewed.txt'), 'utf8'), 'keep this');
  });
});
test('build rejects unknown source, missing source, and indexing/canonical mutation', async () => {
  await fixture(async root => {
    const index = path.join(root, 'public', 'index.html');
    const html = await readFile(index, 'utf8');
    await writeFile(index, html.replace('noindex,nofollow', 'index,follow'));
    await assert.rejects(build(root), /indexing/);
    await writeFile(index, html.replace('</head>', '<link rel="canonical" href="https://example.invalid"></head>'));
    await assert.rejects(build(root), /indexing/);
    await writeFile(index, html);
    await writeFile(path.join(root, 'public', 'unknown.txt'), 'x');
    await assert.rejects(build(root), /Unknown file/);
  });
  await fixture(async root => {
    await rename(path.join(root, 'public', 'index.html'), path.join(root, 'held-index.html'));
    await assert.rejects(build(root), /Incomplete/);
  });
});
test('source/destination directory junctions are rejected without following them', async () => {
  await fixture(async root => {
    await rename(path.join(root, 'public', 'js'), path.join(root, 'held-js'));
    await symlink(path.join(root, 'held-js'), path.join(root, 'public', 'js'), 'junction');
    await assert.rejects(build(root), /Link|Unsafe/);
  });
  await fixture(async root => {
    await mkdir(path.join(root, 'held-dist'));
    await symlink(path.join(root, 'held-dist'), path.join(root, 'dist'), 'junction');
    await assert.rejects(build(root), /Link|Unsafe/);
  });
});
test('offline handler unit: GET/HEAD/MIME/Host/method/path allowlist; no listener started', async () => {
  const reads = [];
  const handler = createHandler(async file => { reads.push(file); return Buffer.from('synthetic'); });
  async function request(method, url, host = '127.0.0.1:4226') {
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = body; } };
    await handler({ method, url, headers: { host } }, response);
    return response;
  }
  const ok = await request('GET', '/');
  assert.equal(ok.status, 200); assert.equal(ok.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(ok.headers['Content-Security-Policy'], CSP);
  assert.equal(ok.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.equal((await request('HEAD', '/en/')).body, undefined);
  assert.equal((await request('GET', '/js/core/pdf-writer.mjs')).headers['Content-Type'], 'text/javascript; charset=utf-8');
  for (const url of ['/../package.json', '/%2e%2e/package.json', '/js\\app.js', '/index.html?input=private', '//index.html', '/missing', '/HANDOFF.md']) assert.equal((await request('GET', url)).status, 404);
  assert.equal((await request('POST', '/')).status, 405);
  assert.equal((await request('GET', '/', 'evil.invalid')).status, 403);
  assert.deepEqual(reads, ['index.html', 'en/index.html', 'js/core/pdf-writer.mjs']);
});
