import { COPY } from './i18n.mjs';
import { createBrowserRaster, browserCapabilities } from './browser-raster.mjs';
import { preflightFiles, validateFileSizes } from './core/image-preflight.mjs';
import { computePageLayout, pdfNumber } from './core/page-layout.mjs';
import { moveItem, rotateItem } from './core/selection.mjs';
import { encodeImagePages, rasterizePage } from './core/create-pdf.mjs';
import { createOutputState } from './core/output-state.mjs';
import { ImagePdfError } from './core/errors.mjs';
import { PDF_FILENAME } from './core/pdf-writer.mjs';

export function mountApp(doc, { adapter = createBrowserRaster(), capabilities = browserCapabilities(), output = createOutputState() } = {}) {
  const c = COPY[doc.documentElement.lang] ?? COPY['zh-Hant'];
  const ids = ['workspace', 'files', 'clear', 'image-list', 'list-empty', 'count', 'selected-page', 'paper', 'image-fit', 'image-summary', 'photo-preview', 'paper-empty', 'paper-summary', 'preview-photo', 'preview-message', 'generate', 'cancel', 'download', 'status', 'error', 'progress', 'result-summary'];
  const ui = Object.fromEntries(ids.map(id => [id, doc.getElementById(id)]));
  let items = [], selectedId = null, sequence = 0, allValid = false, busy = false, cancelling = false;
  let activeController = null, queue = Promise.resolve(), previewUrl = null;
  let settings = { paper: 'A4', orientation: 'portrait' };
  const number = new Intl.NumberFormat(c.locale, { maximumFractionDigits: 2 });
  const size = bytes => `${number.format(bytes / 1_048_576)} MiB`;
  const displayName = file => String(file.name ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '\ufffd');
  const element = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function status(text) { ui.status.textContent = text; }
  function releasePreview() {
    if (previewUrl) output.revoke(previewUrl);
    previewUrl = null;
    ui['photo-preview'].removeAttribute('src');
    ui['photo-preview'].hidden = true;
    ui['image-summary'].hidden = false;
  }
  function invalidate() {
    activeController?.abort();
    output.invalidate(); // Disables old results synchronously, before the first await or source mutation.
    releasePreview(); busy = false; cancelling = false;
    ui['preview-message'].textContent = allValid && items.length ? c.previewSummary : c.previewEmpty;
    ui.error.hidden = true; ui.error.textContent = '';
    ui['result-summary'].hidden = true; ui['result-summary'].textContent = '';
    ui.progress.hidden = true; ui.progress.value = 0;
    controls();
  }
  function controls() {
    ui.generate.disabled = !capabilities || items.length === 0 || busy;
    ui.generate.textContent = busy ? c.generating : allValid ? c.generate(number.format(items.length)) : c.checkAgain;
    ui.download.hidden = !output.hasResult;
    ui.download.disabled = busy || !output.hasResult;
    ui.download.textContent = c.download;
    ui.download.className = output.hasResult ? 'primary' : '';
    ui.generate.className = output.hasResult ? '' : 'primary';
    ui.cancel.hidden = !busy;
    ui.cancel.disabled = cancelling;
    ui.clear.disabled = items.length === 0 && !busy && !output.hasResult;
    ui.files.disabled = !capabilities;
    ui['preview-photo'].disabled = !capabilities || !allValid || !items.length || busy;
    ui['image-list'].setAttribute('aria-busy', String(busy));
    for (const row of ui['image-list'].children) {
      for (const button of row.children[2].children) {
        if (button.dataset.action === 'select') button.disabled = !allValid || busy;
      }
    }
  }
  function renderPaper() {
    const index = items.findIndex(item => item.id === selectedId);
    const item = items[index];
    const valid = allValid && item?.metadata;
    const odd = item?.rotationQuarterTurns % 2;
    const w = valid ? (odd ? item.metadata.visualHeight : item.metadata.visualWidth) : 1000;
    const h = valid ? (odd ? item.metadata.visualWidth : item.metadata.visualHeight) : 500;
    const layout = computePageLayout(w, h, settings);
    ui.paper.style.setProperty('--paper-ratio', `${layout.pageWidthPt} / ${layout.pageHeightPt}`);
    ui['paper-summary'].textContent = c.paperSummary(settings.paper, settings.orientation, pdfNumber(layout.pageWidthPt), pdfNumber(layout.pageHeightPt));
    ui['selected-page'].textContent = item ? c.page(number.format(index + 1)) : '';
    ui['image-fit'].hidden = !valid;
    ui['paper-empty'].hidden = Boolean(valid);
    ui['preview-message'].textContent = valid ? c.previewSummary : c.previewEmpty;
    ui.paper.setAttribute('aria-label', ui['paper-summary'].textContent);
    if (!valid) return;
    const fit = ui['image-fit'].style;
    fit.left = `${100 * layout.xPt / layout.pageWidthPt}%`;
    fit.bottom = `${100 * layout.yPt / layout.pageHeightPt}%`;
    fit.width = `${100 * layout.widthPt / layout.pageWidthPt}%`;
    fit.height = `${100 * layout.heightPt / layout.pageHeightPt}%`;
    ui['image-summary'].textContent = c.imageSummary(number.format(w), number.format(h));
    ui.paper.setAttribute('aria-label', `${c.page(number.format(index + 1))}. ${c.paperSummary(settings.paper, settings.orientation, pdfNumber(layout.pageWidthPt), pdfNumber(layout.pageHeightPt))}. ${c.imageSummary(number.format(w), number.format(h))}`);
  }
  function renderList(focus = null) {
    const rows = [];
    for (const [index, item] of items.entries()) {
      const row = element('li', undefined, 'image-row'); row.dataset.id = item.id;
      const heading = element('div', undefined, 'row-heading');
      heading.append(element('span', number.format(index + 1), 'row-number'), element('bdi', displayName(item.file), 'file-name'));
      row.append(heading);
      const m = item.metadata;
      row.append(element('p', m ? c.details(m.format, number.format(m.rawWidth), number.format(m.rawHeight), item.rotationQuarterTurns * 90, c.orientation[m.orientation - 1]) : c.unchecked, 'help'));
      const actions = element('div', undefined, 'row-actions');
      for (const [action, label, disabled] of [
        ['up', c.up, index === 0], ['down', c.down, index === items.length - 1],
        ['rotate', c.rotate(item.rotationQuarterTurns * 90), !m || !allValid],
        ['select', c.select, !m || !allValid || busy], ['remove', c.remove, false],
      ]) {
        const button = element('button', label);
        button.type = 'button'; button.dataset.action = action; button.disabled = disabled;
        button.setAttribute('aria-label', `${label} · ${c.page(number.format(index + 1))} · ${displayName(item.file)}`);
        if (action === 'select' && item.id === selectedId) button.setAttribute('aria-current', 'page');
        button.addEventListener('click', () => { if (!button.disabled) rowAction(item.id, action); });
        actions.append(button);
      }
      row.append(actions); rows.push(row);
    }
    ui['image-list'].replaceChildren(...rows);
    ui['list-empty'].hidden = items.length > 0;
    ui.count.textContent = c.count(number.format(items.length), size(items.reduce((sum, item) => sum + item.file.size, 0)));
    renderPaper(); controls();
    if (focus) {
      const row = rows.find(node => node.dataset.id === focus.id);
      const buttons = row ? [...row.children[2].children] : [];
      const target = buttons.find(button => button.dataset.action === focus.action && !button.disabled) ?? buttons.find(button => !button.disabled);
      target?.focus({ preventScroll: true });
    }
  }
  function showError(error, sources = items) {
    const code = Object.hasOwn(c.errors, error?.code) ? error.code : 'PDF_STRUCTURE_ERROR';
    const prefix = Number.isInteger(error?.index) && sources[error.index] ? c.fileError(number.format(error.index + 1), displayName(sources[error.index].file)) : '';
    invalidate();
    ui.error.textContent = `${prefix}${c.errors[code]} (${code})`;
    ui.error.hidden = false;
    status(c.errorIntro); controls();
  }
  function progress(update, token) {
    if (!output.isCurrent(token)) return;
    const { state, index, total } = update;
    if (state === 'writing-pdf') status(c.writing);
    else status(c[state](number.format(index + 1), number.format(total)));
    ui.progress.hidden = false; ui.progress.max = Math.max(total, 1); ui.progress.value = index;
  }
  function runWork(work, initialText) {
    const token = output.generation;
    busy = true; status(initialText); controls();
    // Preview and export use this same queue/adapter. A stale native operation must settle first.
    queue = queue.catch(() => {}).then(async () => {
      if (!output.isCurrent(token)) return;
      const controller = new AbortController(); activeController = controller;
      const options = { adapter, signal: controller.signal, generation: token, isCurrent: output.isCurrent, onProgress: update => progress(update, token) };
      try { await work(options, token); }
      catch (error) {
        if (output.isCurrent(token)) {
          if (error?.code === 'CANCELLED') status(c.cancelled);
          else showError(error);
        }
      } finally {
        if (activeController === controller) activeController = null;
        if (output.isCurrent(token)) { busy = false; ui.progress.hidden = true; controls(); }
      }
    });
    return queue;
  }
  function checkSelection() {
    if (!items.length) { allValid = false; status(c.empty); renderList(); return queue; }
    const selection = [...items]; allValid = false; renderList();
    return runWork(async (options, token) => {
      const result = await preflightFiles(selection.map(item => item.file), options);
      if (!output.isCurrent(token)) return;
      items = selection.map((item, index) => ({ ...item, metadata: result.items[index].metadata }));
      allValid = true;
      status(c.ready(number.format(items.length), settings.paper)); renderList();
    }, c.preflighting('1', number.format(items.length)));
  }
  function rowAction(id, action) {
    const index = items.findIndex(item => item.id === id);
    if (index < 0) return;
    if (action === 'select') {
      if (busy || !allValid) return;
      releasePreview(); selectedId = id; renderList({ id, action }); return;
    }
    invalidate();
    if (action === 'remove') {
      items = items.filter(item => item.id !== id);
      if (selectedId === id) selectedId = items[Math.min(index, items.length - 1)]?.id ?? null;
      if (!items.length) allValid = false;
      status(items.length ? c.stale : c.empty);
    } else if (action === 'rotate') {
      items = rotateItem(items, index);
      status(`${c.changedRotation(displayName(items[index].file), items[index].rotationQuarterTurns * 90)} ${c.stale}`);
    } else {
      items = moveItem(items, index, action === 'up' ? -1 : 1);
      const next = items.findIndex(item => item.id === id);
      status(`${c.changedOrder(displayName(items[next].file), number.format(next + 1))} ${c.stale}`);
    }
    renderList({ id: action === 'remove' ? selectedId : id, action });
    if (items.length && !allValid) checkSelection();
  }
  function reset() {
    invalidate(); items = []; selectedId = null; allValid = false;
    ui.files.value = ''; status(c.empty); renderList();
  }
  ui.files.addEventListener('change', () => {
    const added = Array.from(ui.files.files ?? []); ui.files.value = '';
    if (!added.length) return;
    invalidate();
    const candidate = [...items, ...added.map(file => ({ file, metadata: null, rotationQuarterTurns: 0, id: `p${++sequence}` }))];
    try { validateFileSizes(candidate.map(item => item.file)); }
    catch (error) { showError(error, candidate); return; }
    items = candidate; selectedId ??= items[0].id;
    checkSelection();
  });
  for (const radio of doc.querySelectorAll('input[name="paper"], input[name="direction"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      invalidate();
      settings = { ...settings, [radio.name === 'paper' ? 'paper' : 'orientation']: radio.value };
      status(items.length ? c.stale : c.empty); renderList();
      if (items.length && !allValid) checkSelection();
    });
  }
  ui.generate.addEventListener('click', () => {
    if (ui.generate.disabled) return;
    invalidate();
    if (!allValid) { checkSelection(); return; }
    const snapshot = items.map(item => ({ ...item, metadata: { ...item.metadata } })), paper = { ...settings };
    runWork(async (options, token) => {
      const result = await encodeImagePages(snapshot, paper, options);
      if (!output.publish(result.bytes, result.pageCount, token)) return;
      const text = c.success(number.format(result.pageCount), size(result.bytes.byteLength));
      status(text); ui['result-summary'].textContent = `${PDF_FILENAME} · ${text}`; ui['result-summary'].hidden = false;
      controls();
    }, c.preflighting('1', number.format(items.length)));
  });
  ui['preview-photo'].addEventListener('click', () => {
    if (ui['preview-photo'].disabled) return;
    releasePreview();
    const selected = items.find(item => item.id === selectedId), snapshot = { ...selected }, paper = { ...settings };
    const pageNumber = items.findIndex(item => item.id === selectedId) + 1;
    ui['preview-message'].textContent = c.previewLoading;
    runWork(async (options, token) => {
      const page = await rasterizePage(snapshot, paper, options);
      if (!output.isCurrent(token)) return;
      const url = output.previewUrl(page.jpegBytes, token, () => {
        if (previewUrl === url) {
          previewUrl = null; ui['photo-preview'].removeAttribute('src'); ui['photo-preview'].hidden = true;
          ui['image-summary'].hidden = false; ui['preview-message'].textContent = c.previewExpired;
        }
      });
      if (!url) return;
      previewUrl = url;
      ui['photo-preview'].onerror = () => { if (output.isCurrent(token) && previewUrl === url) showError(new ImagePdfError('JPEG_ENCODE_FAILED')); };
      ui['photo-preview'].alt = c.photoAlt(number.format(pageNumber));
      ui['photo-preview'].src = url; ui['photo-preview'].hidden = false; ui['image-summary'].hidden = true;
      ui['preview-message'].textContent = c.previewPhoto;
      status(output.hasResult ? c.success(number.format(output.pageCount), size(output.byteLength)) : c.ready(number.format(items.length), settings.paper));
    }, c.previewLoading);
  });
  ui.cancel.addEventListener('click', () => {
    if (!busy || cancelling) return;
    invalidate(); const token = output.generation;
    busy = true; cancelling = true; status(c.cancelling); controls();
    queue.then(() => {
      if (output.isCurrent(token)) { busy = false; cancelling = false; status(c.cancelled); controls(); }
    });
  });
  ui.download.addEventListener('click', () => {
    if (ui.download.disabled || !output.hasResult) return;
    let anchor = null;
    try {
      const url = output.downloadUrl();
      if (!url) return;
      anchor = element('a'); anchor.href = url; anchor.download = PDF_FILENAME; anchor.hidden = true;
      doc.body.append(anchor); anchor.click();
    } catch { showError(new ImagePdfError('PDF_STRUCTURE_ERROR')); }
    finally { anchor?.remove(); }
  });
  ui.clear.addEventListener('click', reset);
  const onPageHide = () => { reset(); output.dispose(); };
  doc.defaultView?.addEventListener('pagehide', onPageHide);
  renderList(); status(c.empty);
  if (!capabilities) showError(new ImagePdfError('CANVAS_UNAVAILABLE'));
  return { whenIdle: () => queue, dispose: () => { onPageHide(); doc.defaultView?.removeEventListener('pagehide', onPageHide); } };
}
if (typeof document !== 'undefined') mountApp(document);
