// A narrow static HTML tokenizer for semantic checks, not a browser/DOM substitute.
// Comments and raw-text script/style bodies cannot contribute fake SEO elements.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
function invalid() { throw new Error('RELEASE_HTML_INVALID'); }
function attributes(text) {
  const out = Object.create(null);
  let at = 0;
  while (at < text.length) {
    while (/\s/.test(text[at] ?? '') && at < text.length) at++;
    if (at === text.length) break;
    const key = /^[^\s"'<>/=]+/.exec(text.slice(at))?.[0];
    if (!key) invalid();
    at += key.length;
    const name = key.toLowerCase();
    if (Object.hasOwn(out, name)) invalid();
    const afterName = at;
    while (at < text.length && /\s/.test(text[at])) at++;
    let value = '';
    if (text[at] === '=') {
      at++;
      while (at < text.length && /\s/.test(text[at])) at++;
      if (text[at] === '"' || text[at] === "'") {
        const quote = text[at++], end = text.indexOf(quote, at);
        if (end < 0) invalid();
        value = text.slice(at, end); at = end + 1;
      } else {
        value = /^[^\s"'=<>`]+/.exec(text.slice(at))?.[0];
        if (!value) invalid();
        at += value.length;
      }
    } else at = afterName; // Boolean attributes leave the separating whitespace for the next iteration.
    if (at < text.length && !/\s/.test(text[at])) invalid();
    out[name] = value;
  }
  return out;
}
export function parseStaticHtml(html) {
  const tokens = [], stack = [];
  let at = 0;
  while (at < html.length) {
    if (stack.at(-1)?.name === 'script' || stack.at(-1)?.name === 'style') {
      const name = stack.at(-1).name;
      const closing = new RegExp(`</${name}\\s*>`, 'ig'); closing.lastIndex = at;
      const match = closing.exec(html);
      if (!match) invalid();
      at = match.index;
    } else {
      const next = html.indexOf('<', at);
      if (next < 0) break;
      at = next;
    }
    if (html.startsWith('<!--', at)) {
      const end = html.indexOf('-->', at + 4);
      if (end < 0) invalid();
      at = end + 3; continue;
    }
    if (/^<!doctype\s+html\s*>/i.test(html.slice(at))) {
      at += /^<!doctype\s+html\s*>/i.exec(html.slice(at))[0].length; continue;
    }
    const start = at;
    let end = at + 1, quote = null;
    for (; end < html.length; end++) {
      const ch = html[end];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
    }
    if (end === html.length || quote) invalid();
    const inside = html.slice(start + 1, end);
    const match = /^(\/)?([a-z][a-z0-9-]*)([\s\S]*)$/i.exec(inside);
    if (!match) invalid();
    const [, closing, rawName, tail] = match, name = rawName.toLowerCase();
    if (closing) {
      if (tail.trim() || stack.at(-1)?.name !== name) invalid();
      const token = stack.pop(); token.closeStart = start; token.end = end + 1;
    } else {
      const selfClosing = /\/\s*$/.test(tail);
      if (selfClosing && !VOID.has(name)) invalid();
      const token = { name, attrs: attributes(selfClosing ? tail.replace(/\/\s*$/, '') : tail), start, openEnd: end + 1, parent: stack.at(-1) ?? null, ancestors: stack.map(item => item.name) };
      tokens.push(token);
      if (!VOID.has(name)) stack.push(token);
      else token.end = end + 1;
    }
    at = end + 1;
  }
  if (stack.length) invalid();
  return tokens;
}
const METADATA = Object.freeze({
  'index.html': {
    lang: 'zh-Hant',
    title: '多張圖片合成 PDF｜排序、轉向、不裁切',
    description: '在本機將 JPEG/PNG 照片依序放入 A4 或 Letter PDF，每張一頁，可旋轉並保留完整圖片，不需上傳。',
    h1: '把照片整理成一份順序正確的 PDF',
  },
  'en/index.html': {
    lang: 'en',
    title: 'Images to PDF | Order, Rotate, and Fit Photos to Pages',
    description: 'Turn local JPEG or PNG images into one ordered A4 or Letter PDF, one uncropped image per page, processed in your browser.',
    h1: 'Put your images into one ordered PDF',
  },
});
export function validateReleaseHtml(html, file) {
  const expected = METADATA[file];
  if (!expected) invalid();
  const tokens = parseStaticHtml(html);
  function one(list) { if (list.length !== 1) invalid(); return list[0]; }
  const root = one(tokens.filter(token => token.name === 'html'));
  const head = one(tokens.filter(token => token.name === 'head'));
  const body = one(tokens.filter(token => token.name === 'body'));
  if (root.parent || root.attrs.lang !== expected.lang || head.parent !== root || body.parent !== root || head.end > body.start) invalid();
  const title = one(tokens.filter(token => token.name === 'title'));
  const h1 = one(tokens.filter(token => token.name === 'h1'));
  const meta = name => tokens.filter(token => token.name === 'meta' && token.attrs.name?.toLowerCase() === name);
  const description = one(meta('description')), robots = one(meta('robots'));
  if (title.parent !== head || description.parent !== head || robots.parent !== head || !h1.ancestors.includes('body')) invalid();
  if (html.slice(title.openEnd, title.closeStart) !== expected.title || html.slice(h1.openEnd, h1.closeStart) !== expected.h1 || description.attrs.content !== expected.description || robots.attrs.content !== 'index,follow') invalid();
  const links = tokens.filter(token => token.name === 'link');
  const canonical = one(links.filter(token => token.attrs.rel?.toLowerCase().split(/\s+/).includes('canonical')));
  if (canonical.parent !== head || canonical.attrs.rel !== 'canonical' || canonical.attrs.href !== `https://image-pdf.glossquote.com/${file}` || Object.keys(canonical.attrs).sort().join() !== 'href,rel') invalid();
  const alternate = links.filter(token => token.attrs.rel?.toLowerCase().split(/\s+/).includes('alternate'));
  if (alternate.length !== 3) invalid();
  const target = { 'zh-Hant': 'https://image-pdf.glossquote.com/index.html', en: 'https://image-pdf.glossquote.com/en/index.html', 'x-default': 'https://image-pdf.glossquote.com/index.html' };
  for (const [language, url] of Object.entries(target)) {
    const link = one(alternate.filter(token => token.attrs.hreflang === language));
    if (link.parent !== head || link.attrs.rel !== 'alternate' || link.attrs.href !== url || Object.keys(link.attrs).sort().join() !== 'href,hreflang,rel') invalid();
  }
  return { lang: root.attrs.lang, title: expected.title, description: expected.description, h1: expected.h1, canonical: canonical.attrs.href, alternates: target };
}
export function renderReleaseHtml(source, file) {
  const tokens = parseStaticHtml(source), head = tokens.filter(token => token.name === 'head');
  if (head.length !== 1 || tokens.filter(token => token.name === 'meta' && token.attrs.name === 'robots').length !== 1) invalid();
  const old = '<meta name="robots" content="noindex,nofollow">';
  const content = source.slice(head[0].openEnd, head[0].closeStart);
  if (content.split(old).length !== 2 || tokens.some(token => token.name === 'link' && ['canonical', 'alternate'].includes(token.attrs.rel))) invalid();
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const links = [
    `  <link rel="canonical" href="https://image-pdf.glossquote.com/${file}">`,
    '  <link rel="alternate" hreflang="zh-Hant" href="https://image-pdf.glossquote.com/index.html">',
    '  <link rel="alternate" hreflang="en" href="https://image-pdf.glossquote.com/en/index.html">',
    '  <link rel="alternate" hreflang="x-default" href="https://image-pdf.glossquote.com/index.html">',
  ].join(newline) + newline;
  const output = source.slice(0, head[0].openEnd) + content.replace(old, '<meta name="robots" content="index,follow">') + links + source.slice(head[0].closeStart);
  validateReleaseHtml(output, file);
  return output;
}
