import { describe, it, expect } from 'vitest';
import { ContextExtractor, getImageDimensions } from './ContextExtractor';

// Build a synthetic PNG header with known dimensions (24 bytes — enough for IHDR)
function syntheticPng(width: number, height: number): string {
  const buf = Buffer.alloc(24);
  // PNG signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47;
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a;
  buf.writeUInt32BE(13, 8);   // IHDR chunk length
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52; // "IHDR"
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// Build a synthetic JPEG with SOF0 marker and known dimensions
function syntheticJpeg(width: number, height: number): string {
  // SOI (2) + APP0 marker+segment (18) + SOF0 marker+segment start (9) = 29 bytes
  const buf = Buffer.alloc(29);
  buf[0] = 0xff; buf[1] = 0xd8;   // SOI
  buf[2] = 0xff; buf[3] = 0xe0;   // APP0 marker
  buf[4] = 0x00; buf[5] = 0x10;   // APP0 length = 16 (includes these 2 bytes; 14 bytes data follow)
  // buf[6..19] = zeros  (14 bytes of APP0 data, all ignored)
  buf[20] = 0xff; buf[21] = 0xc0; // SOF0 marker
  buf[22] = 0x00; buf[23] = 0x11; // SOF0 length = 17
  buf[24] = 0x08;                  // precision
  buf.writeUInt16BE(height, 25);   // height at i+5 (i=20)
  buf.writeUInt16BE(width, 27);    // width  at i+7 (i=20)
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

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

  it('builds screenshot-only bundle with decoded dimensions', () => {
    const dataUrl = syntheticPng(800, 600);
    const bundle = extractor.fromScreenshot(dataUrl, 'http://localhost:3000');

    expect(bundle.screenshot?.dataUrl).toBe(dataUrl);
    expect(bundle.screenshot?.width).toBe(800);
    expect(bundle.screenshot?.height).toBe(600);
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

describe('getImageDimensions', () => {
  it('decodes PNG width and height from IHDR', () => {
    const result = getImageDimensions(syntheticPng(1920, 1080));
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  it('decodes JPEG width and height from SOF0 marker', () => {
    const result = getImageDimensions(syntheticJpeg(640, 480));
    expect(result).toEqual({ width: 640, height: 480 });
  });

  it('returns {0,0} for garbage input', () => {
    const result = getImageDimensions('data:image/png;base64,not-valid-base64!!!');
    expect(result).toEqual({ width: 0, height: 0 });
  });
});
