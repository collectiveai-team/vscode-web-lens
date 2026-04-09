## Annotation Editing Phase 1 Design

Date: 2026-04-09
Status: Proposed
Owner: Web Lens Debug

## Problem

Annotation mode has core UX gaps:

- Arrow start does not anchor exactly at cursor-down position, which feels imprecise.
- Text and callout tools do not produce reliable, useful output.
- There is no selection workflow to adjust existing geometry.
- There is no explicit delete control for manual figure removal.
- Undo is present, but redo is missing from the annotation strip.
- Users requested aligners, but this work should be split and phased.

## Scope

### In Scope (Phase 1)

- Fix arrow origin anchoring so `mousedown` equals arrow start.
- Make text and callout tools functional with inline editing.
- Add a `select` tool with multi-select support.
- Support selection move and resize.
- Support arrow endpoint editing when selected.
- Add a `Delete` button that deletes selected figures only.
- Add a `Redo` button next to Undo.
- Keep undo/redo consistent across all mutating actions.

### Out of Scope (Phase 2)

- Aligners (snap lines, align/distribute commands).
- Rotation support.
- Advanced group transform semantics beyond move and resize.

## User Decisions Captured

- Delivery strategy: phase 1 now, aligners deferred.
- Selection model: multi-select.
- Group transform: move and resize, no rotation.
- Text/callout input: inline editor on click with placeholder, Enter commit, Esc cancel.
- Resize behavior: bounding-box corner handles for selected group, proportional behavior with Shift aspect lock.
- Delete behavior: delete selected only, disabled when selection is empty.

## Design Approaches Considered

### Approach A (Selected): Extend current SVG renderer with explicit shape model

Add a light model layer in `src/webview/annotation-overlay.ts` while preserving SVG as the render output.

Pros:

- Low migration risk, because it evolves existing code paths.
- Supports richer interactions (selection, handles, history) without a full rewrite.
- Keeps integration points in `toolbar.ts` and `main.ts` small.

Cons:

- `annotation-overlay.ts` gets more complex and must be carefully partitioned.

### Approach B: Rebuild around a new scene-graph subsystem

Pros: cleaner long-term architecture.
Cons: highest risk and broadest churn for current needs.

### Approach C: Add interaction logic directly to raw SVG nodes

Pros: fastest first patch.
Cons: brittle for multi-select, resize semantics, and undo/redo correctness.

## Architecture

## 1) Model

Introduce internal entities per annotation:

- `id`: stable unique id.
- `type`: `pen | arrow | rect | ellipse | text | callout`.
- `geometry`: type-specific data (`x1/y1/x2/y2`, `x/y/w/h`, points, etc.).
- `style`: color, stroke width, fill settings, marker metadata.
- `meta`: z-order and optional callout index.

Maintain:

- `shapesById: Map<string, ShapeModel>`
- `shapeOrder: string[]`
- `selection: Set<string>`
- `undoStack` and `redoStack` of reversible operations/snapshots.

## 2) Rendering

SVG remains the rendering surface:

- Keep a `shapeId -> SVGElement` map for fast updates.
- Render only impacted shapes after each mutation.
- Keep separate UI-layer nodes for selection affordances:
  - group bounding box
  - resize handles
  - arrow endpoint handles

Selection affordances are transient and never committed as user shapes.

## 3) Input State Machine

Tool modes:

- Draw tools: `pen`, `arrow`, `rect`, `ellipse`, `text`, `callout`
- Edit tool: `select`

Pointer interaction states:

- idle
- drawingDraft
- movingSelection
- resizingSelection
- draggingArrowEndpoint
- editingInlineText

Only one state is active at a time. Mouse-up outside SVG finalizes active transforms via window listener.

## Interaction Spec

## Arrow Anchor Correctness

- On `mousedown` with arrow tool, persist start point immediately in model draft.
- Draw line from exact start point to current pointer on move.
- Commit on mouse-up.

This removes perceived offset between cursor origin and arrow start.

## Text and Callout

- Click opens inline input at pointer location with placeholder: `Type and press Enter`.
- Enter commits non-empty value.
- Esc cancels.
- Blur commits only when input is non-empty.

Callout creation keeps numbered markers; counter resets on full clear.

## Selection and Multi-Select

- Click shape selects it.
- `Shift+click` toggles shape membership in selection.
- Click empty canvas clears selection.

## Move

- Drag any selected shape to move whole selection by pointer delta.

## Resize

- Show one bounding box around current selection.
- Corner handles resize from opposite corner anchor.
- Resize applies to all selected shapes.
- Shift enforces aspect-ratio lock semantics during handle drag.

## Arrow Endpoint Editing

- When a single arrow is selected, show start/end endpoint handles.
- Dragging an endpoint updates only that endpoint.
- Endpoint drag takes precedence over group move while active.

## Delete

- Add `Delete` button in annotation strip.
- Button is disabled when selection is empty.
- Action removes selected shapes only.

No delete-last fallback in phase 1.

## Undo and Redo

Track and reverse all mutating actions:

- create shape
- move selection
- resize selection
- arrow endpoint edit
- delete selection
- clear all

Toolbar exposes both Undo and Redo controls.

## Integration Changes

## `src/webview/toolbar.ts`

- Add `select` to annotation tool list.
- Add `Delete` and `Redo` controls.
- Add callback hooks:
  - `onAnnotateRedo`
  - `onAnnotateDelete`

## `src/webview/main.ts`

- Wire new callbacks to overlay methods:
  - `annotationOverlay.redo()`
  - `annotationOverlay.deleteSelection()`
- Continue using existing send/dismiss flow.

## `src/webview/annotation-overlay.ts`

- Add shape model layer and selection state.
- Add APIs required by toolbar wiring and button state:
  - `deleteSelection(): boolean`
  - `canDeleteSelection(): boolean`
- Keep existing APIs (`undo`, `redo`, `clear`, `composite`, `hasShapes`).

## Error Handling and UX Safeguards

- No-op safely when actions are unavailable (`redo`, `delete`, empty selection).
- Enforce minimum dimensions during resize to avoid degenerate geometry.
- Keep pointer capture/state cleanup robust when mouse-up occurs outside SVG.
- Never send chat payloads on edit actions; send happens only via `Send` button.
- Preserve existing confirm-before-discard flow on dismiss.

## Testing Plan

## Unit: `src/webview/annotation-overlay.test.ts`

- Arrow starts exactly at `mousedown` coordinates.
- Text and callout inline editor commit/cancel behavior.
- Shift multi-select toggling.
- Move selected shapes by drag delta.
- Group resize with corner handles and Shift ratio lock.
- Arrow endpoint handle drag updates one endpoint only.
- Delete selection removes selected only and no-ops on empty.
- Undo/redo correctness for create, move, resize, endpoint edit, delete.

## Unit: `src/webview/toolbar.test.ts`

- `select`, `redo`, `delete` controls render.
- New callbacks fire with expected behavior.
- Delete button disabled/enabled state reflects selection state plumbing.

## Unit: `src/webview/main.test.ts`

- New toolbar callbacks route to overlay correctly.

## Verification Commands

- `npm run test:unit`
- `npm run typecheck`

## Rollout Notes

- Ship phase 1 without aligners.
- Capture aligners as a follow-up issue/spec once phase 1 interactions are stable.
