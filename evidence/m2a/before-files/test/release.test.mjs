import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm, rename, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT, PUBLIC_FILES } from '../scripts/files.mjs';
import { buildRelease, checkRelease, parseReleaseArgs, RELEASE_ORIGIN, TOOL_SLUG } from '../scripts/release.mjs';
import { parseStaticHtml, validateReleaseHtml } from '../scripts/release-html.mjs';

const ORIGIN = 'https://image-pdf.glossquote.com';
const assets = [...PUBLIC_FILES, '_headers', 'robots.txt', 'sitemap.xml'].sort();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
async function fixture(run) {
  const base = path.resolve(ROOT, 'test');
  const root = await mkdtemp(path.join(base, '.release-'));
  try {
    for (const file of PUBLIC_FILES) {
      const target = path.join(root, 'public', file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(path.join(ROOT, 'public', file)));
    }
    await mkdir(path.join(root, 'scripts'));
    for (const name of ['files.mjs', 'serve.mjs', 'release.mjs', 'release-html.mjs', 'release-baseline.json']) await writeFile(path.join(root, 'scripts', name), await readFile(path.join(ROOT, 'scripts', name)));
    await run(root);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), base);
    assert.match(path.basename(root), /^\.release-[A-Za-z0-9]+$/);
    await rm(root, { recursive: true }); // Only the verified unique task-owned fixture.
  }
}
async function snapshot(root) {
  const files = [];
  async function walk(directory, relative = '') {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const rel = relative ? `${relative}/${item.name}` : item.name;
      if (item.isDirectory()) await walk(path.join(directory, item.name), rel);
      else { const bytes = await readFile(path.join(directory, item.name)); files.push({ path: rel, bytes: bytes.length, sha256: sha(bytes) }); }
    }
  }
  await walk(root); return files;
}
function htmlHeadLinks(html) {
  // Separate extraction oracle for exact generated links, not the generator's validator.
  const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
  return [...head.matchAll(/<link\s+([^>]+)>/g)].map(([, attrs]) => Object.fromEntries([...attrs.matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
}
async function rewriteManifest(root, edit) {
  const file = path.join(root, 'release-artifacts', 'manifest.json');
  const manifest = JSON.parse(await readFile(file));
  await edit(manifest);
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
}
test('release bilingual SEO is reciprocal at fixed origin, head-only changes, candidate body preserved', async () => {
  await fixture(async root => {
    assert.equal(RELEASE_ORIGIN, ORIGIN); assert.equal(TOOL_SLUG, 'images-to-pdf');
    const before = await snapshot(path.join(root, 'public'));
    await buildRelease(root);
    const report = await checkRelease(root); assert.equal(report.files, 16); assert.equal(report.sourceFiles, 13);
    for (const file of ['index.html', 'en/index.html']) {
      const source = await readFile(path.join(root, 'public', file), 'utf8');
      const html = await readFile(path.join(root, 'release-artifacts', 'site', file), 'utf8');
      const links = htmlHeadLinks(html);
      assert.deepEqual(links.filter(link => link.rel === 'canonical'), [{ rel: 'canonical', href: `${ORIGIN}/${file}` }]);
      assert.deepEqual(links.filter(link => link.rel === 'alternate'), [
        { rel: 'alternate', hreflang: 'zh-Hant', href: `${ORIGIN}/index.html` },
        { rel: 'alternate', hreflang: 'en', href: `${ORIGIN}/en/index.html` },
        { rel: 'alternate', hreflang: 'x-default', href: `${ORIGIN}/index.html` },
      ]);
      const seoRemoved = html.replace(/  <link rel="(?:canonical|alternate)"[^>]*>\r?\n/g, '').replace('<meta name="robots" content="index,follow">', '<meta name="robots" content="noindex,nofollow">');
      assert.equal(seoRemoved, source);
      assert.equal(html.slice(html.indexOf('</head>')), source.slice(source.indexOf('</head>')));
      assert.ok(source.includes('noindex,nofollow') && !source.includes('rel="canonical"'));
      assert.ok(html.includes(file === 'index.html' ? '本地候選版，尚未公開發布。' : 'Local candidate; not publicly released.'));
    }
    assert.deepEqual(await snapshot(path.join(root, 'public')), before);
  });
});
test('release closed assets and exact security headers/robots/sitemap; runtime bytes identical', async () => {
  await fixture(async root => {
    await buildRelease(root);
    const site = path.join(root, 'release-artifacts', 'site');
    assert.deepEqual((await snapshot(site)).map(file => file.path).sort(), assets);
    for (const file of PUBLIC_FILES.filter(file => !file.endsWith('.html'))) assert.deepEqual(await readFile(path.join(site, file)), await readFile(path.join(root, 'public', file)));
    assert.equal(await readFile(path.join(site, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\nSitemap: https://image-pdf.glossquote.com/sitemap.xml\n');
    assert.equal(await readFile(path.join(site, '_headers'), 'utf8'), `/*\n  Content-Security-Policy: ${expectedCsp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Robots-Tag: index, follow\n  Cache-Control: no-store\n`);
    const sitemap = await readFile(path.join(site, 'sitemap.xml'), 'utf8');
    assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), [`${ORIGIN}/index.html`, `${ORIGIN}/en/index.html`]);
    assert.ok(!sitemap.includes('lastmod'));
  });
});
test('release manifest fixed schema, sorted complete source/site hashes; deterministic rebuild and independent roots', async () => {
  await fixture(async first => {
    const report = await buildRelease(first); assert.equal(report.reused, false);
    const before = await snapshot(path.join(first, 'release-artifacts'));
    assert.equal((await buildRelease(first)).reused, true);
    assert.deepEqual(await snapshot(path.join(first, 'release-artifacts')), before);
    const manifest = JSON.parse(await readFile(path.join(first, 'release-artifacts', 'manifest.json')));
    assert.deepEqual(Object.keys(manifest), ['schemaVersion', 'mode', 'origin', 'toolSlug', 'files', 'sourceFiles']);
    assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.mode, 'release-candidate'); assert.equal(manifest.origin, ORIGIN); assert.equal(manifest.toolSlug, 'images-to-pdf');
    assert.deepEqual(manifest.files.map(file => file.path), assets);
    assert.deepEqual(manifest.sourceFiles.map(file => file.path), [...PUBLIC_FILES].sort());
    for (const [folder, records] of [['release-artifacts/site', manifest.files], ['public', manifest.sourceFiles]]) {
      for (const record of records) {
        const bytes = await readFile(path.join(first, folder, record.path));
        assert.deepEqual(Object.keys(record), ['path', 'bytes', 'sha256']);
        assert.equal(record.bytes, bytes.length); assert.equal(record.sha256, sha(bytes));
      }
    }
    assert.ok(!JSON.stringify(manifest).includes(first));
    await fixture(async second => { await buildRelease(second); assert.deepEqual(await snapshot(path.join(second, 'release-artifacts')), before); });
  });
});
test('release rejects modified asset and leaves every existing output byte unchanged', async () => {
  await fixture(async root => {
    await buildRelease(root);
    const asset = path.join(root, 'release-artifacts', 'site', 'js', 'app.js');
    await writeFile(asset, Buffer.concat([await readFile(asset), Buffer.from('\n// tamper\n')]));
    const damaged = await snapshot(path.join(root, 'release-artifacts'));
    await assert.rejects(checkRelease(root), /RELEASE_OUTPUT_CHANGED/);
    await assert.rejects(buildRelease(root), /RELEASE_OUTPUT_CHANGED/);
    assert.deepEqual(await snapshot(path.join(root, 'release-artifacts')), damaged);
  });
});
test('asset + manifest coordinated tamper cannot redefine expected bytes', async () => {
  await fixture(async root => {
    await buildRelease(root);
    const asset = path.join(root, 'release-artifacts', 'site', 'styles', 'app.css');
    const changed = Buffer.concat([await readFile(asset), Buffer.from('\nbody{color:red}\n')]); await writeFile(asset, changed);
    await rewriteManifest(root, manifest => { const row = manifest.files.find(file => file.path === 'styles/app.css'); row.bytes = changed.length; row.sha256 = sha(changed); });
    const damaged = await snapshot(path.join(root, 'release-artifacts'));
    await assert.rejects(checkRelease(root), /RELEASE_OUTPUT_CHANGED/);
    await assert.rejects(buildRelease(root), /RELEASE_OUTPUT_CHANGED/);
    assert.deepEqual(await snapshot(path.join(root, 'release-artifacts')), damaged);
  });
});
test('release rejects missing/extra/unknown directories/unmanaged output, preserving all fixture files', async () => {
  for (const mutation of ['missing', 'extra', 'directory', 'unmanaged']) await fixture(async root => {
    await buildRelease(root);
    const out = path.join(root, 'release-artifacts');
    if (mutation === 'missing') await rename(path.join(out, 'site', 'robots.txt'), path.join(root, 'held-robots.txt'));
    if (mutation === 'extra') await writeFile(path.join(out, 'site', 'unmanaged.txt'), 'preserve');
    if (mutation === 'directory') await mkdir(path.join(out, 'site', 'unknown'));
    if (mutation === 'unmanaged') await rename(path.join(out, 'manifest.json'), path.join(root, 'held-manifest.json'));
    const damaged = await snapshot(out);
    await assert.rejects(checkRelease(root), /RELEASE_/); await assert.rejects(buildRelease(root), /RELEASE_/);
    assert.deepEqual(await snapshot(out), damaged);
  });
});
test('manifest wrong origin/schema/mode/slug, unsafe/duplicate paths and extra fields are rejected', async () => {
  const edits = [m => { m.origin = 'https://evil.invalid'; }, m => { m.schemaVersion = 2; }, m => { m.mode = 'production'; }, m => { m.toolSlug = 'other'; }, m => { m.files[0].path = '../escape'; }, m => { m.files.push(m.files[0]); }, m => { m.trusted = true; }];
  for (const edit of edits) await fixture(async root => {
    await buildRelease(root); await rewriteManifest(root, edit);
    await assert.rejects(checkRelease(root), /RELEASE_(?:MANIFEST|PATH)_INVALID/);
  });
});
test('source bytes/security constants drift rejected, even if manifest/source and site all match tampering', async () => {
  await fixture(async root => {
    await buildRelease(root);
    const input = path.join(root, 'public', 'js', 'app.js'), output = path.join(root, 'release-artifacts', 'site', 'js', 'app.js');
    const bytes = Buffer.concat([await readFile(input), Buffer.from('\n// changed source\n')]);
    await writeFile(input, bytes); await writeFile(output, bytes);
    await rewriteManifest(root, m => { for (const list of [m.files, m.sourceFiles]) { const row = list.find(row => row.path === 'js/app.js'); row.bytes = bytes.length; row.sha256 = sha(bytes); } });
    await assert.rejects(checkRelease(root), /RELEASE_SOURCE_CHANGED/); await assert.rejects(buildRelease(root), /RELEASE_SOURCE_CHANGED/);
  });
  await fixture(async root => {
    const serve = path.join(root, 'scripts', 'serve.mjs'); await writeFile(serve, (await readFile(serve, 'utf8')).replace("connect-src 'none'", "connect-src *"));
    await assert.rejects(buildRelease(root), /RELEASE_SOURCE_CHANGED/);
    await assert.rejects(readFile(path.join(root, 'release-artifacts', 'manifest.json')), { code: 'ENOENT' });
  });
});
test('source unknown/missing assets rejected before writing output', async () => {
  for (const change of ['extra', 'missing']) await fixture(async root => {
    if (change === 'extra') await writeFile(path.join(root, 'public', 'unknown.txt'), 'preserve');
    else await rename(path.join(root, 'public', 'index.html'), path.join(root, 'held-index.html'));
    await assert.rejects(buildRelease(root), /RELEASE_/);
    await assert.rejects(readFile(path.join(root, 'release-artifacts', 'manifest.json')), { code: 'ENOENT' });
  });
});
test('junctions in input, output and output ancestor are rejected without modifying links/targets', async () => {
  for (const location of ['source', 'site', 'ancestor']) await fixture(async root => {
    if (location === 'source') {
      await rename(path.join(root, 'public', 'js'), path.join(root, 'held-js'));
      await symlink(path.join(root, 'held-js'), path.join(root, 'public', 'js'), 'junction');
    } else {
      await buildRelease(root);
      if (location === 'site') {
        await rename(path.join(root, 'release-artifacts', 'site', 'js'), path.join(root, 'held-js'));
        await symlink(path.join(root, 'held-js'), path.join(root, 'release-artifacts', 'site', 'js'), 'junction');
      } else {
        await rename(path.join(root, 'release-artifacts'), path.join(root, 'held-output'));
        await symlink(path.join(root, 'held-output'), path.join(root, 'release-artifacts'), 'junction');
      }
    }
    await assert.rejects(buildRelease(root), /RELEASE_LINK_OR_DIRECTORY_INVALID/);
    await assert.rejects(checkRelease(root), /RELEASE_LINK_OR_DIRECTORY_INVALID/);
  });
});
test('semantic counterexamples: misplaced/commented/duplicate/wrong language SEO and wrong URLs fail', async () => {
  await fixture(async root => {
    await buildRelease(root);
    for (const file of ['index.html', 'en/index.html']) {
      const html = await readFile(path.join(root, 'release-artifacts', 'site', file), 'utf8');
      assert.equal(validateReleaseHtml(html, file).canonical, `${ORIGIN}/${file}`);
      const canonical = `<link rel="canonical" href="${ORIGIN}/${file}">`;
      const variants = [
        html.replace(canonical, `<!-- ${canonical} -->`),
        html.replace(canonical, '') .replace('</body>', `${canonical}</body>`),
        html.replace('</head>', `${canonical}</head>`),
        html.replace('hreflang="en"', 'hreflang="fr"'),
        html.replace('hreflang="x-default"', 'hreflang="zh-Hant"'),
        html.replace(`href="${ORIGIN}/${file}"`, `href="${ORIGIN}/${file}?private=x"`),
        html.replace(`href="${ORIGIN}/${file}"`, `href="https://image-pdf.glossquote.com:8443/${file}"`),
        html.replace(`href="${ORIGIN}/${file}"`, `href="https://evil.invalid/${file}"`),
        html.replace('<h1>', '<h1 hidden>WRONG </h1><h1>'),
        html.replace('name="robots" content="index,follow"', 'name="robots" content="noindex,nofollow"'),
        html.replace('<title>', '<title>WRONG '),
        html.replace('name="description" content="', 'name="description" content="WRONG '),
      ];
      for (const variant of variants) assert.throws(() => validateReleaseHtml(variant, file), /RELEASE_HTML_INVALID/);
    }
    const parsed = parseStaticHtml('<!doctype html><html><head><!-- <link rel="canonical" href="fake"> --><script>"<link rel=canonical>"</script></head><body><input multiple disabled><h1>Real</h1></body></html>');
    assert.equal(parsed.filter(token => token.name === 'link').length, 0);
    assert.equal(parsed.find(token => token.name === 'input').attrs.multiple, '');
  });
});
test('CLI build/check succeed on task-owned copy; no args/wrong mode/extra args reject without mutation', async () => {
  await fixture(async root => {
    const cli = args => spawnSync(process.execPath, [path.join(root, 'scripts', 'release.mjs'), ...args], { cwd: root, shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000 });
    for (const args of [[], ['deploy'], ['build', 'extra'], ['check', '--origin', 'https://evil.invalid'], ['--help']]) {
      assert.throws(() => parseReleaseArgs(args), /RELEASE_ARGUMENTS_INVALID/);
      const result = cli(args); assert.equal(result.status, 1); assert.match(result.stderr, /RELEASE_ARGUMENTS_INVALID/);
    }
    await assert.rejects(readFile(path.join(root, 'release-artifacts', 'manifest.json')), { code: 'ENOENT' });
    assert.equal(cli(['build']).status, 0); assert.equal(cli(['check']).status, 0);
    const before = await snapshot(path.join(root, 'release-artifacts'));
    assert.equal(cli(['build', '--origin=https://evil.invalid']).status, 1);
    assert.deepEqual(await snapshot(path.join(root, 'release-artifacts')), before);
  });
});
