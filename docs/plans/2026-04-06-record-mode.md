# Record Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `record` mode to Web Lens that captures clicks, inputs, and navigation events inside the embedded browser panel and saves them as a structured JSON event log to `.weblens-recordings/` in the workspace.

**Architecture:** Extend inject.ts's `Mode` state machine with a `'record'` value. inject.ts captures DOM events and fires `bc:recordEvent` messages; main.ts relays them to the extension host; `RecordingSession` buffers events and writes a JSON file on stop. The toolbar grows a third state (idle → config bar → recording active).

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, jsdom (new dev dependency for toolbar tests), Node.js `fs` + `crypto` modules.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/recording/selectorBuilder.ts` | Pure function: element → best stable selector |
| Create | `src/recording/selectorBuilder.test.ts` | Unit tests for selector priority |
| Create | `src/recording/RecordingSession.ts` | Event buffer, session metadata, file I/O |
| Create | `src/recording/RecordingSession.test.ts` | Unit tests for buffering, serialization, file writing |
| Create | `src/webview/toolbar.test.ts` | DOM tests for record button states (jsdom) |
| Modify | `src/types.ts` | Add `RecordedEvent` type + recording message variants |
| Modify | `src/webview/inject.ts` | Add `'record'` to Mode, `attachRecord`/`cleanupRecord`, inline selector builder |
| Modify | `src/webview/toolbar.ts` | Record button + three-state banner (idle / config bar / status bar) |
| Modify | `src/webview/toolbarDiagnostics.ts` | Add `getRecordConfigBannerHtml` and `getRecordActiveBannerHtml` |
| Modify | `src/webview/inspect-overlay.ts` | Add `startRecord(opts)` to public API |
| Modify | `src/webview/main.ts` | Intercept `bc:recordEvent`, handle `recording:started/stopped/initOptions`, wire toolbar callbacks |
| Modify | `src/extension.ts` | Register `webLens.record` command, create/destroy `RecordingSession`, route messages, persist `workspaceState` |
| Modify | `package.json` | Add `webLens.record` command contribution |

---

## Task 1: Add Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `RecordedEvent` union and recording message types**

Open `src/types.ts`. Add after the existing imports, before `WebviewMessage`:

```typescript
// ── Recording types ────────────────────────────────────────

export type RecordedEvent =
  | { type: 'click';      timestamp: number; selector: string; selectorType: string; text: string; position: { x: number; y: number } }
  | { type: 'input';      timestamp: number; selector: string; selectorType: string; value: string }
  | { type: 'navigation'; timestamp: number; url: string; trigger: 'pushState' | 'replaceState' | 'popstate' | 'load' }
  | { type: 'scroll';     timestamp: number; x: number; y: number }
  | { type: 'hover';      timestamp: number; selector: string; selectorType: string }
  | { type: 'console';    timestamp: number; level: string; message: string };

export interface RecordOptions {
  captureConsole: boolean;
  captureScroll: boolean;
  captureHover: boolean;
}
```

- [ ] **Step 2: Extend `WebviewMessage`**

Add three new variants to the `WebviewMessage` union (after `backend:select`):

```typescript
  | { type: 'recording:start'; payload: RecordOptions }
  | { type: 'recording:stop' }
  | { type: 'recording:event'; payload: RecordedEvent }
```

- [ ] **Step 3: Extend `ExtensionMessage`**

Add four new variants to the `ExtensionMessage` union (after `theme:update`):

```typescript
  | { type: 'recording:started' }
  | { type: 'recording:stopped'; payload: { filePath: string } }
  | { type: 'recording:initOptions'; payload: RecordOptions }
  | { type: 'mode:record'; payload: { enabled: boolean } }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -10
```

Expected: build completes with no TypeScript errors (only the existing output files are written; no new runtime changes yet).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add RecordedEvent, RecordOptions, and recording message types"
```

---

## Task 2: selectorBuilder (TDD)

**Files:**
- Create: `src/recording/selectorBuilder.ts`
- Create: `src/recording/selectorBuilder.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/recording/selectorBuilder.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|selectorBuilder"
```

Expected: `FAIL src/recording/selectorBuilder.test.ts` — module not found.

- [ ] **Step 3: Implement `src/recording/selectorBuilder.ts`**

```typescript
/**
 * selectorBuilder — pure function: Element-like → stable CSS selector.
 *
 * Priority: data-testid > id > aria-label > name > css-path
 *
 * This logic is intentionally duplicated in inject.ts (browser bundle context)
 * as buildRecordSelector(). This file exists solely to make the logic unit-testable
 * in Node.js without a real DOM.
 */

export interface ElementLike {
  getAttribute(name: string): string | null;
  readonly id: string;
  readonly tagName: string;
  readonly classList: { readonly length: number; readonly [index: number]: string | undefined };
  readonly parentElement: ElementLike | null;
}

export interface SelectorResult {
  selector: string;
  selectorType: 'data-testid' | 'id' | 'aria-label' | 'name' | 'css-path';
}

export function buildSelector(el: ElementLike): SelectorResult {
  const testid = el.getAttribute('data-testid');
  if (testid) return { selector: `[data-testid="${testid}"]`, selectorType: 'data-testid' };

  if (el.id) return { selector: `#${el.id}`, selectorType: 'id' };

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return { selector: `[aria-label="${ariaLabel}"]`, selectorType: 'aria-label' };

  const name = el.getAttribute('name');
  if (name) return { selector: `[name="${name}"]`, selectorType: 'name' };

  return { selector: buildCssPath(el), selectorType: 'css-path' };
}

function buildCssPath(el: ElementLike, maxDepth = 4): string {
  const parts: string[] = [];
  let current: ElementLike | null = el;
  let depth = 0;

  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML' && depth < maxDepth) {
    let part = current.tagName.toLowerCase();
    const firstClass = current.classList[0];
    if (firstClass) part += `.${firstClass}`;
    parts.unshift(part);
    current = current.parentElement;
    depth++;
  }

  return parts.join(' > ') || el.tagName.toLowerCase();
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|selectorBuilder"
```

Expected: `PASS src/recording/selectorBuilder.test.ts` with all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/recording/selectorBuilder.ts src/recording/selectorBuilder.test.ts
git commit -m "feat(recording): add selectorBuilder pure function with tests"
```

---

## Task 3: RecordingSession (TDD)

**Files:**
- Create: `src/recording/RecordingSession.ts`
- Create: `src/recording/RecordingSession.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/recording/RecordingSession.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => {
  const mkdirSync = vi.fn();
  const writeFileSync = vi.fn();
  return { default: { mkdirSync, writeFileSync }, mkdirSync, writeFileSync };
});

import * as fs from 'fs';
import { RecordingSession } from './RecordingSession';
import type { RecordedEvent } from '../types';

const BASE_OPTS = {
  workspaceRoot: '/workspace',
  startUrl: 'http://localhost:3000',
  userAgent: 'test-ua/1.0',
  captureConsole: false,
  captureScroll: false,
  captureHover: false,
};

describe('RecordingSession', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('starts with zero events', () => {
    const session = new RecordingSession(BASE_OPTS);
    expect(session.eventCount).toBe(0);
  });

  it('addEvent increments eventCount', () => {
    const session = new RecordingSession(BASE_OPTS);
    const ev: RecordedEvent = {
      type: 'click',
      timestamp: 1000,
      selector: '[data-testid="btn"]',
      selectorType: 'data-testid',
      text: 'Go',
      position: { x: 10, y: 20 },
    };
    session.addEvent(ev);
    expect(session.eventCount).toBe(1);
  });

  it('save() creates the recordings directory', async () => {
    const session = new RecordingSession(BASE_OPTS);
    await session.save();
    expect(fs.mkdirSync).toHaveBeenCalledWith('/workspace/.weblens-recordings', { recursive: true });
  });

  it('save() writes a JSON file', async () => {
    const session = new RecordingSession(BASE_OPTS);
    const filePath = await session.save();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(filePath).toMatch(/\.weblens-recordings\/.+\.json$/);
  });

  it('saved JSON contains version and session metadata', async () => {
    const session = new RecordingSession(BASE_OPTS);
    await session.save();
    const [, rawJson] = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    const parsed = JSON.parse(rawJson);
    expect(parsed.version).toBe('1.0');
    expect(parsed.session.startUrl).toBe('http://localhost:3000');
    expect(parsed.session.userAgent).toBe('test-ua/1.0');
    expect(parsed.session.id).toBeTruthy();
    expect(parsed.session.startedAt).toBeTruthy();
    expect(parsed.session.stoppedAt).toBeTruthy();
  });

  it('saved JSON includes all buffered events', async () => {
    const session = new RecordingSession(BASE_OPTS);
    session.addEvent({ type: 'navigation', timestamp: 1, url: 'http://localhost:3000/about', trigger: 'pushState' });
    session.addEvent({ type: 'click', timestamp: 2, selector: '#btn', selectorType: 'id', text: 'OK', position: { x: 0, y: 0 } });
    await session.save();
    const [, rawJson] = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    const parsed = JSON.parse(rawJson);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0].type).toBe('navigation');
    expect(parsed.events[1].type).toBe('click');
  });

  it('capturedOptional flags appear in session metadata', async () => {
    const session = new RecordingSession({ ...BASE_OPTS, captureConsole: true });
    await session.save();
    const [, rawJson] = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    const parsed = JSON.parse(rawJson);
    expect(parsed.session.capturedOptional).toEqual({ console: true, scroll: false, hover: false });
  });

  it('save() is idempotent — second call is a no-op', async () => {
    const session = new RecordingSession(BASE_OPTS);
    await session.save();
    await session.save();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('dispose() auto-saves when not yet saved', async () => {
    const session = new RecordingSession(BASE_OPTS);
    session.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('dispose() after save() does not double-save', async () => {
    const session = new RecordingSession(BASE_OPTS);
    await session.save();
    session.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('filename contains the hostname from startUrl', async () => {
    const session = new RecordingSession({ ...BASE_OPTS, startUrl: 'http://my-app.local:3000/login' });
    const filePath = await session.save();
    expect(filePath).toContain('my-app.local');
  });

  it('filename contains a timestamp prefix', async () => {
    const session = new RecordingSession(BASE_OPTS);
    const filePath = await session.save();
    // Should start with a date-like string e.g. 2026-04-06T...
    expect(path.basename(filePath)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

Add the missing `path` import at the top:

```typescript
import * as path from 'path';
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|RecordingSession"
```

Expected: `FAIL src/recording/RecordingSession.test.ts` — module not found.

- [ ] **Step 3: Implement `src/recording/RecordingSession.ts`**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { RecordedEvent, RecordOptions } from '../types';

export interface RecordingSessionOptions extends RecordOptions {
  workspaceRoot: string;
  startUrl: string;
  userAgent: string;
}

export class RecordingSession {
  private readonly events: RecordedEvent[] = [];
  private readonly startedAt: Date;
  private readonly id: string;
  private readonly options: RecordingSessionOptions;
  private saved = false;

  constructor(options: RecordingSessionOptions) {
    this.options = options;
    this.startedAt = new Date();
    this.id = randomUUID();
  }

  addEvent(event: RecordedEvent): void {
    this.events.push(event);
  }

  get eventCount(): number {
    return this.events.length;
  }

  async save(): Promise<string> {
    if (this.saved) return '';
    this.saved = true;

    const stoppedAt = new Date();
    const recordingsDir = path.join(this.options.workspaceRoot, '.weblens-recordings');
    fs.mkdirSync(recordingsDir, { recursive: true });

    let hostname = 'unknown';
    try {
      hostname = new URL(this.options.startUrl).hostname;
    } catch {
      // leave 'unknown'
    }

    const timestamp = this.startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sanitized = hostname.replace(/[^a-zA-Z0-9.-]/g, '-');
    const filePath = path.join(recordingsDir, `${timestamp}-${sanitized}.json`);

    const output = {
      version: '1.0',
      session: {
        id: this.id,
        startedAt: this.startedAt.toISOString(),
        stoppedAt: stoppedAt.toISOString(),
        startUrl: this.options.startUrl,
        userAgent: this.options.userAgent,
        capturedOptional: {
          console: this.options.captureConsole,
          scroll: this.options.captureScroll,
          hover: this.options.captureHover,
        },
      },
      events: this.events,
    };

    fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');
    return filePath;
  }

  dispose(): void {
    if (!this.saved) {
      void this.save();
    }
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|RecordingSession"
```

Expected: `PASS src/recording/RecordingSession.test.ts` with all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/recording/RecordingSession.ts src/recording/RecordingSession.test.ts
git commit -m "feat(recording): add RecordingSession with event buffer and file I/O"
```

---

## Task 4: inject.ts — Add Record Mode

**Files:**
- Modify: `src/webview/inject.ts`

- [ ] **Step 1: Extend the Mode type**

In `src/webview/inject.ts`, find the line:

```typescript
type Mode = 'inspect' | 'addElement' | 'off';
```

Replace it with:

```typescript
type Mode = 'inspect' | 'addElement' | 'off' | 'record';
```

- [ ] **Step 2: Add record state variables**

After the existing state block (after `let selectedElement: HTMLElement | null = null;`), add:

```typescript
let recordOpts: { captureConsole: boolean; captureScroll: boolean; captureHover: boolean } = {
  captureConsole: false,
  captureScroll: false,
  captureHover: false,
};
```

- [ ] **Step 3: Modify `setMode` to handle record cleanup**

Replace the existing `setMode` function:

```typescript
function setMode(mode: Mode) {
  if (currentMode === 'record') {
    cleanupRecord();
  }
  currentMode = mode;
  selectedElement = null;

  cleanup(); // removes inspect/addElement listeners (safe to call when they're not active)

  if (mode !== 'off' && mode !== 'record') {
    attach();
  }
}
```

- [ ] **Step 4: Add `bc:setRecord` to the message listener**

In the `window.addEventListener('message', ...)` switch statement, add a new case after `bc:setMode`:

```typescript
    case 'bc:setRecord': {
      const opts = data.opts as { captureConsole: boolean; captureScroll: boolean; captureHover: boolean };
      // Clean up whatever was active
      if (currentMode === 'record') {
        cleanupRecord();
      } else {
        cleanup();
      }
      currentMode = 'record';
      selectedElement = null;
      recordOpts = opts;
      attachRecord();
      break;
    }
```

- [ ] **Step 5: Add `buildRecordSelector` inline helper**

Add this function in the helpers section (before `postToParent`):

```typescript
function buildRecordSelector(el: HTMLElement): { selector: string; selectorType: string } {
  const testid = el.getAttribute('data-testid');
  if (testid) return { selector: `[data-testid="${testid}"]`, selectorType: 'data-testid' };
  if (el.id) return { selector: `#${el.id}`, selectorType: 'id' };
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return { selector: `[aria-label="${ariaLabel}"]`, selectorType: 'aria-label' };
  const name = el.getAttribute('name');
  if (name) return { selector: `[name="${name}"]`, selectorType: 'name' };
  const parts: string[] = [];
  let current: HTMLElement | null = el;
  let depth = 0;
  while (current && current.tagName !== 'BODY' && current.tagName !== 'HTML' && depth < 4) {
    let part = current.tagName.toLowerCase();
    if (current.classList[0]) part += `.${current.classList[0]}`;
    parts.unshift(part);
    current = current.parentElement;
    depth++;
  }
  return { selector: parts.join(' > ') || el.tagName.toLowerCase(), selectorType: 'css-path' };
}
```

- [ ] **Step 6: Add `attachRecord` and `cleanupRecord`**

Add these functions after the existing `cleanup` function:

```typescript
function attachRecord() {
  document.addEventListener('click', onRecordClick, true);
  document.addEventListener('change', onRecordChange, true);
  if (recordOpts.captureScroll) {
    document.addEventListener('scroll', onRecordScroll, true);
  }
  if (recordOpts.captureHover) {
    document.addEventListener('mouseover', onRecordHover, true);
  }
}

function cleanupRecord() {
  document.removeEventListener('click', onRecordClick, true);
  document.removeEventListener('change', onRecordChange, true);
  document.removeEventListener('scroll', onRecordScroll, true);
  document.removeEventListener('mouseover', onRecordHover, true);
}

function onRecordClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const { selector, selectorType } = buildRecordSelector(target);
  postToParent({
    type: 'bc:recordEvent',
    payload: {
      type: 'click',
      timestamp: Date.now(),
      selector,
      selectorType,
      text: (target.textContent || '').trim().slice(0, 200),
      position: { x: Math.round(e.clientX), y: Math.round(e.clientY) },
    },
  });
}

function onRecordChange(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target || !('value' in target)) return;
  const { selector, selectorType } = buildRecordSelector(target as HTMLElement);
  const value = (target as HTMLInputElement).type === 'password' ? '[redacted]' : (target as HTMLInputElement).value;
  postToParent({
    type: 'bc:recordEvent',
    payload: { type: 'input', timestamp: Date.now(), selector, selectorType, value },
  });
}

function onRecordScroll(_e: Event) {
  postToParent({
    type: 'bc:recordEvent',
    payload: { type: 'scroll', timestamp: Date.now(), x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
  });
}

function onRecordHover(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const { selector, selectorType } = buildRecordSelector(target);
  postToParent({
    type: 'bc:recordEvent',
    payload: { type: 'hover', timestamp: Date.now(), selector, selectorType },
  });
}
```

- [ ] **Step 7: Hook navigation detection into record mode**

In the existing `(function detectNavigation() { ... })()` block, add record event firing to each handler. For `history.pushState`:

```typescript
  history.pushState = function (state: any, title: string, url?: string | URL | null) {
    const result = origPushState(state, title, url);
    postToParent({ type: 'bc:navigated', payload: { url: window.location.href } });
    if (currentMode === 'record') {
      postToParent({ type: 'bc:recordEvent', payload: { type: 'navigation', timestamp: Date.now(), url: window.location.href, trigger: 'pushState' } });
    }
    return result;
  };
```

Apply the same pattern to `replaceState` (trigger: `'replaceState'`) and the `popstate` listener (trigger: `'popstate'`).

- [ ] **Step 8: Update ESC handler to skip record mode**

Find the `onKeyDown` function:

```typescript
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    setMode('off');
    postToParent({ type: 'bc:modeExited' });
  }
}
```

Replace with:

```typescript
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && currentMode !== 'record') {
    setMode('off');
    postToParent({ type: 'bc:modeExited' });
  }
}
```

- [ ] **Step 9: Build and verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -10
```

Expected: no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add src/webview/inject.ts
git commit -m "feat(inject): add record mode with click, input, navigation capture and inline selector builder"
```

---

## Task 5: toolbar.ts Three-State UI + Tests

**Files:**
- Create: `src/webview/toolbar.test.ts`
- Modify: `src/webview/toolbarDiagnostics.ts`
- Modify: `src/webview/toolbar.ts`

- [ ] **Step 1: Install jsdom dev dependency**

```bash
npm install --save-dev jsdom @types/jsdom
```

Verify it's added to `package.json` devDependencies.

- [ ] **Step 2: Add banner HTML helpers to `toolbarDiagnostics.ts`**

Open `src/webview/toolbarDiagnostics.ts`. Add at the end of the file:

```typescript
export interface RecordOptions {
  captureConsole: boolean;
  captureScroll: boolean;
  captureHover: boolean;
}

export function getRecordConfigBannerHtml(opts: RecordOptions): string {
  const checked = (val: boolean) => (val ? ' checked' : '');
  return `
    <span class="record-config-label">Also capture:</span>
    <label class="record-config-check">
      <input type="checkbox" data-record-opt="captureConsole"${checked(opts.captureConsole)} />
      Console
    </label>
    <label class="record-config-check">
      <input type="checkbox" data-record-opt="captureScroll"${checked(opts.captureScroll)} />
      Scroll
    </label>
    <label class="record-config-check">
      <input type="checkbox" data-record-opt="captureHover"${checked(opts.captureHover)} />
      Hover
    </label>
    <button class="record-start-btn" data-record-start>&#9210; Start</button>
    <button class="record-cancel-btn" data-record-cancel>&#x2715;</button>
  `.trim();
}

export function getRecordActiveBannerHtml(eventCount: number, elapsedSeconds: number): string {
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = String(elapsedSeconds % 60).padStart(2, '0');
  return `
    <span class="record-dot"></span>
    <span class="record-status-text">Recording&hellip; ${eventCount} event${eventCount !== 1 ? 's' : ''} &nbsp;|&nbsp; ${mins}:${secs}</span>
    <button class="record-stop-btn" data-record-stop>&#9632; Stop &amp; Save</button>
  `.trim();
}
```

Also update the existing `getInstructionBannerHtml` signature — it currently takes `{ inspectActive: boolean; addElementActive: boolean }`. No change needed; the new functions are separate.

- [ ] **Step 3: Write failing toolbar tests**

Create `src/webview/toolbar.test.ts`:

```typescript
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbar } from './toolbar';

function setup(callbacks?: Parameters<typeof createToolbar>[2]) {
  const wrapper = document.createElement('div');
  const container = document.createElement('div');
  wrapper.appendChild(container);
  document.body.appendChild(wrapper);
  const postMessage = vi.fn();
  const toolbar = createToolbar(container, postMessage, callbacks);
  return { toolbar, container, wrapper, postMessage };
}

describe('toolbar — record mode', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders a record button in the toolbar', () => {
    const { container } = setup();
    expect(container.querySelector('#btn-record')).not.toBeNull();
  });

  it('clicking record button shows the config bar banner', () => {
    const { container } = setup();
    (container.querySelector('#btn-record') as HTMLButtonElement).click();
    const banner = document.getElementById('instruction-banner');
    expect(banner?.classList.contains('visible')).toBe(true);
    expect(banner?.innerHTML).toContain('data-record-start');
  });

  it('clicking cancel in config bar hides the banner', () => {
    const { container } = setup();
    (container.querySelector('#btn-record') as HTMLButtonElement).click();
    const banner = document.getElementById('instruction-banner')!;
    (banner.querySelector('[data-record-cancel]') as HTMLButtonElement).click();
    expect(banner.classList.contains('visible')).toBe(false);
  });

  it('clicking Start fires onRecordStart with selected options', () => {
    const onRecordStart = vi.fn();
    const { container } = setup({ onRecordStart });
    (container.querySelector('#btn-record') as HTMLButtonElement).click();
    const banner = document.getElementById('instruction-banner')!;
    (banner.querySelector('[data-record-start]') as HTMLButtonElement).click();
    expect(onRecordStart).toHaveBeenCalledTimes(1);
    expect(onRecordStart).toHaveBeenCalledWith(expect.objectContaining({
      captureConsole: expect.any(Boolean),
      captureScroll: expect.any(Boolean),
      captureHover: expect.any(Boolean),
    }));
  });

  it('setRecordActive(true) shows the recording status bar and disables inspect/addElement', () => {
    const { container, toolbar } = setup();
    toolbar.setRecordActive(true);
    const banner = document.getElementById('instruction-banner')!;
    expect(banner.classList.contains('visible')).toBe(true);
    expect(banner.innerHTML).toContain('data-record-stop');
    expect((container.querySelector('#btn-inspect') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('#btn-add-element') as HTMLButtonElement).disabled).toBe(true);
  });

  it('setRecordActive(false) returns toolbar to idle and re-enables inspect/addElement', () => {
    const { container, toolbar } = setup();
    toolbar.setRecordActive(true);
    toolbar.setRecordActive(false);
    const banner = document.getElementById('instruction-banner')!;
    expect(banner.classList.contains('visible')).toBe(false);
    expect((container.querySelector('#btn-inspect') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('#btn-add-element') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ESC key does NOT fire onRecordStop when recording is active', () => {
    const onRecordStop = vi.fn();
    const { toolbar } = setup({ onRecordStop });
    toolbar.setRecordActive(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onRecordStop).not.toHaveBeenCalled();
  });

  it('clicking stop button fires onRecordStop', () => {
    const onRecordStop = vi.fn();
    const { toolbar } = setup({ onRecordStop });
    toolbar.setRecordActive(true);
    const banner = document.getElementById('instruction-banner')!;
    (banner.querySelector('[data-record-stop]') as HTMLButtonElement).click();
    expect(onRecordStop).toHaveBeenCalledTimes(1);
  });

  it('updateRecordingStatus updates the banner event count', () => {
    const { toolbar } = setup();
    toolbar.setRecordActive(true);
    toolbar.updateRecordingStatus(7, 15);
    const banner = document.getElementById('instruction-banner')!;
    expect(banner.textContent).toContain('7 events');
  });
});
```

- [ ] **Step 4: Run tests — verify they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|toolbar"
```

Expected: `FAIL src/webview/toolbar.test.ts` — `setRecordActive` not a function.

- [ ] **Step 5: Update `toolbar.ts`**

**5a. Extend `ToolbarState`:**

```typescript
interface ToolbarState {
  inspectActive: boolean;
  addElementActive: boolean;
  recordPending: boolean;
  recordActive: boolean;
}
```

**5b. Extend `ToolbarElements`:**

```typescript
interface ToolbarElements {
  urlBar: HTMLInputElement;
  btnInspect: HTMLButtonElement;
  btnAddElement: HTMLButtonElement;
  btnRecord: HTMLButtonElement;
  banner: HTMLElement;
}
```

**5c. Extend `ToolbarAPI`:**

```typescript
export interface ToolbarAPI {
  setUrl(url: string): void;
  setInspectActive(active: boolean): void;
  setAddElementActive(active: boolean): void;
  setBackendState(active: string, available: Record<string, boolean>): void;
  setRecordActive(active: boolean): void;
  setRecordOptions(opts: { captureConsole: boolean; captureScroll: boolean; captureHover: boolean }): void;
  updateRecordingStatus(eventCount: number, elapsedSeconds: number): void;
  onStateChange(cb: (state: ToolbarState) => void): void;
}
```

**5d. Extend `createToolbar` callbacks parameter:**

```typescript
export function createToolbar(
  container: HTMLElement,
  postMessage: PostMessage,
  callbacks?: {
    onLogsRequest?: () => void;
    onScreenshotRequest?: () => void;
    onBackendRequest?: () => void;
    onBackendSelect?: (backend: string) => void;
    onRecordStart?: (opts: { captureConsole: boolean; captureScroll: boolean; captureHover: boolean }) => void;
    onRecordStop?: () => void;
  }
): ToolbarAPI {
```

**5e. Add record state and record button HTML:**

In the state block, add:

```typescript
  const state: ToolbarState = {
    inspectActive: false,
    addElementActive: false,
    recordPending: false,
    recordActive: false,
  };

  let recordOpts = { captureConsole: false, captureScroll: false, captureHover: false };
  let recordEventCount = 0;
  let recordElapsedSeconds = 0;
```

In the toolbar HTML template (inside the `right` toolbar-group, after `btn-add-element`):

```html
      <button class="toolbar-btn" id="btn-record" title="Record interactions">
        <span class="material-symbols-outlined">radio_button_checked</span>
      </button>
```

**5f. Get `btnRecord` reference:**

```typescript
  const btnRecord = container.querySelector('#btn-record') as HTMLButtonElement;
```

Update `elements`:

```typescript
  const elements: ToolbarElements = { urlBar, btnInspect, btnAddElement, btnRecord, banner };
```

**5g. Wire record button click:**

```typescript
  btnRecord.addEventListener('click', () => {
    if (state.recordActive) return; // already recording — ignore click
    state.recordPending = !state.recordPending;
    postMessage(createToolbarDiagnostic(`Record button toggled ${state.recordPending ? 'pending' : 'off'}`));
    updateRecordUI();
  });
```

**5h. Add `updateRecordUI` function:**

```typescript
  function updateRecordUI() {
    elements.btnRecord.classList.toggle('active', state.recordPending || state.recordActive);
    elements.btnRecord.classList.toggle('record-active', state.recordActive);
    elements.btnInspect.disabled = state.recordActive;
    elements.btnAddElement.disabled = state.recordActive;

    if (state.recordPending) {
      elements.banner.innerHTML = getRecordConfigBannerHtml(recordOpts);
      elements.banner.classList.add('visible');
      attachConfigHandlers();
    } else if (state.recordActive) {
      elements.banner.innerHTML = getRecordActiveBannerHtml(recordEventCount, recordElapsedSeconds);
      elements.banner.classList.add('visible');
      attachStopHandler();
    } else {
      updateModeUI();
    }
  }

  function attachConfigHandlers() {
    const banner = elements.banner;

    // Sync checkboxes back to recordOpts on change
    banner.querySelectorAll<HTMLInputElement>('[data-record-opt]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.recordOpt as keyof typeof recordOpts;
        if (key in recordOpts) recordOpts[key] = cb.checked;
      });
    });

    // Start button
    const startBtn = banner.querySelector('[data-record-start]') as HTMLButtonElement | null;
    startBtn?.addEventListener('click', () => {
      state.recordPending = false;
      state.recordActive = true;
      recordEventCount = 0;
      recordElapsedSeconds = 0;
      postMessage(createToolbarDiagnostic('Recording started'));
      callbacks?.onRecordStart?.({ ...recordOpts });
      updateRecordUI();
    });

    // Cancel button
    const cancelBtn = banner.querySelector('[data-record-cancel]') as HTMLButtonElement | null;
    cancelBtn?.addEventListener('click', () => {
      state.recordPending = false;
      postMessage(createToolbarDiagnostic('Record config cancelled'));
      updateRecordUI();
    });
  }

  function attachStopHandler() {
    const stopBtn = elements.banner.querySelector('[data-record-stop]') as HTMLButtonElement | null;
    stopBtn?.addEventListener('click', () => {
      postMessage(createToolbarDiagnostic('Recording stopped'));
      callbacks?.onRecordStop?.();
    });
  }
```

**5i. Import the new banner helpers in toolbar.ts:**

At the top of `toolbar.ts`, update the import:

```typescript
import { createToolbarDiagnostic, getInstructionBannerHtml, getRecordConfigBannerHtml, getRecordActiveBannerHtml } from './toolbarDiagnostics';
```

**5j. Update the ESC key handler to skip record mode:**

Replace the existing ESC handler:

```typescript
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (state.recordActive || state.recordPending) return; // ESC does not stop recording
      state.inspectActive = false;
      state.addElementActive = false;
      postMessage(createToolbarDiagnostic('Escape pressed - modes cleared'));
      updateModeUI();
      stateChangeCallback?.({ ...state });
    }
  });
```

**5k. Add public API methods to the return object:**

```typescript
    setRecordActive(active: boolean) {
      state.recordActive = active;
      state.recordPending = false;
      if (!active) {
        recordEventCount = 0;
        recordElapsedSeconds = 0;
      }
      updateRecordUI();
    },

    setRecordOptions(opts: typeof recordOpts) {
      recordOpts = { ...opts };
    },

    updateRecordingStatus(eventCount: number, elapsedSeconds: number) {
      recordEventCount = eventCount;
      recordElapsedSeconds = elapsedSeconds;
      if (state.recordActive) {
        elements.banner.innerHTML = getRecordActiveBannerHtml(recordEventCount, recordElapsedSeconds);
        attachStopHandler();
      }
    },
```

- [ ] **Step 6: Run tests — verify they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|toolbar"
```

Expected: `PASS src/webview/toolbar.test.ts` with all 9 tests green.

- [ ] **Step 7: Full test suite — verify no regressions**

```bash
npm test 2>&1 | tail -15
```

Expected: all existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/webview/toolbar.ts src/webview/toolbar.test.ts src/webview/toolbarDiagnostics.ts package.json package-lock.json
git commit -m "feat(toolbar): add record button with config bar and recording status bar"
```

---

## Task 6: main.ts — Relay and Recording State

**Files:**
- Modify: `src/webview/inspect-overlay.ts`
- Modify: `src/webview/main.ts`

- [ ] **Step 1: Add `startRecord` to `inspect-overlay.ts`**

In `src/webview/inspect-overlay.ts`, add `startRecord` to the public API. After the existing `function setMode(mode: Mode) { ... }` function, add:

```typescript
  function startRecord(opts: { captureConsole: boolean; captureScroll: boolean; captureHover: boolean }) {
    try {
      iframe.contentWindow?.postMessage({ type: 'bc:setRecord', opts }, '*');
    } catch {
      // iframe not ready
    }
  }
```

Update the return statement:

```typescript
  return { setMode, cleanup, requestScreenshot, startRecord };
```

- [ ] **Step 2: Intercept `bc:recordEvent` in `main.ts` before the bc: filter**

In `src/webview/main.ts`, in the `window.addEventListener('message', ...)` handler, add a case for `bc:recordEvent` **before** the existing `bc:` early-return filter. The current code looks like:

```typescript
  if (message.type === 'bc:navigated') {
    // ... handle navigation
    return;
  }

  // Skip messages from the inject script (bc: prefix) — handled by inspect-overlay
  if (typeof message.type === 'string' && message.type.startsWith('bc:')) return;
```

Insert this block between the two `if` statements:

```typescript
  if (message.type === 'bc:recordEvent') {
    recordEventCount++;
    if (recordStartTime !== null) {
      const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
      toolbar.updateRecordingStatus(recordEventCount, elapsed);
    }
    postMessage({ type: 'recording:event', payload: message.payload });
    return;
  }
```

- [ ] **Step 3: Add recording state variables to `main.ts`**

After the `const vscode = acquireVsCodeApi();` line, add:

```typescript
let recordStartTime: number | null = null;
let recordEventCount = 0;
let recordTimerInterval: ReturnType<typeof setInterval> | null = null;
```

- [ ] **Step 4: Wire `onRecordStart` and `onRecordStop` toolbar callbacks**

Update the `createToolbar` call in `main.ts` to add record callbacks:

```typescript
const toolbar = createToolbar(toolbarContainer, postMessage, {
  onLogsRequest() { /* ... existing ... */ },
  onScreenshotRequest() { /* ... existing ... */ },
  onBackendRequest() { /* ... existing ... */ },
  onBackendSelect(backend: string) { /* ... existing ... */ },
  onRecordStart(opts) {
    overlay.startRecord(opts);
    postMessage({ type: 'recording:start', payload: opts });
  },
  onRecordStop() {
    overlay.setMode('off');
    postMessage({ type: 'recording:stop' });
  },
});
```

- [ ] **Step 5: Handle `recording:started`, `recording:stopped`, and `recording:initOptions` from extension host**

In the `switch (msg.type)` block in the extension-host message handler, add three new cases:

```typescript
    case 'recording:started':
      recordStartTime = Date.now();
      recordEventCount = 0;
      toolbar.setRecordActive(true);
      recordTimerInterval = setInterval(() => {
        if (recordStartTime !== null) {
          const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
          toolbar.updateRecordingStatus(recordEventCount, elapsed);
        }
      }, 1000);
      break;

    case 'recording:stopped':
      if (recordTimerInterval) {
        clearInterval(recordTimerInterval);
        recordTimerInterval = null;
      }
      recordStartTime = null;
      toolbar.setRecordActive(false);
      showToast(`Recording saved: ${msg.payload.filePath}`, 'success');
      break;

    case 'recording:initOptions':
      toolbar.setRecordOptions(msg.payload);
      break;
```

- [ ] **Step 6: Build and verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 7: Run full test suite**

```bash
npm test 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/webview/main.ts src/webview/inspect-overlay.ts
git commit -m "feat(webview): relay bc:recordEvent to extension host and handle recording lifecycle messages"
```

---

## Task 7: extension.ts + package.json Wiring

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add `webLens.record` to `package.json`**

In `package.json`, add a new entry in the `contributes.commands` array (after `webLens.showLogs`):

```json
      {
        "command": "webLens.record",
        "title": "Web Lens: Toggle Recording"
      }
```

- [ ] **Step 2: Import `RecordingSession` and `RecordingSessionOptions` in `extension.ts`**

Add at the top of `src/extension.ts`:

```typescript
import { RecordingSession } from './recording/RecordingSession';
import type { RecordOptions } from './types';
```

- [ ] **Step 3: Add `RecordingSession` module-level state**

After the existing `let panelManager: BrowserPanelManager | undefined;` line, add:

```typescript
let activeRecording: RecordingSession | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
```

- [ ] **Step 4: Store `context` reference and send `recording:initOptions` on panel open**

At the start of the `activate` function, save the context:

```typescript
  extensionContext = context;
```

After the existing `panelManager = new BrowserPanelManager(context.extensionUri);` line, add a panel-reveal listener to send saved options:

```typescript
  // Send saved record options when the panel becomes visible
  panelManager.onPanelReady(() => {
    const saved = context.workspaceState.get<RecordOptions>('webLens.recordOptions');
    if (saved) {
      panelManager?.postMessage({ type: 'recording:initOptions', payload: saved });
    }
  });
```

> **Note:** `BrowserPanelManager.onPanelReady` does not exist yet. Check whether `BrowserPanelManager` already exposes a panel-reveal or open callback. If not, send `recording:initOptions` inside the existing `webLens.open` command handler after `await panelManager!.open()`.

The simplest approach: send it inside `webLens.open`:

```typescript
    vscode.commands.registerCommand('webLens.open', async () => {
      webLensLogger.info('Open command invoked');
      await panelManager!.open();
      // Restore last-used record options
      const saved = context.workspaceState.get<RecordOptions>('webLens.recordOptions');
      if (saved) {
        panelManager?.postMessage({ type: 'recording:initOptions', payload: saved });
      }
    }),
```

- [ ] **Step 5: Handle `recording:start` message**

In the `panelManager.onMessage(...)` switch, add:

```typescript
      case 'recording:start': {
        // Dispose any in-progress recording (safety)
        activeRecording?.dispose();
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
          panelManager?.postMessage({
            type: 'toast',
            payload: { message: 'No workspace folder open — cannot save recording.', toastType: 'error' },
          });
          break;
        }
        const opts: RecordOptions = message.payload;
        // Persist options for next session
        context.workspaceState.update('webLens.recordOptions', opts);
        activeRecording = new RecordingSession({
          workspaceRoot: folders[0].uri.fsPath,
          startUrl: currentUrl,
          userAgent: 'Web Lens / VS Code',
          captureConsole: opts.captureConsole,
          captureScroll: opts.captureScroll,
          captureHover: opts.captureHover,
        });
        panelManager?.postMessage({ type: 'recording:started' });
        break;
      }
```

- [ ] **Step 6: Handle `recording:stop` message**

```typescript
      case 'recording:stop': {
        if (!activeRecording) break;
        const session = activeRecording;
        activeRecording = undefined;
        session.save().then((filePath) => {
          panelManager?.postMessage({
            type: 'recording:stopped',
            payload: { filePath },
          });
        }).catch((err) => {
          webLensLogger.error('Failed to save recording', err);
          panelManager?.postMessage({
            type: 'toast',
            payload: { message: 'Failed to save recording.', toastType: 'error' },
          });
        });
        break;
      }
```

- [ ] **Step 7: Handle `recording:event` message**

```typescript
      case 'recording:event':
        activeRecording?.addEvent(message.payload);
        break;
```

- [ ] **Step 8: Register `webLens.record` command**

In the `context.subscriptions.push(...)` block, add:

```typescript
    vscode.commands.registerCommand('webLens.record', async () => {
      if (!panelManager) return;
      await panelManager.open();
      if (activeRecording) {
        // Toggle: stop recording
        panelManager.postMessage({ type: 'mode:record', payload: { enabled: false } });
      } else {
        // Toggle: start recording (use saved options, defaults if none)
        const saved = context.workspaceState.get<RecordOptions>('webLens.recordOptions')
          ?? { captureConsole: false, captureScroll: false, captureHover: false };
        panelManager.postMessage({ type: 'mode:record', payload: { enabled: true } });
        // Simulate recording:start flow by posting recording:start to self
        // (The webview's toolbar Start logic routes back through recording:start message)
        // Send initOptions so the webview knows which opts to use
        panelManager.postMessage({ type: 'recording:initOptions', payload: saved });
      }
    }),
```

> **Note:** The `webLens.record` command skips the config bar and uses saved options. The full start flow (creating the session) is still triggered when the webview sends `recording:start` back. If simpler, the command can also directly call the same logic as handling `recording:start` in the extension host, bypassing the webview round-trip. Either approach is acceptable.

- [ ] **Step 9: Dispose active recording on deactivate**

In the `deactivate` function, add:

```typescript
export function deactivate() {
  activeRecording?.dispose();
  activeRecording = undefined;
  panelManager?.dispose();
  panelManager = undefined;
  webLensLogger.info('Extension deactivated');
  webLensLogger.dispose();
}
```

- [ ] **Step 10: Build — verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 11: Run full test suite**

```bash
npm test 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 12: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat(extension): register webLens.record command and wire RecordingSession lifecycle"
```

---

## Final Verification

- [ ] **Run full test suite one last time**

```bash
npm test
```

Expected: all tests pass, no failures.

- [ ] **Run build**

```bash
npm run build
```

Expected: compiles cleanly.

- [ ] **Check .weblens-recordings/ is gitignored**

```bash
grep "weblens-recordings" .gitignore || echo "NOT in .gitignore — add it"
```

If not present, add `/.weblens-recordings` to `.gitignore` and commit.

- [ ] **Final commit (if .gitignore updated)**

```bash
git add .gitignore
git commit -m "chore: add .weblens-recordings to .gitignore"
```
