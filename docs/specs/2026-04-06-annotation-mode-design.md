# Annotation Mode — Design Spec

**Date:** 2026-04-06  
**Status:** Approved  
**Branch:** `feature/annotation-mode`

---

## Overview

Add an **Annotation Mode** to the browser panel toolbar — a transparent SVG canvas that floats over the live iframe, letting users draw shapes, add text labels, and place numbered callouts directly on top of the running app. When done, the annotated view is composited with a screenshot of the app and sent to the active AI chat backend as context.

**Primary use case:** Communicate design intent to the AI — mark where a button should go, highlight a broken layout, number the steps of a flow — without leaving the browser panel.

---

## Goals

- Freehand pen, arrow, rectangle, circle, text, and numbered callout tools
- Rich color palette (6 presets)
- Undo / redo per annotation element
- Canvas over live app (app stays interactive when annotation mode is off)
- Send = composite screenshot of iframe + SVG annotations + optional text prompt → chat
- ESC or dismiss exits the mode and clears the canvas (with confirmation if shapes exist)

## Non-goals

- Persisting annotations across navigation or sessions
- Selecting or moving individual annotations after placement
- Exporting annotations as a standalone file (only chat output for now)
- Injecting anything into the target page iframe

---

## Architecture

### Layer overview

```
┌─────────────────────────────────────┐
│  VS Code Webview                    │
│  ┌───────────────────────────────┐  │
│  │  Toolbar (toolbar.ts)         │  │
│  ├───────────────────────────────┤  │
│  │  Annotation strip (toolbar.ts)│  │  ← slides in below toolbar when active
│  ├───────────────────────────────┤  │
│  │  SVG overlay                  │  │  ← annotation-overlay.ts, z-index over iframe
│  │  ┌───────────────────────┐    │  │
│  │  │  #browser-iframe      │    │  │  ← live app, pointer-events:none when annotating
│  │  └───────────────────────┘    │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### New files

| File | Purpose |
|------|---------|
| `src/webview/annotation-overlay.ts` | SVG canvas + tool engine; public API consumed by `main.ts` |
| `src/webview/annotation-overlay.test.ts` | Unit tests for overlay module |

### Modified files

| File | Change |
|------|--------|
| `src/webview/toolbar.ts` | Add `annotateActive` to `ToolbarState`; add annotate button; render annotation strip |
| `src/webview/main.ts` | Wire `AnnotationOverlay` into toolbar state callbacks |
| `src/types.ts` | Add `annotate:sendToChat` WebviewMessage type |
| Extension host adapter(s) | Handle `annotate:sendToChat` — attach composite image to chat |

---

## Component: `annotation-overlay.ts`

### Responsibilities

- Create and manage the `<svg>` element positioned over `#browser-iframe`
- Route mouse events to the active tool
- Build and append SVG elements for each drawn shape
- Maintain an undo stack (ordered array of top-level SVG child elements)
- Export the SVG as a composited PNG (screenshot + SVG layer)

### Public API

```typescript
export interface AnnotationOverlay {
  setActive(active: boolean): void;        // show/hide, enable/disable pointer capture
  setTool(tool: AnnotationTool): void;
  setColor(color: string): void;
  undo(): void;
  redo(): void;
  clear(): boolean;                        // returns true if there were shapes (for confirm guard)
  hasShapes(): boolean;
  composite(screenshotDataUrl: string): Promise<string>;  // returns PNG dataUrl
  destroy(): void;
}

export type AnnotationTool =
  | 'pen'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'callout';
```

### Tool implementations

| Tool | SVG output | Interaction |
|------|-----------|-------------|
| `pen` | `<path stroke="color" fill="none">` | `mousedown` starts path (`M x y`), `mousemove` appends (`L x y`), `mouseup` finalises |
| `arrow` | `<line>` + `<marker>` arrowhead | `mousedown` = tail, `mouseup` = head; arrowhead marker defined once per color in `<defs>`; `clear()` also purges `<defs>` children |
| `rect` | `<rect stroke="color" fill="color/10">` | `mousedown` = first corner, live preview during drag, `mouseup` = final bounds |
| `ellipse` | `<ellipse stroke="color" fill="color/10">` | `mousedown` = center, radius from distance to `mouseup` |
| `text` | `<foreignObject>` editable during input, committed as `<text>` | Click to place, type to fill, click-away or Enter to commit |
| `callout` | `<circle fill="color">` + `<text fill="white">` | Click to place; counter auto-increments from 1, resets on `clear()` |

### Undo / redo

```
undoStack: SVGElement[]   ← top-level children added during this session
redoStack: SVGElement[]   ← elements removed by undo

undo()  → pop undoStack, remove from SVG, push to redoStack
redo()  → pop redoStack, append to SVG, push to undoStack
clear() → remove all, reset both stacks, reset callout counter
```

### Compositing

```
composite(screenshotDataUrl):
  1. Create offscreen <canvas> sized to iframe.getBoundingClientRect()
  2. Draw screenshotDataUrl onto canvas (drawImage from Image)
  3. Serialize SVG element to string via XMLSerializer
  4. Encode as data URI: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString)
     (Avoid Blob URL — can taint the canvas in VS Code webview CSP context)
  5. new Image() with src = data URI → await load → drawImage onto canvas
  6. canvas.toDataURL('image/png')
  7. Return PNG dataUrl
```

If `screenshotDataUrl` is empty (screenshot timeout), composite on a white background and log a warning.

---

## Component: Annotation Strip (in `toolbar.ts`)

Extends the existing `ToolbarState` and instruction-banner pattern.

### `ToolbarState` extension

```typescript
interface ToolbarState {
  inspectActive: boolean;
  addElementActive: boolean;
  annotateActive: boolean;   // new
}
```

Entering annotate mode deactivates inspect and addElement (and vice versa).

### Strip layout

```
┌──────────────────────────────────────────────────────────────────┐
│ ✏️  →  □  ○  T  🔢  │  ● ● ● ● ● ●  │  ↩ Undo  🗑 Clear  │  [prompt...]  [ Send ✓ ]  ✕ │
└──────────────────────────────────────────────────────────────────┘
```

- **Tool buttons** (left): pen, arrow, rect, ellipse, text, callout — active tool highlighted
- **Color swatches** (center-left): 6 presets (red `#e74c3c`, orange `#f39c12`, yellow `#f9c74f`, green `#2ecc71`, blue `#4a90d9`, white `#ffffff`). Click to set active color.
- **Undo / Clear** (center-right)
- **Prompt input** (right): placeholder "Describe what you want…", optional, empty by default
- **Send ✓** button: triggers send flow
- **✕** dismiss button: exits annotation mode (with confirm guard if shapes exist)

### Send flow

1. Read prompt text (may be empty)
2. Call `requestScreenshot()` from the existing inspect-overlay module
3. Call `overlay.composite(screenshotDataUrl)`
4. Post `{ type: 'annotate:sendToChat', payload: { imageDataUrl, prompt } }` to extension host
5. Call `overlay.clear()`
6. Set `annotateActive = false`, update UI

### Keyboard

| Key | Effect |
|-----|--------|
| `Escape` | Exit annotation mode (confirm if shapes exist) |
| `Ctrl+Z` | Undo last shape |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |

---

## Message Type

```typescript
// src/types.ts addition
{
  type: 'annotate:sendToChat';
  payload: {
    imageDataUrl: string;   // PNG data URL: composite of iframe screenshot + SVG annotations
    prompt: string;          // optional user text, may be empty string
  };
}
```

Extension host handling follows the same pattern as `addElement:captured` — attach the image to the active backend's chat input.

---

## Testing Strategy

### `annotation-overlay.test.ts` (new)

- Pen tool: `mousedown` → `mousemove` × 3 → `mouseup` creates one `<path>` element in SVG
- Arrow tool: creates `<line>` with `marker-end` attribute
- Rect tool: creates `<rect>` with correct x/y/width/height
- Callout tool: first click creates callout with text "1", second with "2"; `clear()` resets to "1"
- Color: setting color before drawing applies stroke to new element
- Undo: removes last element; redo re-appends it
- `hasShapes()` returns false on empty canvas, true after drawing
- `clear()` empties SVG and returns `true` if shapes existed, `false` if already empty
- Composite: offscreen canvas has correct dimensions; output is a non-empty PNG dataUrl

### `toolbar.test.ts` (extended)

- Annotate button toggles `annotateActive`
- Entering annotate mode sets `inspectActive = false`, `addElementActive = false`
- Annotation strip renders when `annotateActive = true`, hidden otherwise
- Send button posts `annotate:sendToChat` message
- ESC exits annotation mode

### Extension host

- `annotate:sendToChat` handler unit test: correct payload forwarded to active backend

---

## Open Questions

None — all design decisions resolved.
