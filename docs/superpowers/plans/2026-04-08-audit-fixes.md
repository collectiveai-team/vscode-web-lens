# Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 10 audit findings across 3 commits, progressing from security/bugs → code quality → enhancements.

**Architecture:** Targeted edits to 7 existing source files and 2 existing test files. No new files. Each commit leaves the suite green.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, Node.js built-in `crypto`

---

## File Map

| File | Tasks |
|------|-------|
| `src/panel/BrowserPanelManager.ts` | 1, 13 |
| `src/webview/inject.ts` | 2 |
| `src/adapters/contextFiles.ts` | 3, 6 |
| `src/extension.ts` | 4, 8, 9, 13 |
| `src/webview/main.ts` | 5, 9, 13 |
| `src/types.ts` | 9 |
| `src/context/ContextExtractor.ts` | 11, 12 |
| `src/panel/BrowserPanelManager.test.ts` | 1, 13 |
| `src/context/ContextExtractor.test.ts` | 11, 12 |

---

## Task 1: Fix nonce generation

**Files:**
- Modify: `src/panel/BrowserPanelManager.ts` (the `getNonce()` method)
- Modify: `src/panel/BrowserPanelManager.test.ts` (add test)

- [ ] **Step 1: Add a failing test for getNonce()**

Open `src/panel/BrowserPanelManager.test.ts`. Add this test inside the top-level `describe('BrowserPanelManager', () => {` block, after the last `it(...)` inside the main describe (before the `describe('storage message handling'` block):

```typescript
it('generates unique cryptographically-safe nonces', () => {
  const nonce1 = (manager as any).getNonce() as string;
  const nonce2 = (manager as any).getNonce() as string;
  // Two calls must produce different values
  expect(nonce1).not.toBe(nonce2);
  // crypto.randomBytes(16).toString('base64url') produces exactly 22 characters
  expect(nonce1).toHaveLength(22);
  // base64url alphabet: A-Z a-z 0-9 - _
  expect(nonce1).toMatch(/^[A-Za-z0-9_-]+$/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "generates unique"
```

Expected: FAIL — the current implementation produces 32-character strings, so `toHaveLength(22)` fails.

- [ ] **Step 3: Replace getNonce() with crypto.randomBytes**

In `src/panel/BrowserPanelManager.ts`, add the import at the top of the file (after the existing imports):

```typescript
import * as crypto from 'crypto';
```

Then replace the entire `getNonce()` method (currently lines 314–320):

```typescript
private getNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "generates unique"
```

Expected: PASS

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `Test Files  18 passed (18)` / `Tests  128 passed (128)`

---

## Task 2: Remove dead functions from inject.ts

**Files:**
- Modify: `src/webview/inject.ts`

The functions `hasAccessibleFrameElement()` (line 206) and `postStartupDiagnostic()` (line 214) are defined inside `initWebLens()` but never called from there. The live versions are the module-scope definitions at lines 661 and 669.

- [ ] **Step 1: Delete the two dead inner definitions**

In `src/webview/inject.ts`, remove the following block in its entirety (it sits inside `initWebLens()`, roughly lines 206–228 — locate by searching for `function hasAccessibleFrameElement` inside the file):

```typescript
function hasAccessibleFrameElement(): boolean {
  try {
    return window.frameElement !== null;
  } catch {
    return false;
  }
}

function postStartupDiagnostic(level: 'info' | 'warn' | 'error', message: string, details?: string) {
  try {
    window.parent.postMessage({
      type: 'bc:diagnostic',
      payload: {
        source: 'page.startup',
        level,
        message,
        details,
      },
    }, '*');
  } catch {
    // Ignore startup diagnostic failures.
  }
}
```

The identical functions at the bottom of the file (outside `initWebLens()`) must remain untouched.

- [ ] **Step 2: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  128 passed (128)`

---

## Task 3: Fix temp file race condition

**Files:**
- Modify: `src/adapters/contextFiles.ts` (the `sendViaSelectionCommand` function)

- [ ] **Step 1: Replace the fixed filename with a unique one**

In `src/adapters/contextFiles.ts`, find line:

```typescript
const tmpFile = path.join(tmpDir, `.ref`);
```

Replace it with:

```typescript
const tmpFile = path.join(tmpDir, `.web-lens-ref-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
```

- [ ] **Step 2: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  128 passed (128)`

---

## Task 4: Fix unhandled `.then()` chains in extension.ts

**Files:**
- Modify: `src/extension.ts`

Three sites need `.catch()` added.

- [ ] **Step 1: Fix the `backend:request` case**

Find this block in `extension.ts`:

```typescript
      case 'backend:request': {
        getBackendState().then((state) => {
          panelManager?.postMessage({ type: 'backend:state', payload: state });
        });
        break;
      }
```

Replace it with:

```typescript
      case 'backend:request': {
        getBackendState().then((state) => {
          panelManager?.postMessage({ type: 'backend:state', payload: state });
        }).catch((err) => {
          webLensLogger.error('backend:request state error', err);
        });
        break;
      }
```

- [ ] **Step 2: Fix the `backend:select` case**

Find this block:

```typescript
      case 'backend:select': {
        const newBackend = message.payload.backend;
        if (adapters[newBackend]) {
          const config = vscode.workspace.getConfiguration('webLens');
          config.update('backend', newBackend, vscode.ConfigurationTarget.Global).then(() => {
            getBackendState().then((state) => {
              panelManager?.postMessage({ type: 'backend:state', payload: state });
            });
          });
        }
        break;
      }
```

Replace it with:

```typescript
      case 'backend:select': {
        const newBackend = message.payload.backend;
        if (adapters[newBackend]) {
          const config = vscode.workspace.getConfiguration('webLens');
          config.update('backend', newBackend, vscode.ConfigurationTarget.Global)
            .then(() => getBackendState())
            .then((state) => {
              panelManager?.postMessage({ type: 'backend:state', payload: state });
            })
            .catch((err) => {
              webLensLogger.error('backend:select error', err);
            });
        }
        break;
      }
```

- [ ] **Step 3: Fix the config-change listener**

Find this block inside the `onDidChangeConfiguration` listener (the one that checks `webLens.backend`):

```typescript
        getBackendState().then((state) => {
          panelManager?.postMessage({ type: 'backend:state', payload: state });
        });
```

Replace it with:

```typescript
        getBackendState().then((state) => {
          panelManager?.postMessage({ type: 'backend:state', payload: state });
        }).catch((err) => {
          webLensLogger.error('config change backend state error', err);
        });
```

- [ ] **Step 4: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  128 passed (128)`

---

## Task 5: Remove stale extractOriginalUrl code

**Files:**
- Modify: `src/webview/main.ts`

- [ ] **Step 1: Remove the dead urlParam branch and fix the JSDoc**

Find the `extractOriginalUrl` function (around line 207):

```typescript
/**
 * Extract the original target URL from a proxy URL.
 * Proxy URLs look like: http://127.0.0.1:<port>/?url=<encodedTargetUrl>
 */
function extractOriginalUrl(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl);
    const urlParam = parsed.searchParams.get('url');
    if (urlParam) return urlParam;

    if (parsed.hostname === '127.0.0.1' && targetOrigin) {
      const target = new URL(targetOrigin);
      return `${target.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Not a valid URL — return as-is
  }
  return proxyUrl;
}
```

Replace the entire function with:

```typescript
/**
 * Reconstruct the original target URL from a proxy URL by replacing the
 * 127.0.0.1:PORT origin with the configured target origin.
 * Returns the input unchanged if it is not a proxy URL.
 */
function extractOriginalUrl(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl);
    if (parsed.hostname === '127.0.0.1' && targetOrigin) {
      const target = new URL(targetOrigin);
      return `${target.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Not a valid URL — return as-is
  }
  return proxyUrl;
}
```

- [ ] **Step 2: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  128 passed (128)`

---

## Task 6: Fix cleanupOldFiles logging

**Files:**
- Modify: `src/adapters/contextFiles.ts`

- [ ] **Step 1: Add webLensLogger import**

At the top of `src/adapters/contextFiles.ts`, find the existing imports block:

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ContextBundle } from '../types';
```

Add the logger import after the others:

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ContextBundle } from '../types';
import { webLensLogger } from '../logging';
```

- [ ] **Step 2: Replace console.error with webLensLogger**

Find in `cleanupOldFiles`:

```typescript
  } catch (err) {
    // Fire-and-forget: log but don't throw
    console.error('cleanupOldFiles error:', err);
  }
```

Replace it with:

```typescript
  } catch (err) {
    // Fire-and-forget: log but don't throw
    webLensLogger.warn('cleanupOldFiles error', err);
  }
```

- [ ] **Step 3: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  128 passed (128)`

---

## Task 7: Commit 1 — Security & Bugs

- [ ] **Step 1: Stage and commit**

```bash
git add src/panel/BrowserPanelManager.ts \
        src/panel/BrowserPanelManager.test.ts \
        src/webview/inject.ts \
        src/adapters/contextFiles.ts \
        src/extension.ts \
        src/webview/main.ts
git commit -m "fix: security and bug fixes from audit

- Use crypto.randomBytes for CSP nonce (was Math.random)
- Remove dead duplicate functions from inject.ts
- Use unique temp filenames in sendViaSelectionCommand
- Add .catch() to unhandled promise chains in extension.ts
- Remove stale ?url= branch from extractOriginalUrl
- Use webLensLogger instead of console.error in cleanupOldFiles"
```

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: `nothing to commit, working tree clean`

---

## Task 8: Move adapter instantiation into activate()

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Move adapters, getAdapter, and getBackendState inside activate()**

In `src/extension.ts`, find the module-level declarations (roughly lines 14–49):

```typescript
let panelManager: BrowserPanelManager | undefined;
let contextExtractor: ContextExtractor;

const adapters: Record<string, BackendAdapter> = {
  clipboard: new ClipboardAdapter(),
  opencode: new OpenCodeAdapter(),
  openchamber: new OpenChamberAdapter(),
  codex: new CodexAdapter(),
  claudecode: new ClaudeCodeAdapter(),
};

function getAdapter(): BackendAdapter {
  const config = vscode.workspace.getConfiguration('webLens');
  const backendName = config.get<string>('backend') || 'clipboard';
  return adapters[backendName] || adapters.clipboard;
}

async function getBackendState(): Promise<{ active: string; available: Record<string, boolean> }> {
  const config = vscode.workspace.getConfiguration('webLens');
  const active = config.get<string>('backend') || 'clipboard';

  const available: Record<string, boolean> = {};
  const timeout = (ms: number) => new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms));

  await Promise.all(
    Object.entries(adapters).map(async ([name, adapter]) => {
      try {
        available[name] = await Promise.race([adapter.isAvailable(), timeout(3000)]);
      } catch {
        available[name] = false;
      }
    })
  );

  return { active, available };
}
```

Replace it with (only `panelManager` and `contextExtractor` remain at module level):

```typescript
let panelManager: BrowserPanelManager | undefined;
let contextExtractor: ContextExtractor;
```

Then, at the very start of the `activate()` function body (before the `const packageJson = ...` line), insert:

```typescript
  const adapters: Record<string, BackendAdapter> = {
    clipboard: new ClipboardAdapter(),
    opencode: new OpenCodeAdapter(),
    openchamber: new OpenChamberAdapter(),
    codex: new CodexAdapter(),
    claudecode: new ClaudeCodeAdapter(),
  };

  function getAdapter(): BackendAdapter {
    const config = vscode.workspace.getConfiguration('webLens');
    const backendName = config.get<string>('backend') || 'clipboard';
    return adapters[backendName] || adapters.clipboard;
  }

  async function getBackendState(): Promise<{ active: string; available: Record<string, boolean> }> {
    const config = vscode.workspace.getConfiguration('webLens');
    const active = config.get<string>('backend') || 'clipboard';

    const available: Record<string, boolean> = {};
    const timeout = (ms: number) => new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms));

    await Promise.all(
      Object.entries(adapters).map(async ([name, adapter]) => {
        try {
          available[name] = await Promise.race([adapter.isAvailable(), timeout(3000)]);
        } catch {
          available[name] = false;
        }
      })
    );

    return { active, available };
  }
```

- [ ] **Step 2: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  128 passed (128)`

---

## Task 9: Wire up `webLens.addLogs` command

**Files:**
- Modify: `src/types.ts`
- Modify: `src/extension.ts`
- Modify: `src/webview/main.ts`

- [ ] **Step 1: Add addLogs:request to ExtensionMessage in types.ts**

In `src/types.ts`, find the `ExtensionMessage` type. Add one new variant at the end of the union (before the closing semicolon):

```typescript
export type ExtensionMessage =
  | { type: 'navigate:url'; payload: { url: string } }
  | { type: 'mode:inspect'; payload: { enabled: boolean } }
  | { type: 'mode:addElement'; payload: { enabled: boolean } }
  | { type: 'screenshot:request'; payload: Record<string, never> }
  | { type: 'config:update'; payload: { backend: string } }
  | { type: 'toast'; payload: { message: string; toastType: 'success' | 'error' } }
  | { type: 'backend:state'; payload: { active: string; available: Record<string, boolean> } }
  | { type: 'theme:update'; payload: { kind: 'dark' | 'light' } }
  | { type: 'storage:state'; payload: { origin: string; enabled: boolean; hasData: boolean } }
  | { type: 'storage:view'; payload: { origin: string; names: string[] } }
  | { type: 'addLogs:request'; payload: Record<string, never> };
```

- [ ] **Step 2: Update the webLens.addLogs command in extension.ts**

Find the `webLens.addLogs` command handler:

```typescript
    vscode.commands.registerCommand('webLens.addLogs', () => {
      // The webview toolbar button handles log capture directly via the
      // console capture buffer. This command palette entry triggers the
      // same flow by simulating the toolbar button click.
      // Note: A dedicated `addLogs:request` message could be added if
      // command palette -> webview log capture is needed. For MVP, the
      // toolbar button is the primary UX.
      panelManager?.postMessage({
        type: 'toast',
        payload: { message: 'Use the toolbar button to capture logs', toastType: 'success' },
      });
    }),
```

Replace it with:

```typescript
    vscode.commands.registerCommand('webLens.addLogs', () => {
      panelManager?.postMessage({ type: 'addLogs:request', payload: {} });
    }),
```

- [ ] **Step 3: Extract captureAndSendLogs in main.ts and handle the new message**

In `src/webview/main.ts`, find the `onLogsRequest` callback inside the `createToolbar` call:

```typescript
const toolbar = createToolbar(toolbarContainer, postMessage, {
  onLogsRequest() {
    const entries: ConsoleEntry[] = consoleReceiver.getEntries();
    postMessage({ type: 'action:addLogs', payload: { logs: entries } });
  },
```

Replace it with a named function and update the callback:

```typescript
function captureAndSendLogs() {
  const entries: ConsoleEntry[] = consoleReceiver.getEntries();
  postMessage({ type: 'action:addLogs', payload: { logs: entries } });
}

const toolbar = createToolbar(toolbarContainer, postMessage, {
  onLogsRequest() {
    captureAndSendLogs();
  },
```

Then, in the `window.addEventListener('message', ...)` switch, find:

```typescript
    case 'storage:view':
      showStorageDataView(msg.payload.origin, msg.payload.names);
      break;
```

Add the new case immediately after it:

```typescript
    case 'addLogs:request':
      captureAndSendLogs();
      break;
```

- [ ] **Step 4: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  128 passed (128)`

---

## Task 10: Commit 2 — Code Quality

- [ ] **Step 1: Stage and commit**

```bash
git add src/extension.ts src/types.ts src/webview/main.ts
git commit -m "refactor: code quality improvements from audit

- Move adapter instantiation inside activate()
- Implement webLens.addLogs command (was no-op toast)"
```

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: `nothing to commit, working tree clean`

---

## Task 11: Implement getImageDimensions with PNG/JPEG decoding (TDD)

**Files:**
- Modify: `src/context/ContextExtractor.ts`
- Modify: `src/context/ContextExtractor.test.ts`

- [ ] **Step 1: Add failing tests for getImageDimensions**

In `src/context/ContextExtractor.test.ts`, update the import line and add helper functions and a new describe block:

Replace:

```typescript
import { describe, it, expect } from 'vitest';
import { ContextExtractor } from './ContextExtractor';
```

With:

```typescript
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
```

Then add a new `describe` block at the bottom of the file (after the existing `describe('ContextExtractor', ...)`):

```typescript
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
```

- [ ] **Step 2: Run the new tests and verify they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "getImageDimensions"
```

Expected: FAIL — `getImageDimensions` is not exported yet.

- [ ] **Step 3: Implement getImageDimensions in ContextExtractor.ts**

In `src/context/ContextExtractor.ts`, add this module-level exported function before the `ContextExtractor` class definition:

```typescript
/**
 * Decode width and height from a PNG or JPEG data URL.
 * Returns {width:0, height:0} for unknown formats or on any error.
 */
export function getImageDimensions(dataUrl: string): { width: number; height: number } {
  try {
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
    if (!match) return { width: 0, height: 0 };

    const format = match[1];
    const buf = Buffer.from(match[2], 'base64');

    if (format === 'png') {
      if (buf.length < 24) return { width: 0, height: 0 };
      // PNG IHDR: width at bytes 16-19, height at bytes 20-23 (big-endian uint32)
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
      };
    }

    if (format === 'jpeg' || format === 'jpg') {
      // Scan JPEG markers starting after SOI (0xFF 0xD8)
      let i = 2;
      while (i + 1 < buf.length) {
        if (buf[i] !== 0xff) break;
        const markerType = buf[i + 1];
        // SOF0 (0xC0, baseline DCT) or SOF2 (0xC2, progressive DCT)
        if (markerType === 0xc0 || markerType === 0xc2) {
          if (i + 8 >= buf.length) break;
          // Segment layout after marker (2 bytes): length (2), precision (1), height (2), width (2)
          return {
            height: buf.readUInt16BE(i + 5),
            width: buf.readUInt16BE(i + 7),
          };
        }
        if (markerType === 0xd9) break; // EOI — end of image
        // Skip segment: marker (2 bytes) + segment length (includes its own 2 bytes)
        if (i + 3 >= buf.length) break;
        const segLen = buf.readUInt16BE(i + 2);
        i += 2 + segLen;
      }
    }
  } catch {
    // fall through
  }
  return { width: 0, height: 0 };
}
```

Also remove the old private method from the `ContextExtractor` class. Find:

```typescript
  private getImageDimensions(_dataUrl: string): { width: number; height: number } {
    // Approximate from base64 length — actual dimensions would require decoding
    // For now, return 0,0 — the backend adapter can decode if needed
    return { width: 0, height: 0 };
  }
```

Delete it entirely.

Update the one call site inside `fromCapturedElement` from `this.getImageDimensions(...)` to the module-level `getImageDimensions(...)`:

```typescript
    if (payload.screenshotDataUrl) {
      const dimensions = getImageDimensions(payload.screenshotDataUrl);
      bundle.screenshot = {
        dataUrl: payload.screenshotDataUrl,
        ...dimensions,
      };
    }
```

- [ ] **Step 4: Run the new tests and verify they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "getImageDimensions"
```

Expected: all three PASS.

---

## Task 12: Update fromScreenshot signature

**Files:**
- Modify: `src/context/ContextExtractor.ts`
- Modify: `src/context/ContextExtractor.test.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Update the fromScreenshot test to use syntheticPng**

In `src/context/ContextExtractor.test.ts`, find:

```typescript
  it('builds screenshot-only bundle', () => {
    const bundle = extractor.fromScreenshot('data:image/png;base64,xyz', 800, 600, 'http://localhost:3000');

    expect(bundle.screenshot?.dataUrl).toBe('data:image/png;base64,xyz');
    expect(bundle.screenshot?.width).toBe(800);
    expect(bundle.element).toBeUndefined();
  });
```

Replace it with:

```typescript
  it('builds screenshot-only bundle with decoded dimensions', () => {
    const dataUrl = syntheticPng(800, 600);
    const bundle = extractor.fromScreenshot(dataUrl, 'http://localhost:3000');

    expect(bundle.screenshot?.dataUrl).toBe(dataUrl);
    expect(bundle.screenshot?.width).toBe(800);
    expect(bundle.screenshot?.height).toBe(600);
    expect(bundle.element).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "screenshot-only"
```

Expected: FAIL — `fromScreenshot` still takes 4 arguments.

- [ ] **Step 3: Update fromScreenshot in ContextExtractor.ts**

Find the `fromScreenshot` method:

```typescript
  fromScreenshot(
    dataUrl: string,
    width: number,
    height: number,
    url: string
  ): ContextBundle {
    return {
      url,
      timestamp: Date.now(),
      screenshot: { dataUrl, width, height },
    };
  }
```

Replace it with:

```typescript
  fromScreenshot(
    dataUrl: string,
    url: string
  ): ContextBundle {
    return {
      url,
      timestamp: Date.now(),
      screenshot: { dataUrl, ...getImageDimensions(dataUrl) },
    };
  }
```

- [ ] **Step 4: Update the call site in extension.ts**

Find:

```typescript
      const bundle = contextExtractor.fromScreenshot(
        message.payload.dataUrl,
        0,
        0,
        url
      );
```

Replace it with:

```typescript
      const bundle = contextExtractor.fromScreenshot(
        message.payload.dataUrl,
        url
      );
```

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  130 passed (130)` (3 new getImageDimensions tests added in Task 11)

---

## Task 13: Add WebviewPanelSerializer

**Files:**
- Modify: `src/panel/BrowserPanelManager.ts`
- Modify: `src/panel/BrowserPanelManager.test.ts`
- Modify: `src/extension.ts`
- Modify: `src/webview/main.ts`

- [ ] **Step 1: Add a failing test for restore()**

In `src/panel/BrowserPanelManager.test.ts`, add this test inside the top-level `describe('BrowserPanelManager', () => {` block, after the `'disposes panel correctly'` test:

```typescript
  it('restores from saved URL without creating a new panel', async () => {
    const mockPanel = {
      webview: {
        html: '',
        onDidReceiveMessage: vi.fn((handler: WebviewMessageHandler) => {
          mockState.lastMessageHandler = handler;
        }),
        postMessage: vi.fn(),
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: 'https://example.com',
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
      dispose: vi.fn(),
    };

    await manager.restore(mockPanel as any, 'http://localhost:3000/saved-path');

    // Must NOT create a new panel
    expect(mockedVscode.window.createWebviewPanel).not.toHaveBeenCalled();
    // Must store the saved URL
    expect((manager as any).state.url).toBe('http://localhost:3000/saved-path');
    // Must navigate via proxy
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'navigate:url',
        payload: { url: 'http://127.0.0.1:9876/saved-path' },
      })
    );
  });
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "restores from saved"
```

Expected: FAIL — `restore` is not a method of `BrowserPanelManager`.

- [ ] **Step 3: Extract setupPanel and add restore() to BrowserPanelManager.ts**

In `src/panel/BrowserPanelManager.ts`, find the `open()` method body. The lines after panel creation (the wiring) need to be extracted. Replace the entire `open()` method with:

```typescript
  async open() {
    if (this.panel) {
      webLensLogger.info('Revealing existing panel');
      this.panel.reveal();
      return;
    }

    // Start the proxy server before creating the panel
    await this.proxyServer.start();
    webLensLogger.info('Opening browser panel', { url: this.state.url });

    const panel = vscode.window.createWebviewPanel(
      'webLens',
      'Web Lens Debug',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'webview'),
          vscode.Uri.joinPath(this.extensionUri, 'out'),
          vscode.Uri.joinPath(this.extensionUri, 'media', 'icons'),
        ],
      }
    );

    this.setupPanel(panel);

    // Navigate to default URL (through proxy)
    const proxiedUrl = this.proxyServer.getProxiedUrl(this.state.url);
    this.postMessage({ type: 'navigate:url', payload: { url: proxiedUrl } });
    this.sendStorageState().catch((err) => {
      webLensLogger.warn('BrowserPanelManager: failed to send initial storage state', String(err));
    });
  }

  async restore(panel: vscode.WebviewPanel, url: string): Promise<void> {
    webLensLogger.info('Restoring browser panel from saved state', { url });
    await this.proxyServer.start();
    this.state.url = url;
    this.setupPanel(panel);
    const proxiedUrl = this.proxyServer.getProxiedUrl(url);
    this.postMessage({ type: 'navigate:url', payload: { url: proxiedUrl } });
    this.sendStorageState().catch((err) => {
      webLensLogger.warn('BrowserPanelManager: failed to send storage state on restore', String(err));
    });
  }
```

Then add the `setupPanel` private method (place it just before `getHtmlForWebview()`):

```typescript
  private setupPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message)
    );

    this.panel.onDidDispose(() => {
      webLensLogger.info('Browser panel disposed');
      this.panel = undefined;
      this.proxyServer.stop().catch(() => {
        // Ignore stop errors on dispose
      });
    });
  }
```

- [ ] **Step 4: Run the restore test and verify it passes**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 "restores from saved"
```

Expected: PASS

- [ ] **Step 5: Persist URL in webview/main.ts**

In `src/webview/main.ts`, find the `navigate:url` case in the message switch:

```typescript
    case 'navigate:url':
      iframe.src = msg.payload.url;
      // Show the original URL in the toolbar, not the proxy URL
      toolbar.setUrl(extractOriginalUrl(msg.payload.url) || msg.payload.url);
      break;
```

Replace it with:

```typescript
    case 'navigate:url': {
      iframe.src = msg.payload.url;
      const originalUrl = extractOriginalUrl(msg.payload.url) || msg.payload.url;
      toolbar.setUrl(originalUrl);
      // Persist the original URL so WebviewPanelSerializer can restore it
      vscode.setState({ url: originalUrl });
      break;
    }
```

- [ ] **Step 6: Add registerWebviewPanelSerializer to the vscode mock in extension.test.ts**

The activation test calls `activate()`, which will now call `vscode.window.registerWebviewPanelSerializer`. The mock must include it or the test will throw.

In `src/extension.test.ts`, find the `window` object inside `vi.mock('vscode', ...)`:

```typescript
  window: {
    onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: vi.fn() })),
    showInputBox: vi.fn(),
  },
```

Replace it with:

```typescript
  window: {
    onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: vi.fn() })),
    showInputBox: vi.fn(),
    registerWebviewPanelSerializer: vi.fn(() => ({ dispose: vi.fn() })),
  },
```

- [ ] **Step 7: Register the serializer in extension.ts (activation)**

In `src/extension.ts`, in the `activate()` function, find the line:

```typescript
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
```

Insert the serializer registration immediately before it:

```typescript
  // Restore the panel after VS Code reloads
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('webLens', {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown) {
        const savedUrl = (state as { url?: string } | null)?.url;
        const config = vscode.workspace.getConfiguration('webLens');
        const url = savedUrl ?? config.get<string>('defaultUrl') ?? 'http://localhost:3000';
        await panelManager!.restore(panel, url);
      },
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
```

- [ ] **Step 8: Run the full suite**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests  131 passed (131)` (1 new restore test)

---

## Task 14: Commit 3 — Enhancements

- [ ] **Step 1: Stage and commit**

```bash
git add src/context/ContextExtractor.ts \
        src/context/ContextExtractor.test.ts \
        src/panel/BrowserPanelManager.ts \
        src/panel/BrowserPanelManager.test.ts \
        src/extension.ts \
        src/extension.test.ts \
        src/webview/main.ts
git commit -m "feat: enhancements from audit

- Decode real PNG/JPEG dimensions in getImageDimensions
- Remove width/height params from fromScreenshot (decoded internally)
- Add WebviewPanelSerializer for URL-only panel restore on reload"
```

- [ ] **Step 2: Verify final state**

```bash
git status && npm test 2>&1 | tail -5
```

Expected:
```
nothing to commit, working tree clean
Tests  131 passed (131)
```
