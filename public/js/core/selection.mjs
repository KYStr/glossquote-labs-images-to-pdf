import { fail } from './errors.mjs';
export function moveItem(items, index, delta) {
  if (!Number.isInteger(index) || ![-1, 1].includes(delta) || index < 0 || index >= items.length) fail('IMAGE_HEADER_INVALID');
  const next = index + delta;
  const result = [...items];
  if (next >= 0 && next < result.length) [result[index], result[next]] = [result[next], result[index]];
  return result;
}
export function rotateItem(items, index) {
  if (!items[index]) fail('IMAGE_HEADER_INVALID');
  return items.map((item, i) => i === index ? { ...item, rotationQuarterTurns: (item.rotationQuarterTurns + 1) % 4 } : item);
}
export function pageSpecs(items) {
  return items.map(({ metadata, rotationQuarterTurns }) => ({ ...metadata, rotationQuarterTurns }));
}
