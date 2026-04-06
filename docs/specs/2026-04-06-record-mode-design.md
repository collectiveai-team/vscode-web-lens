# Record Mode — Design Spec

**Date:** 2026-04-06  
**Status:** Approved  
**Branch:** brainstorming

---

## Overview

Record mode is a new mode in the Web Lens VS Code extension that captures user interactions inside the embedded browser panel and saves them as a structured JSON event log. The primary use case is building a corpus of "user interaction tests" that can later be converted into Playwright, Cypress, or other framework-specific test scripts.

---

## Goals

- Capture clicks, keyboard input, and navigation events as the user browses their app in the Web Lens panel.
- Save each session as a self-contained JSON file in the workspace.
- Offer optional capture of scroll, hover, and console events via an inline config UI — no buried settings.
- Integrate naturally into the existing mode state machine and toolbar without disrupting existing workflows.

## Non-Goals (v1)

- No automatic conversion to Playwright/Cypress test code (the JSON is the output; conversion is a future concern).
- No playback / replay of recorded sessions.
- No cloud sync or sharing of recordings.
- No per-element screenshot capture during recording.

---

## Architecture

### Mode State Machine Extension

The existing `Mode` type in `src/webview/inject.ts` is extended:

```typescript
type Mode = 'inspect' | 'addElement' | 'off' | 'record';
```

Record mode is mutually exclusive with `inspect` and `addElement` — enabling record clears any active mode, and enabling inspect/addElement while recording is not permitted (the toolbar enforces this).

### Data Flow

```
[Target Page — inject.ts]
  record mode active
    → addEventListener: click, input, pushState/replaceState/popstate
    → optional: scroll, mouseover, console (controlled by session config)
    → fires bc:recordEvent messages per event

[WebView — main.ts]
  forwards bc:recordEvent to extension host via postMessage
  (no buffering in WebView; thin relay only)

[Extension Host — RecordingSession.ts]
  buffers RecordedEvent[] in memory
  tracks session metadata (id, startedAt, startUrl, userAgent)
  on stop → serializes to JSON → writes to .weblens-recordings/<filename>
```

### New Files

| File | Purpose |
|---|---|
| `src/recording/RecordingSession.ts` | Owns event buffer, session metadata, file I/O. Created on recording start, disposed on stop or panel close. |
| `src/recording/selectorBuilder.ts` | Pure function: `buildSelector(el: Element) → { selector, selectorType }`. Stateless, no imports from VS Code API. |

### Modified Files

| File | Change |
|---|---|
| `src/webview/inject.ts` | Add `record` to `Mode` type; implement `attachRecord()` / `cleanupRecord()` with click, input, navigation listeners; call `selectorBuilder` logic (duplicated in browser context); fire `bc:recordEvent` |
| `src/webview/toolbar.ts` | Add record button to mode group; manage three states: idle / pre-recording config / recording active; extend `ToolbarState` and `ToolbarAPI` |
| `src/webview/main.ts` | Forward `bc:recordEvent` to extension host; handle `recording:started` / `recording:stopped` messages from extension host |
| `src/types.ts` | Add new message types (see below) |
| `src/extension.ts` | Register `webLens.record` command; create/destroy `RecordingSession`; route recording messages |
| `package.json` | Register `webLens.record` command contribution point |

---

## Message Types

New additions to `src/types.ts`:

```typescript
// WebView → Extension Host
{ type: 'recording:start'; payload: { captureConsole: boolean; captureScroll: boolean; captureHover: boolean } }
{ type: 'recording:stop' }
{ type: 'recording:event'; payload: RecordedEvent }

// Extension Host → WebView
{ type: 'recording:started' }
{ type: 'recording:stopped'; payload: { filePath: string } }

// inject → WebView (bc: internal channel)
{ type: 'bc:recordEvent'; payload: RecordedEvent }

// RecordedEvent union
type RecordedEvent =
  | { type: 'click';      timestamp: number; selector: string; selectorType: string; text: string; position: { x: number; y: number } }
  | { type: 'input';      timestamp: number; selector: string; selectorType: string; value: string }
  | { type: 'navigation'; timestamp: number; url: string; trigger: 'pushState' | 'replaceState' | 'popstate' | 'load' }
  | { type: 'scroll';     timestamp: number; x: number; y: number }
  | { type: 'hover';      timestamp: number; selector: string; selectorType: string }
  | { type: 'console';    timestamp: number; level: string; message: string }
```

---

## Event Schema (JSON output)

**File location:** `<workspace-root>/.weblens-recordings/`  
**Filename pattern:** `{ISO-timestamp}-{sanitized-hostname}.json`  
Example: `2026-04-06T10-00-00-localhost.json`

```json
{
  "version": "1.0",
  "session": {
    "id": "<uuid-v4>",
    "startedAt": "2026-04-06T10:00:00.000Z",
    "stoppedAt": "2026-04-06T10:05:30.000Z",
    "startUrl": "http://localhost:3000/",
    "userAgent": "Mozilla/5.0 ...",
    "capturedOptional": {
      "console": false,
      "scroll": false,
      "hover": false
    }
  },
  "events": [
    {
      "type": "navigation",
      "timestamp": 1744000000000,
      "url": "http://localhost:3000/about",
      "trigger": "pushState"
    },
    {
      "type": "click",
      "timestamp": 1744000001200,
      "selector": "[data-testid='submit-button']",
      "selectorType": "data-testid",
      "text": "Submit",
      "position": { "x": 320, "y": 480 }
    },
    {
      "type": "input",
      "timestamp": 1744000002800,
      "selector": "#email",
      "selectorType": "id",
      "value": "user@example.com"
    }
  ]
}
```

---

## Selector Strategy

The selector building logic lives **inline in `inject.ts`** (browser bundle context). Because inject.ts is compiled as a separate bundle from the extension host, it cannot import from `src/recording/`. The identical logic is also exported from `src/recording/selectorBuilder.ts` — its sole purpose is to make the logic unit-testable in Node.js without a real DOM (using jsdom stubs).

**Priority order:**
1. `data-testid` attribute → `[data-testid="value"]`
2. `id` attribute → `#id-value`
3. `aria-label` attribute → `[aria-label="value"]`
4. `name` attribute (for form elements) → `[name="value"]`
5. CSS selector path (ancestors + tag + classes, up to 4 levels) → fallback

The `selectorType` field records which strategy was used, so consumers can assess selector stability.

---

## Toolbar UI & States

The record button (`⏺`) is placed in the **mode group** of the toolbar, alongside Inspect and Add Element.

### State 1: Idle
- ⏺ button visible, normal styling
- Instruction banner hidden (no active mode)

### State 2: Pre-recording config
Triggered by clicking ⏺. The instruction banner area transforms into a config bar:

```
Also capture:  ☐ Console  ☐ Scroll  ☐ Hover    [⏺ Start]  [✕]
```

- ⏺ button stays highlighted (pending state)
- Checkbox state is persisted to VS Code workspace state (remembered across sessions)
- ✕ cancels and returns to idle

### State 3: Recording active
Triggered by clicking Start in the config bar, or by `webLens.record` command (which skips config and uses last-used settings; on first use with no saved state, all optional captures default to unchecked/off).

- ⏺ button becomes ⏹ with pulsing red background
- Banner becomes recording status bar:
  ```
  ● Recording… 14 events  |  0:23              [■ Stop & Save]
  ```
- Inspect and Add Element buttons are disabled while recording

### Stopping
Clicking "Stop & Save" (or running `webLens.record` again):
1. Extension host serializes and writes the JSON file
2. Extension host sends `recording:stopped` with `filePath`
3. WebView shows a brief toast: "Recording saved to .weblens-recordings/2026-04-06T..."
4. Toolbar returns to idle state

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| `<input type="password">` | Value captured as `"[redacted]"`. Selector still recorded. |
| Navigation during recording | inject.ts is re-injected by proxy on page load. Record mode re-attaches event listeners. Navigation event is recorded. Session continues uninterrupted. |
| Panel closed mid-recording | `RecordingSession.dispose()` is called, auto-saves whatever events were collected. |
| ESC key pressed | Does **not** stop recording. ESC only clears inspect/addElement modes. |
| Zero events recorded | A session with 0 events is still saved (the file records start/stop metadata). |
| Optional event checkboxes | Last-used state persisted in VS Code `workspaceState`. Defaults: all unchecked. |

---

## Testing

**New test files:**

| File | What is tested |
|---|---|
| `src/recording/selectorBuilder.test.ts` | Pure function: data-testid priority, id fallback, aria-label fallback, CSS path fallback, password redaction |
| `src/recording/RecordingSession.test.ts` | Event buffering, session metadata generation, JSON serialization, filename generation, auto-save on dispose |
| `src/webview/toolbar.test.ts` (extended) | Record button toggle, config bar state transitions, recording active state, ESC does NOT clear record mode, Inspect/AddElement disabled while recording |

**Patterns:** All tests follow the existing Vitest conventions: `vi.mock('vscode', ...)` for extension host code, `vi.stubGlobal('window', ...)` for webview code, no mocking for pure functions.

---

## VS Code Contributions

**New command:**

| ID | Title |
|---|---|
| `webLens.record` | Web Lens: Toggle Recording |

**No new configuration settings** — optional event preferences are stored in `workspaceState`, not user-facing settings, so they don't appear in the Settings UI.
