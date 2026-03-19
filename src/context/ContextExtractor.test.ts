import { describe, it, expect } from 'vitest';
import { ContextExtractor } from './ContextExtractor';

describe('ContextExtractor', () => {
  const extractor = new ContextExtractor();

  it('builds bundle from addElement:captured message', () => {
    const bundle = extractor.fromCapturedElement(
      {
        html: '<button class="cta">Click</button>',
        tag: 'button',
        classes: ['cta'],
        dimensions: { top: 0, left: 0, width: 120, height: 34 },
        accessibility: { name: 'Click', role: 'button', focusable: true },
        parentHtml: '<div class="hero"><!-- 2 siblings --><button class="cta">Click</button></div>',
        ancestorPath: 'body > div.app > div.hero > button.cta',
        screenshotDataUrl: 'data:image/png;base64,abc123',
      },
      'http://localhost:3000'
    );

    expect(bundle.url).toBe('http://localhost:3000');
    expect(bundle.element?.html).toBe('<button class="cta">Click</button>');
    expect(bundle.element?.ancestorPath).toBe('body > div.app > div.hero > button.cta');
    expect(bundle.screenshot?.dataUrl).toBe('data:image/png;base64,abc123');
    expect(bundle.timestamp).toBeGreaterThan(0);
  });

  it('builds bundle without screenshot when dataUrl is empty', () => {
    const bundle = extractor.fromCapturedElement(
      {
        html: '<p>Test</p>',
        tag: 'p',
        classes: [],
        dimensions: { top: 0, left: 0, width: 100, height: 20 },
        accessibility: {},
        parentHtml: '<div><p>Test</p></div>',
        ancestorPath: 'body > div > p',
        screenshotDataUrl: '',
      },
      'http://localhost:3000'
    );

    expect(bundle.element).toBeDefined();
    expect(bundle.screenshot).toBeUndefined();
  });

  it('builds screenshot-only bundle', () => {
    const bundle = extractor.fromScreenshot('data:image/png;base64,xyz', 800, 600, 'http://localhost:3000');

    expect(bundle.screenshot?.dataUrl).toBe('data:image/png;base64,xyz');
    expect(bundle.screenshot?.width).toBe(800);
    expect(bundle.element).toBeUndefined();
  });

  it('maps attributes, innerText, computedStyles from payload', () => {
    const bundle = extractor.fromCapturedElement(
      {
        html: '<div class="banner" role="alert">Hello</div>',
        tag: 'div',
        classes: ['banner'],
        dimensions: { top: 86, left: 252, width: 789, height: 71 },
        accessibility: { role: 'alert' },
        parentHtml: '<main><div class="banner" role="alert">Hello</div></main>',
        ancestorPath: 'body > main > div.banner',
        screenshotDataUrl: '',
        attributes: { class: 'banner', role: 'alert' },
        innerText: 'Hello',
        computedStyles: { display: 'flex', color: 'rgb(0, 0, 0)' },
      },
      'http://localhost:3000'
    );

    expect(bundle.element?.attributes).toEqual({ class: 'banner', role: 'alert' });
    expect(bundle.element?.innerText).toBe('Hello');
    expect(bundle.element?.computedStyles).toEqual({ display: 'flex', color: 'rgb(0, 0, 0)' });
    expect(bundle.element?.dimensions).toEqual({ top: 86, left: 252, width: 789, height: 71 });
  });

  it('builds logs-only bundle', () => {
    const bundle = extractor.fromLogs(
      [{ level: 'error', message: 'Uncaught TypeError', timestamp: 1000 }],
      'http://localhost:3000'
    );

    expect(bundle.logs).toHaveLength(1);
    expect(bundle.logs![0].level).toBe('error');
    expect(bundle.element).toBeUndefined();
    expect(bundle.screenshot).toBeUndefined();
  });
});
