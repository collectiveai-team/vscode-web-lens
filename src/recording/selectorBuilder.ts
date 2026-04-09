/**
 * selectorBuilder — pure function: Element-like → stable CSS selector.
 *
 * Priority: data-testid > id > aria-label > name > css-path
 *
 * This logic is intentionally duplicated in inject.ts (browser bundle context)
 * as buildRecordSelector(). This file exists solely to make the logic unit-testable
 * in Node.js without a real DOM.
 */

export interface ElementLike {
  getAttribute(name: string): string | null;
  readonly id: string;
  readonly tagName: string;
  readonly classList: { readonly length: number; readonly [index: number]: string | undefined };
  readonly parentElement: ElementLike | null;
}

export interface SelectorResult {
  selector: string;
  selectorType: 'data-testid' | 'id' | 'aria-label' | 'name' | 'css-path';
}

function escapeSelectorFragment(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeIdSelector(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

export function buildSelector(el: ElementLike): SelectorResult {
  const testid = el.getAttribute('data-testid');
  if (testid) return { selector: `[data-testid="${escapeSelectorFragment(testid)}"]`, selectorType: 'data-testid' };

  if (el.id) return { selector: `#${escapeIdSelector(el.id)}`, selectorType: 'id' };

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return { selector: `[aria-label="${escapeSelectorFragment(ariaLabel)}"]`, selectorType: 'aria-label' };

  const name = el.getAttribute('name');
  if (name) return { selector: `[name="${escapeSelectorFragment(name)}"]`, selectorType: 'name' };

  return { selector: buildCssPath(el), selectorType: 'css-path' };
}

function buildCssPath(el: ElementLike, maxDepth = 4): string {
  const parts: string[] = [];
  let current: ElementLike | null = el;
  let depth = 0;

  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML' && depth < maxDepth) {
    let part = current.tagName.toLowerCase();
    const firstClass = current.classList[0];
    if (firstClass) part += `.${firstClass}`;
    parts.unshift(part);
    current = current.parentElement;
    depth++;
  }

  return parts.join(' > ') || el.tagName.toLowerCase();
}
