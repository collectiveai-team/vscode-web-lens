# Audit Fixes Design

**Date:** 2026-04-08
**Scope:** All 10 findings from the vscode-bug-hunter / vscode-extension-expert / vscode-extension-refactorer audit
**Delivery:** 3 commits, grouped by risk

---

## Overview

Ten issues are fixed across three commits. Commit 1 lands security and bug fixes where test coverage is highest. Commit 2 improves code quality. Commit 3 adds new behavior (enhancements). Each commit is independently reviewable and the suite must be green after each one.

---

## Commit 1 — Security & Bugs

### 1. Nonce generation (`src/panel/BrowserPanelManager.ts`)

**Problem:** `getNonce()` uses `Math.random()`, which is not cryptographically secure. The nonce controls which scripts the CSP allows to execute.

**Fix:** Replace the character-loop with `crypto.randomBytes(16).toString('base64url')`. Add `import * as crypto from 'crypto'` (Node built-in, no new dependency). Remove the now-unused `chars` string and loop.

### 2. Duplicate functions in `inject.ts` (`src/webview/inject.ts`)

**Problem:** `hasAccessibleFrameElement()` and `postStartupDiagnostic()` are each defined twice — once inside `initWebLens()` (dead, never called) and once at module scope (actually used at lines 13 and 17/22).

**Fix:** Delete the two inner definitions (lines 206–228 inside `initWebLens()`). The outer definitions at lines 661 and 669 are the live ones and stay unchanged.

### 3. Temp file race condition (`src/adapters/contextFiles.ts`)

**Problem:** `sendViaSelectionCommand()` always writes to `os.tmpdir()/.ref`. Concurrent calls corrupt each other's content.

**Fix:** Replace the fixed filename with a unique one per call:
```
`.web-lens-ref-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
```

### 4. Unhandled `.then()` chains (`src/extension.ts`)

**Problem:** Three promise chains in the `onMessage` handler have no `.catch()`. Errors from `getBackendState()` or `config.update()` are silently swallowed.

**Fix:**
- `backend:request` case: append `.catch(err => webLensLogger.error('backend:request error', err))` to the `.then()` chain.
- `backend:select` case: extract to a small `async` helper `handleBackendSelect(newBackend: string): Promise<void>` to flatten the nested chain. Call it as `void handleBackendSelect(newBackend).catch(err => webLensLogger.error(...))`.
- Config change listener: append `.catch(err => webLensLogger.error('config change error', err))`.

All three remain fire-and-forget (the switch cases are synchronous) but errors now surface in the output channel.

### 5. Stale `extractOriginalUrl` code (`src/webview/main.ts`)

**Problem:** Lines 210–211 try `parsed.searchParams.get('url')`, a leftover from a previous proxy design. `ProxyServer.getProxiedUrl()` never adds a `?url=` parameter; it uses path-based routing. This branch never matches. The JSDoc comment is also wrong.

**Fix:** Remove the `urlParam` branch. Rewrite the JSDoc comment to accurately describe the function: "Reconstruct the original target URL from a proxy URL by replacing the `127.0.0.1:PORT` origin with the configured target origin."

### 6. `cleanupOldFiles` logging (`src/adapters/contextFiles.ts`)

**Problem:** `cleanupOldFiles()` uses `console.error()` — the only place in the extension that bypasses `webLensLogger`. Errors don't appear in the Web Lens output channel.

**Fix:** Replace `console.error('cleanupOldFiles error:', err)` with `webLensLogger.warn('cleanupOldFiles error', err)`. Add `import { webLensLogger } from '../logging'` to `contextFiles.ts` (currently absent).

---

## Commit 2 — Code Quality

### 7. Adapter instantiation (`src/extension.ts`)

**Problem:** All five `BackendAdapter` instances are created as module-level constants before `activate()` runs. A constructor failure would crash extension loading. VS Code best practice is to initialize resources inside `activate()`.

**Fix:** Move the `adapters` record, `getAdapter()`, and `getBackendState()` inside `activate()` as local variables/closures. They close over the local `adapters` — no parameter threading needed. `contextExtractor` and `panelManager` remain module-level `let` variables because `deactivate()` references them.

```typescript
// module level: only panelManager and contextExtractor remain
let panelManager: BrowserPanelManager | undefined;
let contextExtractor: ContextExtractor;

export function activate(context: vscode.ExtensionContext) {
  const adapters: Record<string, BackendAdapter> = {
    clipboard: new ClipboardAdapter(),
    opencode: new OpenCodeAdapter(),
    openchamber: new OpenChamberAdapter(),
    codex: new CodexAdapter(),
    claudecode: new ClaudeCodeAdapter(),
  };

  function getAdapter(): BackendAdapter { ... }
  async function getBackendState() { ... }

  // rest of activate unchanged
}
```

### 8. `webLens.addLogs` command

**Problem:** The command appears in the palette but just shows a toast saying "Use the toolbar button." It doesn't capture logs.

**Fix:** Three-part wire-up with no new logic:

- **`src/types.ts`:** Add `{ type: 'addLogs:request'; payload: Record<string, never> }` to `ExtensionMessage`.
- **`src/extension.ts`:** Change the `webLens.addLogs` command handler from the toast to:
  ```typescript
  panelManager?.postMessage({ type: 'addLogs:request', payload: {} });
  ```
- **`src/webview/main.ts`:** Extract the log-capture logic from the `onLogsRequest` inline callback into a named `captureAndSendLogs()` function at module scope:
  ```typescript
  function captureAndSendLogs() {
    const entries = consoleReceiver.getEntries();
    postMessage({ type: 'action:addLogs', payload: { logs: entries } });
  }
  ```
  Update the toolbar `onLogsRequest` callback to call `captureAndSendLogs()`. Add a `case 'addLogs:request':` to the `ExtensionMessage` switch that also calls `captureAndSendLogs()`.

---

## Commit 3 — Enhancements

### 9. Image dimension decoding (`src/context/ContextExtractor.ts`)

**Problem:** `getImageDimensions()` always returns `{ width: 0, height: 0 }`. `ScreenshotData.width` and `.height` are always zero, making those fields misleading.

**Fix:** Implement header parsing for PNG and JPEG. Strip the data URL prefix (`data:image/...;base64,`), decode to a `Buffer`, then read format-specific bytes:

- **PNG:** width at bytes 16–19, height at bytes 20–23 (big-endian uint32). Fixed offsets in the IHDR chunk, always reliable.
- **JPEG:** scan for SOF0 (`0xFFC0`) or SOF2 (`0xFFC2`) marker. When found, height is a big-endian uint16 at `marker + 3`, width at `marker + 5`.
- **Fallback:** return `{ width: 0, height: 0 }` for unknown formats or any decode error.

`getImageDimensions()` becomes a module-level function (no longer a private method) so it can be tested independently.

`fromScreenshot()` currently takes explicit `width` and `height` parameters that are always passed as `0, 0` from `extension.ts`. Remove those parameters. `fromScreenshot()` decodes internally. Update the one call site in `extension.ts`:

```typescript
// Before
const bundle = contextExtractor.fromScreenshot(message.payload.dataUrl, 0, 0, url);

// After
const bundle = contextExtractor.fromScreenshot(message.payload.dataUrl, url);
```

### 10. `WebviewPanelSerializer` — URL-only restore (`src/panel/BrowserPanelManager.ts`, `src/extension.ts`)

**Problem:** The Web Lens panel is lost when VS Code reloads. The user must reopen it manually.

**Fix:**

**`BrowserPanelManager` changes:**

1. Extract shared panel-wiring logic from `open()` into a private `setupPanel(panel: vscode.WebviewPanel): void` helper that: sets `this.panel`, attaches HTML, wires `onDidReceiveMessage`, wires `onDidDispose`, and sends storage state.

2. Add a `restore(panel: vscode.WebviewPanel, url: string): Promise<void>` method that: starts the proxy, sets `this.state.url`, calls `setupPanel(panel)`, then posts `navigate:url` with the proxied URL. Mirrors `open()` but accepts the panel VS Code already created.

**`webview/main.ts` changes:**

Call `vscode.setState({ url: extractOriginalUrl(msg.payload.url) || msg.payload.url })` inside the `navigate:url` handler (after setting `iframe.src`) to persist the original URL. `msg.payload.url` is a proxy URL (`http://127.0.0.1:PORT/path`) whose port changes on every start — storing the proxy URL would be useless on restore. `extractOriginalUrl()` converts it back to the target origin URL before persisting. VS Code passes this state object to `deserializeWebviewPanel` on restore.

**`extension.ts` changes:**

Register the serializer inside `activate()`, after `panelManager` is created:

```typescript
context.subscriptions.push(
  vscode.window.registerWebviewPanelSerializer('webLens', {
    async deserializeWebviewPanel(panel, state) {
      const savedUrl = (state as { url?: string })?.url;
      const config = vscode.workspace.getConfiguration('webLens');
      const url = savedUrl ?? config.get<string>('defaultUrl') ?? 'http://localhost:3000';
      await panelManager!.restore(panel, url);
    }
  })
);
```

---

## Testing

All existing 127 tests must pass after each commit. No new test files are required for commits 1 and 2 — the fixes are covered by existing tests and TypeScript compilation.

Commit 3 warrants two new unit tests:
- `getImageDimensions`: one test with a real 1×1 PNG data URL, one with a minimal JPEG, one with a garbage string (fallback).
- `BrowserPanelManager.restore()`: add a test to the existing `BrowserPanelManager.test.ts` suite verifying that `restore()` sets `this.state.url` and calls `postMessage` with the proxied URL.

---

## Files Changed

| File | Commits |
|------|---------|
| `src/panel/BrowserPanelManager.ts` | 1, 3 |
| `src/webview/inject.ts` | 1 |
| `src/adapters/contextFiles.ts` | 1, 2 |
| `src/extension.ts` | 1, 2, 3 |
| `src/webview/main.ts` | 1, 2, 3 |
| `src/types.ts` | 2 |
| `src/context/ContextExtractor.ts` | 3 |
| `src/panel/BrowserPanelManager.test.ts` | 3 |
| `src/context/ContextExtractor.test.ts` | 3 |
