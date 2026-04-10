// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnnotationOverlay } from './annotation-overlay';

describe('createAnnotationOverlay', () => {
  let host: HTMLDivElement;
  let iframe: HTMLIFrameElement;
  const OriginalImage = globalThis.Image;
  const loadedImageSources: string[] = [];
  const originalCreateSVGPoint = SVGSVGElement.prototype.createSVGPoint;
  const originalGetScreenCTM = SVGSVGElement.prototype.getScreenCTM;

  beforeEach(() => {
    document.body.innerHTML = '';
    loadedImageSources.length = 0;
    host = document.createElement('div');
    iframe = document.createElement('iframe');
    iframe.id = 'browser-iframe';
    host.appendChild(iframe);
    document.body.appendChild(host);

    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    // jsdom does not implement SVG geometry APIs used for coordinate transforms;
    // install minimal stubs so getPoint() and svgPointToCss() work in tests.
    const identityMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as unknown as DOMMatrix;
    (identityMatrix as unknown as { inverse(): DOMMatrix }).inverse = () => identityMatrix;

    const makeSvgPoint = (x = 0, y = 0): SVGPoint => {
      const pt = {
        x,
        y,
        matrixTransform(m: DOMMatrix) {
          return makeSvgPoint(
            (m as unknown as { a: number; c: number; e: number }).a * pt.x +
              (m as unknown as { c: number }).c * pt.y +
              (m as unknown as { e: number }).e,
            (m as unknown as { b: number }).b * pt.x +
              (m as unknown as { d: number }).d * pt.y +
              (m as unknown as { f: number }).f,
          );
        },
      } as unknown as SVGPoint;
      return pt;
    };

    SVGSVGElement.prototype.createSVGPoint = () => makeSvgPoint();
    SVGSVGElement.prototype.getScreenCTM = () => identityMatrix;

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
    // @ts-expect-error - cleanup jsdom global mock
    delete globalThis.ResizeObserver;
    SVGSVGElement.prototype.createSVGPoint = originalCreateSVGPoint;
    SVGSVGElement.prototype.getScreenCTM = originalGetScreenCTM;
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

  it('exposes deleteSelection and returns false when nothing is selected yet', () => {
    const overlay = createAnnotationOverlay();
    expect(overlay.deleteSelection?.()).toBe(false);
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

  it('anchors arrow start at exact mousedown coordinates', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('arrow');

    dispatchPointer(svg, 'mousedown', 21, 34);
    dispatchPointer(svg, 'mousemove', 80, 90);
    dispatchPointer(svg, 'mouseup', 80, 90);

    const line = svg.querySelector('line') as SVGLineElement;
    expect(line.getAttribute('x1')).toBe('21');
    expect(line.getAttribute('y1')).toBe('34');
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

  it('can undo and redo clear operations', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');
    drawRect(svg, 10, 10, 30, 35);
    drawRect(svg, 40, 40, 60, 65);

    expect(getTopLevelShapes(svg)).toHaveLength(2);

    expect(overlay.clear()).toBe(true);
    expect(getTopLevelShapes(svg)).toHaveLength(0);

    overlay.undo();
    expect(getTopLevelShapes(svg)).toHaveLength(2);

    overlay.redo();
    expect(getTopLevelShapes(svg)).toHaveLength(0);
  });

  it('keeps callout numbering monotonic after clear is undone', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('callout');
    createCallout(svg, 'First', 20, 20);
    createCallout(svg, 'Second', 60, 60);

    expect(getSvgTexts(svg)).toContain('1');
    expect(getSvgTexts(svg)).toContain('2');

    overlay.clear();
    overlay.undo();

    createCallout(svg, 'Third', 90, 90);
    expect(getSvgTexts(svg)).toContain('3');
  });

  it('shift-click toggles multi-selection and drag moves selected shapes', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');
    drawRect(svg, 10, 10, 40, 40);
    drawRect(svg, 60, 60, 90, 90);

    overlay.setTool('select');
    dispatchPointer(svg, 'mousedown', 20, 20);
    dispatchPointer(svg, 'mouseup', 20, 20);
    dispatchPointer(svg, 'mousedown', 70, 70, { shiftKey: true });
    dispatchPointer(svg, 'mouseup', 70, 70, { shiftKey: true });

    dispatchPointer(svg, 'mousedown', 70, 70);
    dispatchPointer(svg, 'mousemove', 90, 90);
    dispatchPointer(svg, 'mouseup', 90, 90);

    const rects = svg.querySelectorAll('rect');
    expect(rects[0]?.getAttribute('x')).toBe('30');
    expect(rects[1]?.getAttribute('x')).toBe('80');
  });

  it('clears stale select drag session when switching tools mid-drag', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');
    drawRect(svg, 10, 10, 40, 40);

    overlay.setTool('select');
    dispatchPointer(svg, 'mousedown', 20, 20);
    overlay.setTool('pen');
    overlay.setTool('select');

    dispatchPointer(svg, 'mousemove', 50, 50);
    dispatchPointer(svg, 'mouseup', 50, 50);

    const rect = svg.querySelector('rect') as SVGRectElement;
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('y')).toBe('10');
  });

  it('removes in-progress draft when switching tools mid-draw', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');

    dispatchPointer(svg, 'mousedown', 10, 10);
    dispatchPointer(svg, 'mousemove', 35, 35);

    overlay.setTool('select');
    dispatchPointer(svg, 'mouseup', 35, 35);

    expect(svg.querySelector('rect')).toBeNull();
    expect(overlay.hasShapes()).toBe(false);
  });

  it('shift-click on a selected shape toggles it out of the selection', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');
    drawRect(svg, 10, 10, 40, 40);
    drawRect(svg, 60, 60, 90, 90);

    overlay.setTool('select');
    dispatchPointer(svg, 'mousedown', 20, 20);
    dispatchPointer(svg, 'mouseup', 20, 20);
    dispatchPointer(svg, 'mousedown', 70, 70, { shiftKey: true });
    dispatchPointer(svg, 'mouseup', 70, 70, { shiftKey: true });
    dispatchPointer(svg, 'mousedown', 70, 70, { shiftKey: true });
    dispatchPointer(svg, 'mouseup', 70, 70, { shiftKey: true });

    dispatchPointer(svg, 'mousedown', 20, 20);
    dispatchPointer(svg, 'mousemove', 40, 40);
    dispatchPointer(svg, 'mouseup', 40, 40);

    const rects = svg.querySelectorAll('rect');
    expect(rects[0]?.getAttribute('x')).toBe('30');
    expect(rects[1]?.getAttribute('x')).toBe('60');
  });

  it('deleteSelection removes selected shapes only', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');
    drawRect(svg, 10, 10, 40, 40);
    drawRect(svg, 60, 60, 90, 90);

    overlay.setTool('select');
    dispatchPointer(svg, 'mousedown', 20, 20);
    dispatchPointer(svg, 'mouseup', 20, 20);

    expect(overlay.deleteSelection?.()).toBe(true);
    expect(svg.querySelectorAll('rect')).toHaveLength(1);
    expect((svg.querySelector('rect') as SVGRectElement).getAttribute('x')).toBe('60');
    expect(overlay.deleteSelection?.()).toBe(false);
  });

  it('resizes selected group from bounding-box corner handle', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');
    drawRect(svg, 10, 10, 30, 30);
    drawRect(svg, 40, 20, 60, 40);

    overlay.setTool('select');
    dispatchPointer(svg, 'mousedown', 20, 20);
    dispatchPointer(svg, 'mouseup', 20, 20);
    dispatchPointer(svg, 'mousedown', 50, 30, { shiftKey: true });
    dispatchPointer(svg, 'mouseup', 50, 30, { shiftKey: true });

    const handle = svg.querySelector('[data-resize-handle="se"]') as SVGCircleElement | null;
    expect(handle).not.toBeNull();
    expect(handle?.tagName.toLowerCase()).toBe('circle');

    dispatchPointer(handle as SVGCircleElement, 'mousedown', 60, 40);
    dispatchPointer(svg, 'mousemove', 110, 70);
    dispatchPointer(svg, 'mouseup', 110, 70);

    const rects = svg.querySelectorAll('rect');
    expect(rects[0]?.getAttribute('x')).toBe('10');
    expect(rects[0]?.getAttribute('y')).toBe('10');
    expect(rects[0]?.getAttribute('width')).toBe('40');
    expect(rects[0]?.getAttribute('height')).toBe('40');
    expect(rects[1]?.getAttribute('x')).toBe('70');
    expect(rects[1]?.getAttribute('y')).toBe('30');
    expect(rects[1]?.getAttribute('width')).toBe('40');
    expect(rects[1]?.getAttribute('height')).toBe('40');
  });

  it('does not compound resize scale across multiple mousemove events', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');
    drawRect(svg, 10, 10, 30, 30);

    overlay.setTool('select');
    dispatchPointer(svg, 'mousedown', 20, 20);
    dispatchPointer(svg, 'mouseup', 20, 20);

    const handle = svg.querySelector('[data-resize-handle="se"]') as SVGCircleElement | null;
    expect(handle).not.toBeNull();

    dispatchPointer(handle as SVGCircleElement, 'mousedown', 30, 30);
    dispatchPointer(svg, 'mousemove', 40, 40);
    dispatchPointer(svg, 'mousemove', 50, 50);
    dispatchPointer(svg, 'mouseup', 50, 50);

    const rect = svg.querySelector('rect') as SVGRectElement;
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('y')).toBe('10');
    expect(rect.getAttribute('width')).toBe('40');
    expect(rect.getAttribute('height')).toBe('40');
  });

  it('applies aspect-ratio lock when shift is held during resize', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');
    drawRect(svg, 10, 10, 30, 30);
    drawRect(svg, 40, 20, 60, 40);

    overlay.setTool('select');
    dispatchPointer(svg, 'mousedown', 20, 20);
    dispatchPointer(svg, 'mouseup', 20, 20);
    dispatchPointer(svg, 'mousedown', 50, 30, { shiftKey: true });
    dispatchPointer(svg, 'mouseup', 50, 30, { shiftKey: true });

    const handle = svg.querySelector('[data-resize-handle="se"]') as SVGCircleElement | null;
    expect(handle).not.toBeNull();

    dispatchPointer(handle as SVGCircleElement, 'mousedown', 60, 40, { shiftKey: true });
    dispatchPointer(svg, 'mousemove', 90, 100, { shiftKey: true });
    dispatchPointer(svg, 'mouseup', 90, 100, { shiftKey: true });

    const rects = svg.querySelectorAll('rect');
    const width = Number.parseFloat(rects[0]?.getAttribute('width') ?? '0');
    const height = Number.parseFloat(rects[0]?.getAttribute('height') ?? '0');
    expect(width).toBeGreaterThan(20);
    expect(width).toBeCloseTo(height, 5);
  });

  it('drags arrow endpoint handle without moving entire selection', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('arrow');
    dispatchPointer(svg, 'mousedown', 20, 20);
    dispatchPointer(svg, 'mousemove', 80, 80);
    dispatchPointer(svg, 'mouseup', 80, 80);

    overlay.setTool('select');
    dispatchPointer(svg, 'mousedown', 50, 50);
    dispatchPointer(svg, 'mouseup', 50, 50);

    const startHandle = svg.querySelector('[data-arrow-endpoint="start"]') as SVGCircleElement | null;
    expect(startHandle).not.toBeNull();
    expect(startHandle?.tagName.toLowerCase()).toBe('circle');

    dispatchPointer(startHandle as SVGCircleElement, 'mousedown', 20, 20);
    dispatchPointer(svg, 'mousemove', 10, 15);
    dispatchPointer(svg, 'mouseup', 10, 15);

    const line = svg.querySelector('line') as SVGLineElement;
    expect(line.getAttribute('x1')).toBe('10');
    expect(line.getAttribute('y1')).toBe('15');
    expect(line.getAttribute('x2')).toBe('80');
    expect(line.getAttribute('y2')).toBe('80');
  });

  it('undo/redo remains correct across create move resize endpoint and delete', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);

    overlay.setTool('rect');
    drawRect(svg, 10, 10, 30, 30);

    overlay.setTool('arrow');
    dispatchPointer(svg, 'mousedown', 40, 40);
    dispatchPointer(svg, 'mousemove', 70, 70);
    dispatchPointer(svg, 'mouseup', 70, 70);

    overlay.setTool('select');
    let rectNode = svg.querySelector('rect') as SVGRectElement;
    const lineNode = svg.querySelector('line') as SVGLineElement;
    dispatchPointer(rectNode, 'mousedown', 20, 20);
    dispatchPointer(rectNode, 'mouseup', 20, 20);

    dispatchPointer(svg, 'mousedown', 20, 20);
    dispatchPointer(svg, 'mousemove', 40, 30);
    dispatchPointer(svg, 'mouseup', 40, 30);

    const resizeHandle = svg.querySelector('[data-resize-handle="se"]') as SVGCircleElement | null;
    expect(resizeHandle).not.toBeNull();
    dispatchPointer(resizeHandle as SVGCircleElement, 'mousedown', 50, 40);
    dispatchPointer(svg, 'mousemove', 70, 60);
    dispatchPointer(svg, 'mouseup', 70, 60);

    dispatchPointer(lineNode, 'mousedown', 55, 55);
    dispatchPointer(lineNode, 'mouseup', 55, 55);

    const startHandle = svg.querySelector('[data-arrow-endpoint="start"]') as SVGCircleElement | null;
    expect(startHandle).not.toBeNull();
    dispatchPointer(startHandle as SVGCircleElement, 'mousedown', 40, 40);
    dispatchPointer(svg, 'mousemove', 30, 35);
    dispatchPointer(svg, 'mouseup', 30, 35);

    expect(overlay.deleteSelection?.()).toBe(true);
    expect(svg.querySelectorAll('line')).toHaveLength(0);
    expect((svg.querySelector('rect') as SVGRectElement).getAttribute('width')).toBe('40');

    overlay.undo();
    let line = svg.querySelector('line') as SVGLineElement;
    expect(line).not.toBeNull();
    expect(line.getAttribute('x1')).toBe('30');
    expect(line.getAttribute('y1')).toBe('35');

    overlay.undo();
    line = svg.querySelector('line') as SVGLineElement;
    expect(line.getAttribute('x1')).toBe('40');
    expect(line.getAttribute('y1')).toBe('40');

    overlay.undo();
    let rect = svg.querySelector('rect') as SVGRectElement;
    line = svg.querySelector('line') as SVGLineElement;
    expect(rect.getAttribute('x')).toBe('30');
    expect(rect.getAttribute('y')).toBe('20');
    expect(rect.getAttribute('width')).toBe('20');
    expect(rect.getAttribute('height')).toBe('20');
    expect(line.getAttribute('x1')).toBe('40');
    expect(line.getAttribute('y1')).toBe('40');
    expect(line.getAttribute('x2')).toBe('70');
    expect(line.getAttribute('y2')).toBe('70');

    overlay.undo();
    rect = svg.querySelector('rect') as SVGRectElement;
    line = svg.querySelector('line') as SVGLineElement;
    expect(rect.getAttribute('x')).toBe('10');
    expect(rect.getAttribute('y')).toBe('10');
    expect(rect.getAttribute('width')).toBe('20');
    expect(rect.getAttribute('height')).toBe('20');
    expect(line.getAttribute('x1')).toBe('40');
    expect(line.getAttribute('y1')).toBe('40');
    expect(line.getAttribute('x2')).toBe('70');
    expect(line.getAttribute('y2')).toBe('70');

    overlay.undo();
    expect(svg.querySelectorAll('rect')).toHaveLength(1);
    expect(svg.querySelectorAll('line')).toHaveLength(0);

    overlay.undo();
    expect(getTopLevelShapes(svg)).toHaveLength(0);

    overlay.redo();
    overlay.redo();
    overlay.redo();
    overlay.redo();
    overlay.redo();
    overlay.redo();

    expect(svg.querySelectorAll('rect')).toHaveLength(1);
    expect(svg.querySelectorAll('line')).toHaveLength(0);
    rectNode = svg.querySelector('rect') as SVGRectElement;
    expect(rectNode.getAttribute('x')).toBe('30');
    expect(rectNode.getAttribute('y')).toBe('20');
    expect(rectNode.getAttribute('width')).toBe('40');
    expect(rectNode.getAttribute('height')).toBe('40');
  });

  it('allows selecting and deleting pen shapes', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('pen');
    dispatchPointer(svg, 'mousedown', 10, 10);
    dispatchPointer(svg, 'mousemove', 25, 25);
    dispatchPointer(svg, 'mouseup', 25, 25);

    overlay.setTool('select');
    dispatchPointer(svg, 'mousedown', 18, 18);
    dispatchPointer(svg, 'mouseup', 18, 18);

    expect(overlay.deleteSelection?.()).toBe(true);
    expect(svg.querySelector('path')).toBeNull();
  });

  it('can reselect a moved callout by its new position', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('callout');
    createCallout(svg, 'Move me', 25, 30);

    overlay.setTool('select');
    dispatchPointer(svg, 'mousedown', 25, 30);
    dispatchPointer(svg, 'mousemove', 60, 70);
    dispatchPointer(svg, 'mouseup', 60, 70);

    dispatchPointer(svg, 'mousedown', 60, 70);
    dispatchPointer(svg, 'mouseup', 60, 70);

    expect(overlay.deleteSelection?.()).toBe(true);
    expect(svg.querySelector('g')).toBeNull();
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

  it('shows the inline editor placeholder for text and callout tools', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);

    overlay.setTool('text');
    dispatchPointer(svg, 'mousedown', 30, 35);
    dispatchPointer(svg, 'mouseup', 30, 35);

    let input = host.querySelector('input') as HTMLInputElement;
    expect(input.placeholder).toBe('Type and press Enter');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    overlay.setTool('callout');
    dispatchPointer(svg, 'mousedown', 40, 45);
    dispatchPointer(svg, 'mouseup', 40, 45);

    input = host.querySelector('input') as HTMLInputElement;
    expect(input.placeholder).toBe('Type and press Enter');
  });

  it('cancels inline editor on Escape without committing a shape', () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('text');

    dispatchPointer(svg, 'mousedown', 12, 18);
    dispatchPointer(svg, 'mouseup', 12, 18);

    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'Should not commit';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(getSvgTexts(svg)).not.toContain('Should not commit');
    expect(host.querySelector('input')).toBeNull();
  });

  it('commits non-empty inline editor value on blur', async () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('text');

    dispatchPointer(svg, 'mousedown', 12, 18);
    dispatchPointer(svg, 'mouseup', 12, 18);

    // Flush the requestAnimationFrame that registers the blur listener
    await new Promise((r) => requestAnimationFrame(r));

    const input = host.querySelector('input') as HTMLInputElement;
    input.value = 'Blur commit';
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    expect(getSvgTexts(svg)).toContain('Blur commit');
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

  it('excludes transient selection handles from composited SVG output', async () => {
    const overlay = createAnnotationOverlay();
    const svg = host.querySelector('svg') as SVGSVGElement;

    overlay.setActive(true);
    overlay.setTool('rect');
    drawRect(svg, 10, 10, 30, 30);

    overlay.setTool('select');
    dispatchPointer(svg, 'mousedown', 20, 20);
    dispatchPointer(svg, 'mouseup', 20, 20);
    expect(svg.querySelector('[data-resize-handle="se"]')).not.toBeNull();

    await overlay.composite('');

    const encodedSvgData = loadedImageSources[loadedImageSources.length - 1]?.split(',')[1] ?? '';
    const serializedSvg = decodeURIComponent(encodedSvgData);
    expect(serializedSvg).not.toContain('data-resize-handle');
    expect(serializedSvg).not.toContain('data-arrow-endpoint');
    expect(serializedSvg).not.toContain('stroke-dasharray="4 2"');
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

function drawRect(svg: SVGSVGElement, x1: number, y1: number, x2: number, y2: number) {
  dispatchPointer(svg, 'mousedown', x1, y1);
  dispatchPointer(svg, 'mousemove', x2, y2);
  dispatchPointer(svg, 'mouseup', x2, y2);
}

function getSvgTexts(svg: SVGSVGElement) {
  return Array.from(svg.querySelectorAll('text')).map((node) => node.textContent ?? '');
}

function getTopLevelShapes(svg: SVGSVGElement) {
  return Array.from(svg.children).filter((node) => node.tagName.toLowerCase() !== 'defs');
}
