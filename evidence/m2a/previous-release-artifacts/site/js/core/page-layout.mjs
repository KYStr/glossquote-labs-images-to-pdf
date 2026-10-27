import { fail } from './errors.mjs';
export const MARGIN_PT = 28.35;
export const PAPERS = Object.freeze({ A4: Object.freeze([595.28, 841.89]), Letter: Object.freeze([612, 792]) });
export function computePageLayout(imageWidth, imageHeight, { paper = 'A4', orientation = 'portrait', marginPt = MARGIN_PT } = {}) {
  if (!Object.hasOwn(PAPERS, paper) || !['portrait', 'landscape'].includes(orientation) || marginPt !== MARGIN_PT ||
      !Number.isSafeInteger(imageWidth) || !Number.isSafeInteger(imageHeight) || imageWidth < 1 || imageHeight < 1 ||
      Math.max(imageWidth, imageHeight) > 8192 || imageWidth * imageHeight > 16_000_000) fail('PDF_STRUCTURE_ERROR');
  const [pageWidthPt, pageHeightPt] = orientation === 'portrait' ? PAPERS[paper] : [...PAPERS[paper]].reverse();
  const scale = Math.min((pageWidthPt - 2 * marginPt) / imageWidth, (pageHeightPt - 2 * marginPt) / imageHeight);
  const widthPt = imageWidth * scale, heightPt = imageHeight * scale;
  return { pageWidthPt, pageHeightPt, xPt: (pageWidthPt - widthPt) / 2, yPt: (pageHeightPt - heightPt) / 2, widthPt, heightPt };
}
export function pdfNumber(number) {
  if (!Number.isFinite(number) || number < 0 || number > 10000) fail('PDF_STRUCTURE_ERROR');
  return number.toFixed(2);
}
