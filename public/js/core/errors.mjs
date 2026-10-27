export class ImagePdfError extends Error {
  constructor(code, index = null) {
    super(code);
    this.name = 'ImagePdfError';
    this.code = code;
    this.index = index;
  }
}
export function fail(code, index = null) { throw new ImagePdfError(code, index); }
export function fence({ signal, generation, isCurrent = () => true } = {}) {
  if (signal?.aborted || !isCurrent(generation)) fail('CANCELLED');
}
