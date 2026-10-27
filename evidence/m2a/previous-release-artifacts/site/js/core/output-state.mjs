import { MAX_PDF_BYTES } from './pdf-writer.mjs';

// In-memory ownership and fencing; URL creation is deferred until an explicit UI action.
export function createOutputState({ urlApi = globalThis.URL, makeBlob = (parts, options) => new Blob(parts, options), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let generation = 0, result = null, downloadLink = null;
  const urls = new Map();
  function revoke(url) {
    const entry = urls.get(url);
    if (!entry) return;
    if (downloadLink === url) downloadLink = null;
    urls.delete(url); clearTimer(entry.timer); urlApi.revokeObjectURL(url); entry.onExpire?.();
  }
  function clearUrls() { for (const url of [...urls.keys()]) revoke(url); }
  function makeUrl(bytes, mime, token, onExpire) {
    if (token !== generation) return null;
    const blob = makeBlob([bytes], { type: mime });
    if (token !== generation) return null;
    const url = urlApi.createObjectURL(blob);
    if (token !== generation) { urlApi.revokeObjectURL(url); return null; }
    urls.set(url, { timer: setTimer(() => revoke(url), 60_000), onExpire });
    return url;
  }
  return {
    get generation() { return generation; },
    isCurrent: token => token === generation,
    get hasResult() { return result !== null && result.generation === generation; },
    get pageCount() { return result?.pageCount ?? 0; },
    get byteLength() { return result?.bytes.byteLength ?? 0; },
    invalidate() { generation++; result = null; clearUrls(); return generation; },
    publish(bytes, pageCount, token) {
      if (token !== generation || !(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_PDF_BYTES || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > 20) return false;
      if (result) clearUrls();
      result = { bytes, pageCount, generation: token }; return true;
    },
    downloadUrl() {
      if (result?.generation !== generation) return null;
      if (!downloadLink) downloadLink = makeUrl(result.bytes, 'application/pdf', generation);
      return downloadLink;
    },
    previewUrl: (bytes, token, onExpire) => makeUrl(bytes, 'image/jpeg', token, onExpire),
    revoke,
    dispose() { generation++; result = null; clearUrls(); },
  };
}
