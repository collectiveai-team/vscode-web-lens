# Annotation Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Annotation Mode toolbar button that overlays a transparent SVG canvas on the live iframe, lets users draw shapes/text/callouts, and sends the composite annotated screenshot to chat.

**Architecture:** An `<svg>` element is absolutely positioned over `#browser-iframe` in the webview. All annotation shapes are SVG child elements (freehand `<path>`, `<line>`, `<rect>`, `<ellipse>`, `<text>`, callout circles). On "Send", the iframe screenshot and SVG are composited onto an offscreen `<canvas>` and the resulting PNG is posted to the extension host as `annotate:sendToChat`. A dedicated annotation strip slides in below the toolbar (extending the existing instruction-banner mechanism) holding all tool controls.

**Tech Stack:** TypeScript, SVG DOM API, HTML5 Canvas (offscreen compositing only), VS Code Webview API, Vitest

**Working directory for all commands:** `.worktrees/annotation-mode` (the `feature/annotation-mode` branch)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/webview/annotation-overlay.ts` | SVG canvas + tool engine (draw, undo, composite) |
| **Create** | `src/webview/annotation-overlay.test.ts` | Unit tests for overlay |
| **Modify** | `src/types.ts` | Add `annotate:sendToChat` to `WebviewMessage` union |
| **Modify** | `src/webview/toolbarDiagnostics.ts` | Add `annotateActive` to `ToolbarStateSnapshot`; update `getInstructionBannerHtml` |
| **Modify** | `src/webview/toolbar.ts` | Add `annotateActive` to `ToolbarState`; add annotate button; add annotation strip DOM + logic |
| **Modify** | `src/webview/main.ts` | Import and wire `AnnotationOverlay` to toolbar state |
| **Modify** | `src/extension.ts` | Handle `annotate:sendToChat` in `deliverContext` and message switch |
| **Modify** | `src/context/ContextExtractor.ts` | Add `fromAnnotation` method |

---

## Task 1: Add `annotate:sendToChat` message type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the new message type to `WebviewMessage` and the `annotation` field to `ContextBundle`**

Open `src/types.ts` and make two changes:

**1a.** Add to the `WebviewMessage` union (after the `addElement:captured` line):
```typescript
// Before (line 11):
  | { type: 'addElement:captured'; payload: CapturedElementPayload }

// After:
  | { type: 'addElement:captured'; payload: CapturedElementPayload }
  | { type: 'annotate:sendToChat'; payload: { imageDataUrl: string; prompt: string } }
```

**1b.** Add `annotation?: string` to the `ContextBundle` interface (after `logs?`):
```typescript
export interface ContextBundle {
  url: string;
  timestamp: number;
  element?: ElementContext;
  screenshot?: ScreenshotData;
  logs?: ConsoleEntry[];
  annotation?: string;        // ← add this line
}
```

- [ ] **Step 2: Run the type-checker to confirm no regressions**

```bash
npx tsc --noEmit
```

Expected: zero errors. (Only `src/types.ts` changes in this task — downstream files that reference `ContextBundle` will still compile since `annotation` is optional.)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add annotate:sendToChat message type and ContextBundle.annotation field"
```

---

## Task 2: Create `annotation-overlay.ts` — core SVG engine

**Files:**
- Create: `src/webview/annotation-overlay.ts`
- Create: `src/webview/annotation-overlay.test.ts`

The overlay module owns all SVG drawing logic. The toolbar and main.ts only call its public API.

- [ ] **Step 1: Write failing tests for the overlay**

Create `src/webview/annotation-overlay.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAnnotationOverlay, type AnnotationTool } from './annotation-overlay';

// JSDOM provides SVG stubs but not SVGPathElement etc — use Element checks
describe('AnnotationOverlay', () => {
  let svg: SVGSVGElement;
  let iframe: HTMLIFrameElement;
  let overlay: ReturnType<typeof createAnnotationOverlay>;

  beforeEach(() => {
    document.body.innerHTML = `
      <div style="position:relative">
        <iframe id="browser-iframe" style="width:800px;height:600px"></iframe>
      </div>
    `;
    iframe = document.getElementById('browser-iframe') as HTMLIFrameElement;
    overlay = createAnnotationOverlay(iframe);
    svg = document.querySelector('svg')!;
  });

  it('inserts an SVG element into the iframe parent', () => {
    expect(svg).not.toBeNull();
    expect(svg.tagName).toBe('svg');
  });

  it('hasShapes() returns false on empty canvas', () => {
    expect(overlay.hasShapes()).toBe(false);
  });

  it('clear() returns false when canvas is already empty', () => {
    expect(overlay.clear()).toBe(false);
  });

  it('pen tool: mousedown+mousemove+mouseup creates one path element', () => {
    overlay.setActive(true);
    overlay.setTool('pen');
    svg.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 20, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 30, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(svg.querySelectorAll('path').length).toBe(1);
    expect(overlay.hasShapes()).toBe(true);
  });

  it('arrow tool: mousedown+mouseup creates a line element with marker-end', () => {
    overlay.setActive(true);
    overlay.setTool('arrow');
    svg.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 50, clientY: 50, bubbles: true }));
    const line = svg.querySelector('line');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('marker-end')).toMatch(/url\(#/);
  });

  it('rect tool: mousedown+mouseup creates a rect element', () => {
    overlay.setActive(true);
    overlay.setTool('rect');
    svg.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 60, clientY: 40, bubbles: true }));
    const rect = svg.querySelector('rect');
    expect(rect).not.toBeNull();
  });

  it('callout tool: first click creates circle with text "1"', () => {
    overlay.setActive(true);
    overlay.setTool('callout');
    svg.dispatchEvent(new MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true }));
    const circle = svg.querySelector('circle');
    const text = svg.querySelector('text');
    expect(circle).not.toBeNull();
    expect(text?.textContent).toBe('1');
  });

  it('callout counter increments on subsequent clicks', () => {
    overlay.setActive(true);
    overlay.setTool('callout');
    svg.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true }));
    const texts = svg.querySelectorAll('text');
    // Each callout = 1 text node (the number)
    const numbers = Array.from(texts).map(t => t.textContent);
    expect(numbers).toContain('1');
    expect(numbers).toContain('2');
  });

  it('clear() resets counter and returns true when shapes existed', () => {
    overlay.setActive(true);
    overlay.setTool('callout');
    svg.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10, bubbles: true }));
    expect(overlay.clear()).toBe(true);
    expect(overlay.hasShapes()).toBe(false);
    // After clear, next callout should be "1" again
    svg.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10, bubbles: true }));
    const text = svg.querySelector('text');
    expect(text?.textContent).toBe('1');
  });

  it('setColor: new color applies as stroke on next pen stroke', () => {
    overlay.setActive(true);
    overlay.setTool('pen');
    overlay.setColor('#e74c3c');
    svg.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const path = svg.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('#e74c3c');
  });

  it('undo removes the last shape; redo re-appends it', () => {
    overlay.setActive(true);
    overlay.setTool('callout');
    svg.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true }));
    expect(overlay.hasShapes()).toBe(true);
    const countBefore = svg.children.length;
    overlay.undo();
    expect(svg.children.length).toBe(countBefore - 1);
    overlay.redo();
    expect(svg.children.length).toBe(countBefore);
  });

  it('composite returns a non-empty string when called with empty screenshotDataUrl', async () => {
    // Minimal smoke test — JSDOM canvas.toDataURL returns a stub
    const result = await overlay.composite('');
    expect(typeof result).toBe('string');
  });
});
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
npx vitest run src/webview/annotation-overlay.test.ts
```

Expected: all tests fail with "Cannot find module './annotation-overlay'".

- [ ] **Step 3: Create `src/webview/annotation-overlay.ts`**

```typescript
/**
 * Annotation overlay — transparent SVG canvas over the browser iframe.
 *
 * Manages drawing tools, undo/redo, and compositing the SVG with a
 * screenshot for sending to chat. Lives entirely in the webview layer.
 */

export type AnnotationTool = 'pen' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'callout';

export interface AnnotationOverlay {
  setActive(active: boolean): void;
  setTool(tool: AnnotationTool): void;
  setColor(color: string): void;
  undo(): void;
  redo(): void;
  /** Returns true if shapes existed (for confirm guard). */
  clear(): boolean;
  hasShapes(): boolean;
  /** Composite screenshot + SVG into a PNG dataUrl. */
  composite(screenshotDataUrl: string): Promise<string>;
  destroy(): void;
}

const COLORS = ['#e74c3c', '#f39c12', '#f9c74f', '#2ecc71', '#4a90d9', '#ffffff'];
const DEFAULT_STROKE_WIDTH = 2.5;

export function createAnnotationOverlay(iframe: HTMLIFrameElement): AnnotationOverlay {
  // ── SVG setup ────────────────────────────────────────────
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg') as SVGSVGElement;
  svg.style.cssText = `
    position: absolute;
    top: 0; left: 0; width: 100%; height: 100%;
    z-index: 10;
    pointer-events: none;
    overflow: visible;
  `;

  const defs = document.createElementNS(svgNS, 'defs') as SVGDefsElement;
  svg.appendChild(defs);

  const parent = iframe.parentElement!;
  parent.style.position = 'relative';
  parent.appendChild(svg);

  // ── State ────────────────────────────────────────────────
  let activeTool: AnnotationTool = 'pen';
  let activeColor = COLORS[0]; // red
  let calloutCounter = 0;
  let isActive = false;

  // Undo/redo stacks — track top-level shape elements (not defs children)
  const undoStack: SVGElement[] = [];
  const redoStack: SVGElement[] = [];

  // Per-gesture state
  let drawing = false;
  let startX = 0;
  let startY = 0;
  let currentPath: SVGPathElement | null = null;
  let previewShape: SVGElement | null = null;

  // ── Helpers ──────────────────────────────────────────────

  function getRelativeCoords(e: MouseEvent): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function ensureArrowMarker(color: string): string {
    const markerId = `arrow-${color.replace('#', '')}`;
    if (!defs.querySelector(`#${markerId}`)) {
      const marker = document.createElementNS(svgNS, 'marker');
      marker.setAttribute('id', markerId);
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '8');
      marker.setAttribute('refX', '6');
      marker.setAttribute('refY', '4');
      marker.setAttribute('orient', 'auto');
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z');
      path.setAttribute('fill', color);
      marker.appendChild(path);
      defs.appendChild(marker);
    }
    return markerId;
  }

  function pushShape(el: SVGElement) {
    svg.appendChild(el);
    undoStack.push(el);
    redoStack.length = 0; // drawing invalidates redo stack
  }

  // ── Mouse event handlers ─────────────────────────────────

  function onMouseDown(e: MouseEvent) {
    if (!isActive) return;
    if (activeTool === 'callout' || activeTool === 'text') return; // handled by click
    e.preventDefault();
    drawing = true;
    const { x, y } = getRelativeCoords(e);
    startX = x;
    startY = y;

    if (activeTool === 'pen') {
      const path = document.createElementNS(svgNS, 'path') as SVGPathElement;
      path.setAttribute('d', `M ${x} ${y}`);
      path.setAttribute('stroke', activeColor);
      path.setAttribute('stroke-width', String(DEFAULT_STROKE_WIDTH));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      currentPath = path;
    } else {
      // For shape tools, create a preview element
      previewShape = createShapePreview(x, y, x, y);
      if (previewShape) svg.appendChild(previewShape);
    }
  }

  function onMouseMove(e: MouseEvent) {
    if (!isActive || !drawing) return;
    const { x, y } = getRelativeCoords(e);

    if (activeTool === 'pen' && currentPath) {
      const d = currentPath.getAttribute('d') || '';
      currentPath.setAttribute('d', `${d} L ${x} ${y}`);
    } else if (previewShape) {
      updateShapePreview(previewShape, startX, startY, x, y);
    }
  }

  function onMouseUp(e: MouseEvent) {
    if (!isActive || !drawing) return;
    drawing = false;
    const { x, y } = getRelativeCoords(e);

    if (activeTool === 'pen' && currentPath) {
      // Only keep if actually moved (not just a click)
      const d = currentPath.getAttribute('d') || '';
      if (d.includes('L')) {
        pushShape(currentPath);
      } else {
        svg.removeChild(currentPath);
      }
      currentPath = null;
    } else if (previewShape) {
      svg.removeChild(previewShape);
      const finalShape = createFinalShape(startX, startY, x, y);
      if (finalShape) pushShape(finalShape);
      previewShape = null;
    }
  }

  function onClick(e: MouseEvent) {
    if (!isActive) return;
    const { x, y } = getRelativeCoords(e);

    if (activeTool === 'callout') {
      calloutCounter++;
      const group = document.createElementNS(svgNS, 'g') as SVGGElement;

      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', '12');
      circle.setAttribute('fill', activeColor);

      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', String(x));
      text.setAttribute('y', String(y + 4));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#ffffff');
      text.setAttribute('font-size', '12');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('font-family', 'sans-serif');
      text.setAttribute('pointer-events', 'none');
      text.textContent = String(calloutCounter);

      group.appendChild(circle);
      group.appendChild(text);
      pushShape(group);
    } else if (activeTool === 'text') {
      placeTextInput(x, y);
    }
  }

  function placeTextInput(x: number, y: number) {
    // Place a temporary <input> overlay; on commit, replace with <text>
    const input = document.createElement('input');
    input.type = 'text';
    input.style.cssText = `
      position: absolute;
      left: ${x}px; top: ${y - 10}px;
      background: transparent;
      border: 1px dashed ${activeColor};
      color: ${activeColor};
      font-size: 14px;
      font-family: sans-serif;
      outline: none;
      min-width: 80px;
      z-index: 20;
      padding: 2px 4px;
    `;
    parent.appendChild(input);
    input.focus();

    function commit() {
      const value = input.value.trim();
      parent.removeChild(input);
      if (value) {
        const textEl = document.createElementNS(svgNS, 'text') as SVGTextElement;
        textEl.setAttribute('x', String(x));
        textEl.setAttribute('y', String(y));
        textEl.setAttribute('fill', activeColor);
        textEl.setAttribute('font-size', '14');
        textEl.setAttribute('font-family', 'sans-serif');
        textEl.setAttribute('font-weight', 'bold');
        textEl.textContent = value;
        pushShape(textEl);
      }
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { parent.removeChild(input); }
    });
    input.addEventListener('blur', commit);
  }

  // ── Shape factories ──────────────────────────────────────

  function createShapePreview(x1: number, y1: number, x2: number, y2: number): SVGElement | null {
    return createFinalShape(x1, y1, x2, y2);
  }

  function updateShapePreview(el: SVGElement, x1: number, y1: number, x2: number, y2: number) {
    if (activeTool === 'arrow') {
      (el as SVGLineElement).setAttribute('x1', String(x1));
      (el as SVGLineElement).setAttribute('y1', String(y1));
      (el as SVGLineElement).setAttribute('x2', String(x2));
      (el as SVGLineElement).setAttribute('y2', String(y2));
    } else if (activeTool === 'rect') {
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
      (el as SVGRectElement).setAttribute('x', String(rx));
      (el as SVGRectElement).setAttribute('y', String(ry));
      (el as SVGRectElement).setAttribute('width', String(Math.abs(x2 - x1)));
      (el as SVGRectElement).setAttribute('height', String(Math.abs(y2 - y1)));
    } else if (activeTool === 'ellipse') {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      (el as SVGEllipseElement).setAttribute('cx', String(cx));
      (el as SVGEllipseElement).setAttribute('cy', String(cy));
      (el as SVGEllipseElement).setAttribute('rx', String(Math.abs(x2 - x1) / 2));
      (el as SVGEllipseElement).setAttribute('ry', String(Math.abs(y2 - y1) / 2));
    }
  }

  function createFinalShape(x1: number, y1: number, x2: number, y2: number): SVGElement | null {
    const fill = hexToRgba(activeColor, 0.12);

    if (activeTool === 'arrow') {
      const markerId = ensureArrowMarker(activeColor);
      const line = document.createElementNS(svgNS, 'line') as SVGLineElement;
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      line.setAttribute('stroke', activeColor);
      line.setAttribute('stroke-width', String(DEFAULT_STROKE_WIDTH));
      line.setAttribute('marker-end', `url(#${markerId})`);
      return line;
    }

    if (activeTool === 'rect') {
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
      const rect = document.createElementNS(svgNS, 'rect') as SVGRectElement;
      rect.setAttribute('x', String(rx));
      rect.setAttribute('y', String(ry));
      rect.setAttribute('width', String(Math.abs(x2 - x1)));
      rect.setAttribute('height', String(Math.abs(y2 - y1)));
      rect.setAttribute('stroke', activeColor);
      rect.setAttribute('stroke-width', String(DEFAULT_STROKE_WIDTH));
      rect.setAttribute('fill', fill);
      rect.setAttribute('rx', '3');
      return rect;
    }

    if (activeTool === 'ellipse') {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const ellipse = document.createElementNS(svgNS, 'ellipse') as SVGEllipseElement;
      ellipse.setAttribute('cx', String(cx));
      ellipse.setAttribute('cy', String(cy));
      ellipse.setAttribute('rx', String(Math.abs(x2 - x1) / 2));
      ellipse.setAttribute('ry', String(Math.abs(y2 - y1) / 2));
      ellipse.setAttribute('stroke', activeColor);
      ellipse.setAttribute('stroke-width', String(DEFAULT_STROKE_WIDTH));
      ellipse.setAttribute('fill', fill);
      return ellipse;
    }

    return null;
  }

  function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ── Event listeners ──────────────────────────────────────
  svg.addEventListener('mousedown', onMouseDown);
  svg.addEventListener('mousemove', onMouseMove);
  svg.addEventListener('click', onClick);
  window.addEventListener('mouseup', onMouseUp);

  // ── Public API ───────────────────────────────────────────

  function setActive(active: boolean) {
    isActive = active;
    svg.style.pointerEvents = active ? 'all' : 'none';
    iframe.style.pointerEvents = active ? 'none' : '';
  }

  function setTool(tool: AnnotationTool) {
    activeTool = tool;
  }

  function setColor(color: string) {
    activeColor = color;
  }

  function undo() {
    const el = undoStack.pop();
    if (el && svg.contains(el)) {
      svg.removeChild(el);
      redoStack.push(el);
    }
  }

  function redo() {
    const el = redoStack.pop();
    if (el) {
      svg.appendChild(el);
      undoStack.push(el);
    }
  }

  function clear(): boolean {
    const hadShapes = undoStack.length > 0;
    // Remove all shape elements (keep defs)
    const toRemove = Array.from(svg.childNodes).filter(n => n !== defs) as SVGElement[];
    toRemove.forEach(el => svg.removeChild(el));
    // Clear defs children (markers)
    while (defs.firstChild) defs.removeChild(defs.firstChild);
    undoStack.length = 0;
    redoStack.length = 0;
    calloutCounter = 0;
    return hadShapes;
  }

  function hasShapes(): boolean {
    return undoStack.length > 0;
  }

  async function composite(screenshotDataUrl: string): Promise<string> {
    const { width, height } = iframe.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = width || 800;
    canvas.height = height || 600;
    const ctx = canvas.getContext('2d')!;

    // Draw background (screenshot or white)
    if (screenshotDataUrl) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(); };
        img.onerror = () => resolve();
        img.src = screenshotDataUrl;
      });
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Overlay SVG
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const svgDataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(); };
      img.onerror = () => resolve();
      img.src = svgDataUri;
    });

    return canvas.toDataURL('image/png');
  }

  function destroy() {
    svg.removeEventListener('mousedown', onMouseDown);
    svg.removeEventListener('mousemove', onMouseMove);
    svg.removeEventListener('click', onClick);
    window.removeEventListener('mouseup', onMouseUp);
    if (parent.contains(svg)) parent.removeChild(svg);
  }

  return { setActive, setTool, setColor, undo, redo, clear, hasShapes, composite, destroy };
}

export { COLORS as ANNOTATION_COLORS };
```

- [ ] **Step 4: Run tests — they should now pass**

```bash
npx vitest run src/webview/annotation-overlay.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/webview/annotation-overlay.ts src/webview/annotation-overlay.test.ts
git commit -m "feat(webview): add annotation overlay SVG engine with TDD"
```

---

## Task 3: Update `toolbarDiagnostics.ts`

**Files:**
- Modify: `src/webview/toolbarDiagnostics.ts`

- [ ] **Step 1: Extend `ToolbarStateSnapshot` and `getInstructionBannerHtml`**

Replace the entire file content of `src/webview/toolbarDiagnostics.ts`:

```typescript
import type { WebviewMessage } from '../types';

interface ToolbarStateSnapshot {
  inspectActive: boolean;
  addElementActive: boolean;
  annotateActive: boolean;
}

export function createToolbarDiagnostic(message: string, details?: string): WebviewMessage {
  return {
    type: 'diagnostic:log',
    payload: {
      source: 'webview.toolbar',
      level: 'info',
      message,
      details,
    },
  };
}

export function getInstructionBannerHtml(state: ToolbarStateSnapshot): string {
  let message = '';

  if (state.inspectActive) {
    message = 'Inspect mode active - hover elements, click to inspect';
  } else if (state.addElementActive) {
    message = 'Click any element to add it to chat';
  } else if (state.annotateActive) {
    message = 'Annotation mode active - draw, then press Send to attach to chat';
  }

  if (!message) {
    return '';
  }

  return `${message} &nbsp; <kbd>ESC</kbd> to cancel`;
}
```

- [ ] **Step 2: Run type-checker**

```bash
npx tsc --noEmit
```

Expected: zero errors. (Only `toolbarDiagnostics.ts` changes in this task; `toolbar.ts` will pick up the new `ToolbarStateSnapshot` shape automatically since it imports `getInstructionBannerHtml` — which uses `ToolbarStateSnapshot` locally, not exported. No cascade errors.)

- [ ] **Step 3: Commit**

```bash
git add src/webview/toolbarDiagnostics.ts
git commit -m "feat(toolbar): extend ToolbarStateSnapshot with annotateActive"
```

---

## Task 4: Extend `toolbar.ts` — annotate button + annotation strip

**Files:**
- Modify: `src/webview/toolbar.ts`

This is the largest change. We add `annotateActive` to state, an annotate toolbar button, and a full-width annotation strip that slides in below the toolbar.

- [ ] **Step 1: Add `annotateActive` to `ToolbarState` and `ToolbarElements`, and the annotate button HTML**

In `src/webview/toolbar.ts`, make the following changes:

**1a. Extend `ToolbarState` (lines 6-9):**
```typescript
interface ToolbarState {
  inspectActive: boolean;
  addElementActive: boolean;
  annotateActive: boolean;
}
```

**1b. Extend `ToolbarElements` (lines 11-16):**
```typescript
interface ToolbarElements {
  urlBar: HTMLInputElement;
  btnInspect: HTMLButtonElement;
  btnAddElement: HTMLButtonElement;
  btnAnnotate: HTMLButtonElement;
  banner: HTMLElement;
  annotateStrip: HTMLElement;
}
```

**1c. Extend `ToolbarAPI` (lines 18-24):**
```typescript
export interface ToolbarAPI {
  setUrl(url: string): void;
  setInspectActive(active: boolean): void;
  setAddElementActive(active: boolean): void;
  setAnnotateActive(active: boolean): void;
  setBackendState(active: string, available: Record<string, boolean>): void;
  onStateChange(cb: (state: ToolbarState) => void): void;
}
```

**1d. Add annotate button to the toolbar HTML** — add after `#btn-add-element` in the right group (after line 65):
```html
<button class="toolbar-btn" id="btn-annotate" title="Annotate">
  <span class="material-symbols-outlined">draw</span>
</button>
```

**1e. Update `state` initial value** in `createToolbar` (around line 36):
```typescript
const state: ToolbarState = {
  inspectActive: false,
  addElementActive: false,
  annotateActive: false,
};
```

- [ ] **Step 2: Add the annotation strip DOM after the instruction banner**

In `createToolbar`, after the banner creation block (after line 109), add:

```typescript
  // Add annotation strip after banner
  const annotateStrip = document.createElement('div');
  annotateStrip.className = 'annotation-strip';
  annotateStrip.id = 'annotation-strip';
  annotateStrip.innerHTML = getAnnotationStripHtml();
  container.parentElement?.insertBefore(annotateStrip, banner.nextSibling);
```

**`getAnnotationStripHtml` function** — add this near the top of the file (after the imports):

```typescript
function getAnnotationStripHtml(): string {
  const colors = ['#e74c3c', '#f39c12', '#f9c74f', '#2ecc71', '#4a90d9', '#ffffff'];
  const swatches = colors.map(c =>
    `<span class="color-swatch" data-color="${c}" style="background:${c}" title="${c}"></span>`
  ).join('');

  return `
    <div class="annotation-strip-tools">
      <button class="annot-btn active" data-tool="pen" title="Freehand pen">
        <span class="material-symbols-outlined">edit</span>
      </button>
      <button class="annot-btn" data-tool="arrow" title="Arrow">
        <span class="material-symbols-outlined">arrow_forward</span>
      </button>
      <button class="annot-btn" data-tool="rect" title="Rectangle">
        <span class="material-symbols-outlined">rectangle</span>
      </button>
      <button class="annot-btn" data-tool="ellipse" title="Ellipse">
        <span class="material-symbols-outlined">circle</span>
      </button>
      <button class="annot-btn" data-tool="text" title="Text label">
        <span class="material-symbols-outlined">title</span>
      </button>
      <button class="annot-btn" data-tool="callout" title="Numbered callout">
        <span class="material-symbols-outlined">looks_one</span>
      </button>
    </div>
    <div class="annotation-strip-divider"></div>
    <div class="annotation-strip-colors">
      ${swatches}
    </div>
    <div class="annotation-strip-divider"></div>
    <div class="annotation-strip-actions">
      <button class="annot-btn" id="annot-undo" title="Undo">
        <span class="material-symbols-outlined">undo</span>
      </button>
      <button class="annot-btn" id="annot-clear" title="Clear all">
        <span class="material-symbols-outlined">delete_sweep</span>
      </button>
    </div>
    <div class="annotation-strip-divider"></div>
    <input class="annot-prompt" id="annot-prompt" type="text"
      placeholder="Describe what you want… (optional)" spellcheck="false" />
    <button class="annot-btn annot-send" id="annot-send" title="Send to Chat">
      <span class="material-symbols-outlined">send</span>
      Send
    </button>
    <button class="annot-btn annot-dismiss" id="annot-dismiss" title="Exit annotation mode">
      <span class="material-symbols-outlined">close</span>
    </button>
  `;
}
```

- [ ] **Step 3: Get references to new elements and wire up the annotate button**

After the existing `elements` object declaration (around line 150), add:

```typescript
  const btnAnnotate = container.querySelector('#btn-annotate') as HTMLButtonElement;
  const annotateStripEl = document.getElementById('annotation-strip') as HTMLElement;
```

Update the `elements` object to:
```typescript
  const elements: ToolbarElements = { urlBar, btnInspect, btnAddElement, btnAnnotate, banner, annotateStrip: annotateStripEl };
```

Add annotate button click handler (after the `btnAddElement` handler):

```typescript
  btnAnnotate.addEventListener('click', () => {
    state.annotateActive = !state.annotateActive;
    if (state.annotateActive) {
      state.inspectActive = false;
      state.addElementActive = false;
    }
    postMessage(createToolbarDiagnostic(`Annotate toggled ${state.annotateActive ? 'on' : 'off'}`));
    updateModeUI();
    stateChangeCallback?.({ ...state });
  });
```

Also extend the existing `btnInspect` and `btnAddElement` handlers to clear `annotateActive`:
- In `btnInspect` handler: add `state.annotateActive = false;` inside the `if (state.inspectActive)` block.
- In `btnAddElement` handler: add `state.annotateActive = false;` inside the `if (state.addElementActive)` block.

- [ ] **Step 4: Wire annotation strip controls to callbacks**

Add `onAnnotateAction` callbacks to the `createToolbar` signature:

```typescript
export function createToolbar(
  container: HTMLElement,
  postMessage: PostMessage,
  callbacks?: {
    onLogsRequest?: () => void;
    onScreenshotRequest?: () => void;
    onBackendRequest?: () => void;
    onBackendSelect?: (backend: string) => void;
    onAnnotateTool?: (tool: string) => void;
    onAnnotateColor?: (color: string) => void;
    onAnnotateUndo?: () => void;
    onAnnotateClear?: () => void;
    onAnnotateSend?: (prompt: string) => void;
    onAnnotateDismiss?: () => void;
  }
): ToolbarAPI {
```

Wire strip element events (add after the annotate button handler):

```typescript
  // ── Annotation strip controls ─────────────────────────
  annotateStripEl.querySelectorAll('.annot-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = (btn as HTMLElement).dataset.tool!;
      annotateStripEl.querySelectorAll('.annot-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      callbacks?.onAnnotateTool?.(tool);
    });
  });

  annotateStripEl.querySelectorAll('.color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      annotateStripEl.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      callbacks?.onAnnotateColor?.((swatch as HTMLElement).dataset.color!);
    });
  });

  annotateStripEl.querySelector('#annot-undo')!.addEventListener('click', () => {
    callbacks?.onAnnotateUndo?.();
  });

  annotateStripEl.querySelector('#annot-clear')!.addEventListener('click', () => {
    callbacks?.onAnnotateClear?.();
  });

  annotateStripEl.querySelector('#annot-send')!.addEventListener('click', () => {
    const prompt = (annotateStripEl.querySelector('#annot-prompt') as HTMLInputElement).value;
    callbacks?.onAnnotateSend?.(prompt);
  });

  annotateStripEl.querySelector('#annot-dismiss')!.addEventListener('click', () => {
    callbacks?.onAnnotateDismiss?.();
  });
```

- [ ] **Step 5: Update `updateModeUI` to handle `annotateActive`**

In `updateModeUI` (around line 277), extend it:

```typescript
  function updateModeUI() {
    elements.btnInspect.classList.toggle('active', state.inspectActive);
    elements.btnAddElement.classList.toggle('active', state.addElementActive);
    elements.btnAnnotate.classList.toggle('active', state.annotateActive);
    elements.banner.innerHTML = getInstructionBannerHtml(state);
    elements.banner.classList.toggle('visible', state.inspectActive || state.addElementActive);
    elements.annotateStrip.classList.toggle('visible', state.annotateActive);
    container.classList.toggle('mode-active', state.inspectActive || state.addElementActive || state.annotateActive);
  }
```

- [ ] **Step 6: Update the ESC handler to clear `annotateActive`**

In the `keydown` handler (around line 266):

```typescript
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      state.inspectActive = false;
      state.addElementActive = false;
      state.annotateActive = false;
      postMessage(createToolbarDiagnostic('Escape pressed - modes cleared'));
      updateModeUI();
      stateChangeCallback?.({ ...state });
    }
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      if (state.annotateActive) callbacks?.onAnnotateUndo?.();
    }
  });
```

- [ ] **Step 7: Add `setAnnotateActive` to the public API return object**

In the `return` block:

```typescript
    setAnnotateActive(active: boolean) {
      state.annotateActive = active;
      if (active) {
        state.inspectActive = false;
        state.addElementActive = false;
      }
      updateModeUI();
    },
```

- [ ] **Step 8: Run type-checker and all tests**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: zero type errors, all existing tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/webview/toolbar.ts src/webview/toolbarDiagnostics.ts
git commit -m "feat(toolbar): add annotation mode button and annotation strip UI"
```

---

## Task 5: Wire `AnnotationOverlay` in `main.ts`

**Files:**
- Modify: `src/webview/main.ts`

- [ ] **Step 1: Import `createAnnotationOverlay` and instantiate it**

Add import at top of `src/webview/main.ts` (after existing imports):
```typescript
import { createAnnotationOverlay } from './annotation-overlay';
```

After the `const overlay = createInspectOverlay(iframe, postMessage);` line, add:
```typescript
const annotationOverlay = createAnnotationOverlay(iframe);
```

- [ ] **Step 2: Update the `createToolbar` call to pass annotation callbacks**

Update the toolbar call in `main.ts` to add annotation callbacks:

```typescript
const toolbar = createToolbar(toolbarContainer, postMessage, {
  onLogsRequest() {
    const entries: ConsoleEntry[] = consoleReceiver.getEntries();
    postMessage({ type: 'action:addLogs', payload: { logs: entries } });
  },
  onScreenshotRequest() {
    overlay.requestScreenshot().then((dataUrl) => {
      postMessage({ type: 'action:screenshot', payload: { dataUrl } });
    });
  },
  onBackendRequest() {
    postMessage({ type: 'backend:request', payload: {} });
  },
  onBackendSelect(backend: string) {
    postMessage({ type: 'backend:select', payload: { backend } });
  },
  onAnnotateTool(tool) {
    annotationOverlay.setTool(tool as Parameters<typeof annotationOverlay.setTool>[0]);
  },
  onAnnotateColor(color) {
    annotationOverlay.setColor(color);
  },
  onAnnotateUndo() {
    annotationOverlay.undo();
  },
  onAnnotateClear() {
    if (annotationOverlay.hasShapes()) {
      annotationOverlay.clear();
    }
  },
  async onAnnotateSend(prompt) {
    const screenshotDataUrl = await overlay.requestScreenshot();
    const imageDataUrl = await annotationOverlay.composite(screenshotDataUrl);
    postMessage({ type: 'annotate:sendToChat', payload: { imageDataUrl, prompt } });
    annotationOverlay.clear();
    toolbar.setAnnotateActive(false);
  },
  onAnnotateDismiss() {
    if (annotationOverlay.hasShapes()) {
      // Simple confirm via window.confirm (available in webview)
      if (!window.confirm('Exit annotation mode? Your drawings will be lost.')) return;
    }
    annotationOverlay.clear();
    toolbar.setAnnotateActive(false);
  },
});
```

- [ ] **Step 3: Update the `toolbar.onStateChange` callback to handle annotate mode**

Replace the existing `toolbar.onStateChange` block:

```typescript
toolbar.onStateChange((state) => {
  if (state.inspectActive) {
    overlay.setMode('inspect');
    annotationOverlay.setActive(false);
  } else if (state.addElementActive) {
    overlay.setMode('addElement');
    annotationOverlay.setActive(false);
  } else if (state.annotateActive) {
    overlay.setMode('off');
    annotationOverlay.setActive(true);
  } else {
    overlay.setMode('off');
    annotationOverlay.setActive(false);
  }
});
```

- [ ] **Step 4: Run type-checker and full test suite**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: zero type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/webview/main.ts
git commit -m "feat(webview): wire annotation overlay into toolbar state"
```

---

## Task 6: Handle `annotate:sendToChat` in the extension host

**Files:**
- Modify: `src/context/ContextExtractor.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Add `fromAnnotation` to `ContextExtractor`**

In `src/context/ContextExtractor.ts`, add a new method after `fromScreenshot`:

```typescript
  fromAnnotation(
    imageDataUrl: string,
    prompt: string,
    url: string
  ): ContextBundle {
    return {
      url,
      timestamp: Date.now(),
      screenshot: { dataUrl: imageDataUrl, width: 0, height: 0 },
      ...(prompt ? { annotation: prompt } : {}),
    };
  }
```

(`ContextBundle.annotation` was already added in Task 1.)

- [ ] **Step 2: Handle the message in `extension.ts` — `deliverContext`**

In `src/extension.ts`, in the `deliverContext` switch statement, add a new case before `default`:

```typescript
    case 'annotate:sendToChat': {
      const bundle = contextExtractor.fromAnnotation(
        message.payload.imageDataUrl,
        message.payload.prompt,
        url
      );
      result = await adapter.deliver(bundle);
      break;
    }
```

- [ ] **Step 3: Add `annotate:sendToChat` to the message dispatch switch**

In `extension.ts`, in the `panelManager.onMessage` switch, add alongside the existing action cases:

```typescript
      case 'annotate:sendToChat':
        deliverContext(message, currentUrl).catch((err) => {
          console.error('Web Lens: annotation delivery error', err);
          webLensLogger.error('Annotation delivery error', err);
        });
        break;
```

- [ ] **Step 4: Run type-checker and full test suite**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: zero type errors, all 97+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/context/ContextExtractor.ts src/extension.ts src/types.ts
git commit -m "feat(extension): handle annotate:sendToChat message and deliver to chat backend"
```

---

## Task 7: Add CSS for the annotation strip and SVG overlay

**Files:**
- Modify: `webview/` CSS (find the main stylesheet)

- [ ] **Step 1: Find the webview stylesheet**

```bash
find webview -name "*.css"
```

- [ ] **Step 2: Add annotation strip styles**

In the webview stylesheet, append these rules:

```css
/* ── Annotation strip ─────────────────────────────── */
.annotation-strip {
  display: none;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-panel-border);
  flex-wrap: wrap;
  min-height: 34px;
}

.annotation-strip.visible {
  display: flex;
}

.annotation-strip-tools,
.annotation-strip-actions {
  display: flex;
  gap: 2px;
}

.annotation-strip-divider {
  width: 1px;
  height: 18px;
  background: var(--vscode-panel-border);
  margin: 0 4px;
}

.annotation-strip-colors {
  display: flex;
  gap: 4px;
  align-items: center;
}

.color-swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  display: inline-block;
  flex-shrink: 0;
}

.color-swatch.active,
.color-swatch:hover {
  border-color: var(--vscode-focusBorder);
}

.annot-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--vscode-foreground);
  cursor: pointer;
  font-size: 11px;
}

.annot-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.annot-btn.active {
  background: var(--vscode-toolbar-activeBackground);
  border-color: var(--vscode-focusBorder);
}

.annot-btn .material-symbols-outlined {
  font-size: 16px;
}

.annot-send {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font-weight: 600;
  padding: 2px 10px;
}

.annot-send:hover {
  background: var(--vscode-button-hoverBackground);
}

.annot-prompt {
  flex: 1;
  min-width: 120px;
  max-width: 280px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 11px;
  outline: none;
}

.annot-prompt:focus {
  border-color: var(--vscode-focusBorder);
}
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add webview/
git commit -m "feat(styles): add annotation strip and overlay CSS"
```

---

## Task 8: Extend toolbar tests for annotate mode

**Files:**
- Modify: existing toolbar test file (check `src/webview/` for `toolbar.test.ts` or similar)

- [ ] **Step 1: Find the toolbar test file**

```bash
ls src/webview/*.test.ts
```

- [ ] **Step 2: Add annotate mode tests**

In the toolbar test file, add a new `describe` block:

```typescript
describe('annotate mode', () => {
  it('annotate button toggles annotateActive in state', () => {
    let lastState: { annotateActive?: boolean } = {};
    toolbar.onStateChange((s) => { lastState = s; });
    container.querySelector<HTMLButtonElement>('#btn-annotate')!.click();
    expect(lastState.annotateActive).toBe(true);
  });

  it('entering annotate mode deactivates inspect and addElement', () => {
    let lastState: { inspectActive?: boolean; addElementActive?: boolean; annotateActive?: boolean } = {};
    toolbar.onStateChange((s) => { lastState = s; });
    container.querySelector<HTMLButtonElement>('#btn-inspect')!.click();
    container.querySelector<HTMLButtonElement>('#btn-annotate')!.click();
    expect(lastState.annotateActive).toBe(true);
    expect(lastState.inspectActive).toBe(false);
    expect(lastState.addElementActive).toBe(false);
  });

  it('annotation strip becomes visible when annotateActive', () => {
    container.querySelector<HTMLButtonElement>('#btn-annotate')!.click();
    const strip = document.getElementById('annotation-strip')!;
    expect(strip.classList.contains('visible')).toBe(true);
  });

  it('ESC exits annotation mode', () => {
    let lastState: { annotateActive?: boolean } = {};
    toolbar.onStateChange((s) => { lastState = s; });
    container.querySelector<HTMLButtonElement>('#btn-annotate')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(lastState.annotateActive).toBe(false);
  });
});
```

- [ ] **Step 3: Run toolbar tests**

```bash
npx vitest run src/webview/toolbar.test.ts
```

Expected: all pass.

- [ ] **Step 4: Run full suite**

```bash
npx vitest run
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/webview/toolbar.test.ts
git commit -m "test(toolbar): add annotation mode toggle and strip visibility tests"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run full test suite one last time**

```bash
npx vitest run
```

Expected: all tests pass (97 existing + new annotation tests).

- [ ] **Step 2: Run TypeScript type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Run build to confirm no bundler errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 4: Final commit if any loose files**

```bash
git status
```

If clean: nothing to do. If any files unstaged, add and commit with `chore: clean up`.

---

## Summary of commits on `feature/annotation-mode`

1. `feat(types): add annotate:sendToChat message type`
2. `feat(webview): add annotation overlay SVG engine with TDD`
3. `feat(toolbar): extend ToolbarStateSnapshot with annotateActive`
4. `feat(toolbar): add annotation mode button and annotation strip UI`
5. `feat(webview): wire annotation overlay into toolbar state`
6. `feat(extension): handle annotate:sendToChat message and deliver to chat backend`
7. `feat(styles): add annotation strip and overlay CSS`
8. `test(toolbar): add annotation mode toggle and strip visibility tests`
