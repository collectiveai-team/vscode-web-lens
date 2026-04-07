# Standalone Dev Mode for web-lens

**Date:** 2026-04-06  
**Status:** Approved  
**Topic:** Run the web-lens WebView UI as a standalone webapp for faster development iteration

---

## Problem

The current development loop for web-lens requires either:
1. Building the `.vsix` and installing it into VS Code, or
2. Running the VS Code Extension Debugger (F5)

Both break the development workflow when iterating on UI/UX — a single CSS change or toolbar adjustment requires a full extension reload cycle. There is no hot-reload path.

---

## Goal

A `npm run dev:standalone` command that:
- Opens the web-lens UI at `http://localhost:3000` in any browser
- Runs the real proxy server so actual URLs can be browsed and tested
- Auto-rebuilds and reloads the browser on every source change
- Requires zero changes to the existing webview source code

---

## Architecture

### New Files

```
src/standalone/
  server.ts          — HTTP server + message router (replaces extension host)
  vscode-shim.ts     — browser-side VS Code API mock
  index.html         — HTML template without VS Code CSP restrictions
```

### Modified Files

```
esbuild.config.js   — additional standalone entry points + --watch mode support
package.json        — new "dev:standalone" script
```

### Untouched

All `src/webview/*.ts`, `src/proxy/ProxyServer.ts`, `src/types.ts`, and all adapter code are unchanged.

---

## Communication Channel

The VS Code IPC channel (extension host ↔ WebviewPanel postMessage) is replaced by:

```
Browser                           Standalone Server (Node.js)
  │                                     │
  │  fetch POST /message  ──────────►  │  routes WebviewMessage to handler
  │                                     │
  │  ◄─────────────── SSE /events       │  pushes ExtensionMessage to queue
  │                                     │
  EventSource receives SSE event        │
  → shim synthesizes window MessageEvent│
  → window.dispatchEvent(...)           │
  → existing webview code runs ✓        │
```

The webview listens to `window.addEventListener('message', ...)`. In VS Code, messages arrive via the webview bridge. In standalone mode, the shim synthesizes identical `MessageEvent`s from SSE payloads. The webview code is unaware of the difference.

---

## Component Details

### `src/standalone/server.ts`

A single `http.createServer()` — no new npm dependencies.

**Startup sequence:**
1. Start `ProxyServer` (existing class, zero changes)
2. Capture assigned proxy port
3. Start HTTP server on `localhost:3000` (configurable via `PORT` env var)
4. On first SSE client connect → push `proxyReady` message with proxy URL

**HTTP routes:**

| Route | Response |
|---|---|
| `GET /` | Serve `src/standalone/index.html` |
| `GET /webview/main.js` | Serve compiled webview bundle |
| `GET /out/inject.js` | Serve compiled inject bundle |
| `GET /standalone/vscode-shim.js` | Serve compiled shim bundle |
| `GET /events` | SSE stream (extension → browser) |
| `POST /message` | Receive `WebviewMessage`, route to handler |
| `POST /internal/rebuilt` | Receive esbuild rebuild signal, trigger browser reload |

**Message routing** (replacing `src/extension.ts` routing logic):

| `WebviewMessage` type | Standalone behavior |
|---|---|
| `navigate` | Update proxy target URL; push `navigationComplete` back |
| `requestProxyInfo` | Push `proxyReady` with current proxy port |
| `requestContext` | Forward back to webview (inject script handles DOM capture) |
| `sendContext` (backend: clipboard) | Push `copyToClipboard` to browser → shim calls `navigator.clipboard` |
| `sendContext` (other backends) | Log context bundle to stdout; push `contextSent` acknowledgment |
| All others | Log to stdout; no-op or echo as appropriate |

**SSE implementation:**
- Maintain a list of active SSE response objects
- Broadcast to all on `broadcastMessage(msg: ExtensionMessage)`
- Remove stale clients on connection close

### `src/standalone/vscode-shim.ts`

Compiled as a browser IIFE, loaded before `main.js` in `index.html`.

```typescript
// Provides acquireVsCodeApi() matching VS Code's webview interface
window.acquireVsCodeApi = () => ({
  postMessage: (msg) =>
    fetch('/message', { method: 'POST', body: JSON.stringify(msg) }),
  getState: () =>
    JSON.parse(sessionStorage.getItem('__vscode_state') ?? 'null'),
  setState: (s) =>
    sessionStorage.setItem('__vscode_state', JSON.stringify(s)),
});

// SSE → window MessageEvent bridge
const es = new EventSource('/events');
es.onmessage = (e) => {
  const msg = JSON.parse(e.data);

  // Clipboard delivery must happen in browser context
  if (msg.type === 'copyToClipboard') {
    navigator.clipboard.writeText(msg.text);
    return;
  }

  // Hot-reload signal from esbuild watch
  if (msg.type === '__standalone_reload') {
    location.reload();
    return;
  }

  // All other extension messages → synthesize MessageEvent for webview code
  window.dispatchEvent(new MessageEvent('message', { data: msg }));
};
```

The shim does **not** expose `vscode.window`, `vscode.commands`, or `vscode.workspace`. Those are extension-host APIs. The webview only ever touches `acquireVsCodeApi()`, so nothing is missing.

### `src/standalone/index.html`

An HTML template adapted from `BrowserPanelManager.ts`'s generated template, with:
- No VS Code webview CSP nonce restrictions
- Standard browser CSP appropriate for localhost dev
- Script load order: `vscode-shim.js` → `main.js`
- Same `<iframe id="browser-iframe">` structure as the real webview

### esbuild changes

Add two new entry points to `esbuild.config.js`:
- `src/standalone/server.ts` → `out/standalone/server.js` (CJS, Node.js platform)
- `src/standalone/vscode-shim.ts` → `standalone/vscode-shim.js` (IIFE, browser platform)

Add `--watch` mode support:
- When `process.argv.includes('--watch')`, run esbuild in watch mode
- Register an `onEnd` plugin that POSTs to `http://localhost:${PORT}/internal/rebuilt` after each successful build
- The POST must silently swallow `ECONNREFUSED` errors — the server may not be up yet during the very first build pass

### `package.json` script

```json
"dev:standalone": "node esbuild.config.js && node out/standalone/server.js"
```

The initial `node esbuild.config.js` (no `--watch`) produces the first build synchronously. Then `server.js` starts and internally spawns `node esbuild.config.js --watch` as a child process. This guarantees all bundles exist before the HTTP server accepts connections.

---

## Watch Mode / Hot Reload Flow

```
1. Developer edits src/webview/toolbar.ts
2. esbuild --watch detects file change
3. Rebuilds webview/main.js (and inject.js)
4. onEnd plugin POSTs to /internal/rebuilt
5. Server pushes { type: '__standalone_reload' } via SSE to all clients
6. vscode-shim.ts receives SSE event → location.reload()
7. Browser reloads with fresh bundle in ~100-200ms
```

---

## Scope Boundaries

**In scope:**
- Full proxy browsing (real URLs through the proxy server)
- Element inspection, console capture, screenshot (all inject-script features)
- Context extraction and clipboard delivery
- Hot reload on webview source changes
- Toolbar, mode toggles, URL bar — all visual/UI iteration

**Out of scope (by design):**
- Backend adapters other than clipboard (Claude Code, Codex, OpenCode, OpenChamber) — these require VS Code extension APIs to execute shell commands. They are disabled/logged-only in standalone mode.
- VS Code theme integration — standalone runs with a fixed light/dark theme via CSS variables
- Extension command palette, keybindings — not applicable outside VS Code

---

## Testing

- Existing unit tests (`vitest`) remain unaffected — standalone files are isolated
- Manual smoke test: `npm run dev:standalone` → navigate to `http://localhost:3000` → browse a local dev server URL → inspect an element → copy context to clipboard
- No new automated tests required for the standalone server itself (it is dev tooling)

---

## Risk: Shim Divergence

The one ongoing maintenance cost: if new `ExtensionMessage` or `WebviewMessage` types are added to `src/types.ts`, the standalone server's message router must be updated to handle them. This is low-risk as long as types.ts is the single source of truth and a TypeScript-typed handler switch is used in `server.ts` (the compiler will warn on unhandled union members).
