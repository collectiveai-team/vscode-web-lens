import { describe, expect, it } from 'vitest';
import { buildElementCaptureOptions, buildViewportCaptureOptions, computeCropRegion, shouldIgnoreCaptureElement } from './screenshot';

describe('computeCropRegion', () => {
  it('returns the rounded element bounds when fully inside the viewport', () => {
    expect(computeCropRegion(
      { top: 10.4, left: 20.2, width: 99.7, height: 40.1 },
      800,
      600,
    )).toEqual({ x: 20, y: 10, width: 100, height: 41 });
  });

  it('clamps crop bounds to the viewport', () => {
    expect(computeCropRegion(
      { top: -15, left: 760, width: 100, height: 90 },
      800,
      600,
    )).toEqual({ x: 760, y: 0, width: 40, height: 75 });
  });

  it('returns null when the element is completely outside the viewport', () => {
    expect(computeCropRegion(
      { top: 650, left: 10, width: 50, height: 20 },
      800,
      600,
    )).toBeNull();
  });
});

describe('buildViewportCaptureOptions', () => {
  it('pins capture to the current scroll position', () => {
    expect(buildViewportCaptureOptions(800, 600, 120, 340)).toEqual(
      expect.objectContaining({
        width: 800,
        height: 600,
        windowWidth: 800,
        windowHeight: 600,
        x: 120,
        y: 340,
        scrollX: 120,
        scrollY: 340,
      }),
    );
  });
});

describe('shouldIgnoreCaptureElement', () => {
  it('ignores web lens overlay nodes in screenshots', () => {
    expect(shouldIgnoreCaptureElement({ id: '__bc-highlight' } as Element)).toBe(true);
    expect(shouldIgnoreCaptureElement({ id: '__bc-tooltip' } as Element)).toBe(true);
  });

  it('keeps regular page elements in screenshots', () => {
    expect(shouldIgnoreCaptureElement({ id: 'dashboard-header' } as Element)).toBe(false);
  });
});

describe('buildElementCaptureOptions', () => {
  it('captures the element using absolute document coordinates', () => {
    expect(
      buildElementCaptureOptions(
        { top: 12.2, left: 34.8, width: 100.1, height: 40.4 },
        800,
        600,
        10,
        200,
      ),
    ).toEqual(
      expect.objectContaining({
        x: 44,
        y: 212,
        width: 101,
        height: 41,
        scrollX: 10,
        scrollY: 200,
      }),
    );
  });
});
