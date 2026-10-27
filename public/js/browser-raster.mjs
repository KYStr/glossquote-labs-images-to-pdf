// Native browser boundary. No work happens when this module is imported.
export function createBrowserRaster() {
  let canvas = null;
  return {
    decode(file) {
      if (typeof globalThis.createImageBitmap !== 'function') throw new Error('unavailable');
      return globalThis.createImageBitmap(file, { imageOrientation: 'from-image' });
    },
    getCanvas() {
      if (!canvas) canvas = document.createElement('canvas');
      return canvas;
    },
  };
}
export function browserCapabilities() {
  return typeof globalThis.createImageBitmap === 'function' && typeof globalThis.HTMLCanvasElement !== 'undefined' &&
    typeof globalThis.HTMLCanvasElement.prototype.toBlob === 'function' && typeof globalThis.Blob === 'function';
}
