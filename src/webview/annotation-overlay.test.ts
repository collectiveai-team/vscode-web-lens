// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnnotationOverlay } from './annotation-overlay';

describe('createAnnotationOverlay', () => {
  let host: HTMLDivElement;
  let iframe: HTMLIFrameElement;
  const OriginalImage = globalThis.Image;
  const loadedImageSources: string[] = [];

  beforeEach(() => {
    document.body.innerHTML = '';
    loadedImageSources.length = 0;
    host = document.createElement('div');
    iframe = document.createElement('iframe');
    iframe.id = 'browser-iframe';
    host.appendChild(iframe);
    document.body.appendChild(host);

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,composited');

    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        loadedImageSources.push(value);
        queueMicrotask(() => this.onload?.());
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.Image = OriginalImage;
  });

  it('inserts an SVG overlay into the iframe parent and toggles active pointer events', () => {
    const overlay = createAnnotationOverlay();

    const svg = host.querySelector('svg');

    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg?.parentElement).toBe(host);
    expect(overlay.hasShapes()).toBe(false);
    expect(overlay.clear()).toBe(false);

    overlay.setActive(true);
    expect(svg?.style.pointerEvents).toBe('auto');
    expect(iframe.style.pointerEvents).toBe('none');

    overlay.setActive(false);
    expect(svg?.style.pointerEvents).toBe('none');
    expect(iframe.style.pointerEvents).toBe('auto');

    overlay.destroy();
    expect(host.querySelector('svg')).toBeNull();
  });

  it('creates one path for a pen drag', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('pen');

    dispatchPointer(svg, 'mousedown', 10, 12);
    dispatchPointer(svg, 'mousemove', 30, 32);
    dispatchPointer(svg, 'mousemove', 50, 52);
    dispatchPointer(svg, 'mouseup', 50, 52);

    const paths = svg.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('d')).toContain('M 10 12');
    expect(paths[0]?.getAttribute('d')).toContain('L 50 52');
    expect(overlay.hasShapes()).toBe(true);
  });

  it('completes the draft when the mouse is released outside the svg', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');

    dispatchPointer(svg, 'mousedown', 10, 12);
    dispatchPointer(svg, 'mousemove', 30, 32);
    dispatchPointer(window, 'mouseup', 40, 42);

    expect(svg.querySelectorAll('rect')).toHaveLength(1);

    dispatchPointer(svg, 'mousemove', 90, 95);
    const rect = svg.querySelector('rect');
    expect(rect?.getAttribute('width')).toBe('30');
    expect(rect?.getAttribute('height')).toBe('30');
  });

  it('ignores non-primary mouse buttons for drawing and text placement', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('pen');

    dispatchPointer(svg, 'mousedown', 10, 12, { button: 2, buttons: 2 });
    dispatchPointer(svg, 'mousemove', 30, 32, { button: 2, buttons: 2 });
    dispatchPointer(svg, 'mouseup', 30, 32, { button: 2, buttons: 0 });

    expect(svg.querySelector('path')).toBeNull();

    overlay.setTool('text');
    dispatchPointer(svg, 'mousedown', 20, 24, { button: 1, buttons: 4 });
    dispatchPointer(svg, 'mouseup', 20, 24, { button: 1, buttons: 0 });

    expect(host.querySelector('input')).toBeNull();
  });

  it('creates an arrow line with a marker end', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('arrow');

    dispatchPointer(svg, 'mousedown', 5, 6);
    dispatchPointer(svg, 'mousemove', 40, 45);
    dispatchPointer(svg, 'mouseup', 40, 45);

    const line = svg.querySelector('line');
    expect(line?.tagName.toLowerCase()).toBe('line');
    expect(line?.getAttribute('marker-end')).toMatch(/^url\(#/);
  });

  it('uses the current color for arrow strokes and arrowheads across multiple colors', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('arrow');

    overlay.setColor('#ff0000');
    dispatchPointer(svg, 'mousedown', 5, 6);
    dispatchPointer(svg, 'mousemove', 40, 45);
    dispatchPointer(svg, 'mouseup', 40, 45);

    overlay.setColor('#00aaee');
    dispatchPointer(svg, 'mousedown', 10, 12);
    dispatchPointer(svg, 'mousemove', 60, 70);
    dispatchPointer(svg, 'mouseup', 60, 70);

    const lines = Array.from(svg.querySelectorAll('line'));
    const markers = Array.from(svg.querySelectorAll('marker'));

    expect(lines.map((line) => line.getAttribute('stroke'))).toEqual(['#ff0000', '#00aaee']);
    expect(lines.map((line) => line.getAttribute('marker-end'))).toEqual([
      'url(#annotation-overlay-arrow-ff0000)',
      'url(#annotation-overlay-arrow-00aaee)',
    ]);
    expect(markers.map((marker) => marker.id)).toEqual([
      'annotation-overlay-arrow-ff0000',
      'annotation-overlay-arrow-00aaee',
    ]);
    expect(markers.map((marker) => marker.querySelector('path')?.getAttribute('fill'))).toEqual([
      '#ff0000',
      '#00aaee',
    ]);
  });

  it('creates a rect shape', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');

    dispatchPointer(svg, 'mousedown', 15, 20);
    dispatchPointer(svg, 'mousemove', 70, 90);
    dispatchPointer(svg, 'mouseup', 70, 90);

    const rect = svg.querySelector('rect');
    expect(rect?.tagName.toLowerCase()).toBe('rect');
    expect(rect?.getAttribute('x')).toBe('15');
    expect(rect?.getAttribute('y')).toBe('20');
  });

  it('creates an ellipse shape', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('ellipse');

    dispatchPointer(svg, 'mousedown', 20, 30);
    dispatchPointer(svg, 'mousemove', 80, 70);
    dispatchPointer(svg, 'mouseup', 80, 70);

    const ellipse = svg.querySelector('ellipse');
    expect(ellipse?.tagName.toLowerCase()).toBe('ellipse');
    expect(ellipse?.getAttribute('cx')).toBe('50');
    expect(ellipse?.getAttribute('cy')).toBe('50');
    expect(ellipse?.getAttribute('rx')).toBe('30');
    expect(ellipse?.getAttribute('ry')).toBe('20');
  });

  it('increments callout numbers and resets them after clear', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('callout');

    createCallout(svg, 'First', 25, 30);
    createCallout(svg, 'Second', 80, 85);

    expect(getSvgTexts(svg)).toContain('1');
    expect(getSvgTexts(svg)).toContain('2');
    expect(overlay.clear()).toBe(true);
    expect(svg.querySelector('defs')?.children.length ?? 0).toBe(0);

    createCallout(svg, 'Reset', 40, 45);
    expect(getSvgTexts(svg)).toContain('1');
    expect(getSvgTexts(svg)).not.toContain('2');
  });

  it('applies the current color to newly created shapes', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('pen');
    overlay.setColor('#ff00aa');

    dispatchPointer(svg, 'mousedown', 10, 10);
    dispatchPointer(svg, 'mousemove', 20, 20);
    dispatchPointer(svg, 'mouseup', 20, 20);

    expect(svg.querySelector('path')?.getAttribute('stroke')).toBe('#ff00aa');
  });

  it('undoes and redoes the last top-level shape', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');

    dispatchPointer(svg, 'mousedown', 10, 10);
    dispatchPointer(svg, 'mousemove', 30, 35);
    dispatchPointer(svg, 'mouseup', 30, 35);

    dispatchPointer(svg, 'mousedown', 40, 40);
    dispatchPointer(svg, 'mousemove', 60, 65);
    dispatchPointer(svg, 'mouseup', 60, 65);

    expect(getTopLevelShapes(svg)).toHaveLength(2);

    overlay.undo();
    expect(getTopLevelShapes(svg)).toHaveLength(1);

    overlay.redo();
    expect(getTopLevelShapes(svg)).toHaveLength(2);
  });

  it('commits text input into SVG text on Enter', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('text');

    dispatchPointer(svg, 'mousedown', 30, 35);
    dispatchPointer(svg, 'mouseup', 30, 35);

    const input = host.querySelector('input') as HTMLInputElement;
    expect(input).toBeInstanceOf(HTMLInputElement);

    input.value = 'Hello note';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(getSvgTexts(svg)).toContain('Hello note');
    expect(host.querySelector('input')).toBeNull();
  });

  it('cleans up the active draft and editor when deactivated', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');
    dispatchPointer(svg, 'mousedown', 10, 12);
    dispatchPointer(svg, 'mousemove', 30, 32);

    overlay.setActive(false);

    expect(svg.querySelector('rect')).toBeNull();

    overlay.setActive(true);
    overlay.setTool('text');
    dispatchPointer(svg, 'mousedown', 50, 55);
    dispatchPointer(svg, 'mouseup', 50, 55);
    expect(host.querySelector('input')).toBeInstanceOf(HTMLInputElement);

    overlay.setActive(false);
    expect(host.querySelector('input')).toBeNull();
  });

  it('returns a png data url from composite when the screenshot is empty', async () => {
    const overlay = createAnnotationOverlay();

    await expect(overlay.composite('')).resolves.toBe('data:image/png;base64,composited');
  });

  it('draws the screenshot image before the svg overlay during composite', async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);

    const overlay = createAnnotationOverlay();

    await expect(overlay.composite('data:image/png;base64,screenshot')).resolves.toBe('data:image/png;base64,composited');
    expect(loadedImageSources).toEqual([
      'data:image/png;base64,screenshot',
      expect.stringMatching(/^data:image\/svg\+xml;charset=utf-8,/),
    ]);
    expect(drawImage).toHaveBeenCalledTimes(2);
  });
});

function dispatchPointer(
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
  init: MouseEventInit = {},
) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY, ...init }));
}

function createCallout(svg: SVGSVGElement, label: string, x: number, y: number) {
  dispatchPointer(svg, 'mousedown', x, y);
  dispatchPointer(svg, 'mouseup', x, y);

  const input = svg.parentElement?.querySelector('input') as HTMLInputElement;
  input.value = label;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function getSvgTexts(svg: SVGSVGElement) {
  return Array.from(svg.querySelectorAll('text')).map((node) => node.textContent ?? '');
}

function getTopLevelShapes(svg: SVGSVGElement) {
  return Array.from(svg.children).filter((node) => node.tagName.toLowerCase() !== 'defs');
}
