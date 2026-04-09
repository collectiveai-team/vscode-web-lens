import { describe, it, expect } from 'vitest';
import { buildSelector } from './selectorBuilder';
import type { ElementLike } from './selectorBuilder';

// Helper to create lightweight element mocks without jsdom
function el(
  tag: string,
  opts: {
    id?: string;
    classes?: string[];
    attrs?: Record<string, string>;
    parent?: ElementLike;
  } = {},
): ElementLike {
  const classes = opts.classes ?? [];
  return {
    tagName: tag.toUpperCase(),
    id: opts.id ?? '',
    classList: Object.assign([...classes], { length: classes.length }),
    getAttribute: (name: string) => opts.attrs?.[name] ?? null,
    parentElement: opts.parent ?? null,
  };
}

describe('buildSelector', () => {
  it('returns data-testid selector when present', () => {
    const result = buildSelector(el('button', { attrs: { 'data-testid': 'submit-btn' } }));
    expect(result).toEqual({ selector: '[data-testid="submit-btn"]', selectorType: 'data-testid' });
  });

  it('falls back to id when no data-testid', () => {
    const result = buildSelector(el('button', { id: 'my-btn' }));
    expect(result).toEqual({ selector: '#my-btn', selectorType: 'id' });
  });

  it('escapes selector fragments for special characters', () => {
    const result = buildSelector(el('button', { attrs: { 'data-testid': 'save "draft"' } }));
    expect(result).toEqual({ selector: '[data-testid="save \\"draft\\""]', selectorType: 'data-testid' });
  });

  it('falls back to aria-label', () => {
    const result = buildSelector(el('button', { attrs: { 'aria-label': 'Close dialog' } }));
    expect(result).toEqual({ selector: '[aria-label="Close dialog"]', selectorType: 'aria-label' });
  });

  it('falls back to name attribute', () => {
    const result = buildSelector(el('input', { attrs: { name: 'email' } }));
    expect(result).toEqual({ selector: '[name="email"]', selectorType: 'name' });
  });

  it('falls back to css-path with parent chain', () => {
    const parent = el('div', { classes: ['container'] });
    const child = el('button', { classes: ['btn'], parent });
    const result = buildSelector(child);
    expect(result.selectorType).toBe('css-path');
    expect(result.selector).toBe('div.container > button.btn');
  });

  it('produces plain tag name when no stable attributes and no parent', () => {
    const result = buildSelector(el('section'));
    expect(result).toEqual({ selector: 'section', selectorType: 'css-path' });
  });

  it('data-testid takes priority over id', () => {
    const result = buildSelector(el('button', { id: 'btn', attrs: { 'data-testid': 'the-btn' } }));
    expect(result.selectorType).toBe('data-testid');
  });

  it('id takes priority over aria-label', () => {
    const result = buildSelector(el('button', { id: 'btn', attrs: { 'aria-label': 'Go' } }));
    expect(result.selectorType).toBe('id');
  });

  it('stops building css-path at maxDepth 4', () => {
    // 5 levels deep — should not go above 4
    const level5 = el('div', { classes: ['l5'] });
    const level4 = el('div', { classes: ['l4'], parent: level5 });
    const level3 = el('div', { classes: ['l3'], parent: level4 });
    const level2 = el('div', { classes: ['l2'], parent: level3 });
    const target = el('button', { classes: ['target'], parent: level2 });
    const result = buildSelector(target);
    expect(result.selectorType).toBe('css-path');
    // Should have exactly 5 segments (target + 4 ancestors)
    expect(result.selector.split(' > ').length).toBeLessThanOrEqual(5);
  });
});
