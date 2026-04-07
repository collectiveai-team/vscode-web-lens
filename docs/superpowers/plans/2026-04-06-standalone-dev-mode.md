# Standalone Dev Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npm run dev:standalone` that serves the web-lens UI at `http://127.0.0.1:3000`, runs the real proxy, and hot-reloads on source changes — no VS Code required.

**Architecture:** A thin Node.js HTTP server (`src/standalone/server.ts`) replaces the extension host: it starts `ProxyServer`, serves static assets, routes `WebviewMessage`s from fetch POSTs, and pushes `ExtensionMessage`s via SSE. A browser shim (`src/standalone/vscode-shim.ts`) provides `acquireVsCodeApi()` over SSE + fetch, so `src/webview/*.ts` is **zero-diff**. esbuild watch mode rebuilds on file changes and notifies the server to broadcast a reload signal.

**Tech Stack:** Node.js built-ins (http, fs, path, child_process), esbuild 0.24 context API, EventSource (browser), fetch (browser)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/standalone/console-logger.ts` | `webLensLogger` stub using `console.*` — redirected by esbuild alias so `ProxyServer` works without a VS Code runtime |
| Create | `src/standalone/console-logger.test.ts` | Unit tests for the logger stub |
| Create | `src/standalone/vscode-shim.ts` | Browser IIFE: `acquireVsCodeApi()` over SSE+fetch, clipboard intercept, hot-reload intercept |
| Create | `src/standalone/index.html` | HTML template (no VS Code CSP nonce); `{{TARGET_ORIGIN}}` placeholder replaced per request |
| Create | `src/standalone/server.ts` | HTTP server: SSE, WebviewMessage routing, ProxyServer lifecycle, esbuild watch child process |
| Modify | `esbuild.config.js` | Watch mode via esbuild context API; standalone entry points; notify + alias plugins |
| Modify | `tsconfig.json` | Exclude `src/standalone/vscode-shim.ts` (browser file, type-checked by webview tsconfig) |
| Modify | `tsconfig.webview.json` | Include `src/standalone/vscode-shim.ts` for DOM type checking |
| Modify | `package.json` | Add `"dev:standalone"` script |

**Task order:** All new source files must exist before esbuild.config.js is updated to reference them (updating esbuild first fails the build verification step). Order: console-logger → vscode-shim → index.html → server → esbuild → tsconfigs/package.json → smoke test.

---

## Task 1: Create `src/standalone/console-logger.ts`

**Files:**
- Create: `src/standalone/console-logger.ts`
- Create: `src/standalone/console-logger.test.ts`

Exports the same `webLensLogger` interface as `src/logging.ts` but uses `console.*` instead of a VS Code OutputChannel. The esbuild alias plugin (Task 5) redirects `../logging` imports to this file when building the standalone server, so `ProxyServer` works without a VS Code runtime.

- [ ] **Step 1: Write the failing tests**

Create `src/standalone/console-logger.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { webLensLogger } from './console-logger';

describe('console-logger', () => {
  it('info() delegates to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    webLensLogger.info('hello', { x: 1 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('warn() delegates to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    webLensLogger.warn('oops');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('error() delegates to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    webLensLogger.error('boom', new Error('test'));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('show() does not throw', () => {
    expect(() => webLensLogger.show()).not.toThrow();
  });

  it('dispose() does not throw', () => {
    expect(() => webLensLogger.dispose()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --reporter=verbose src/standalone/console-logger.test.ts
```

Expected: fails with "Cannot find module './console-logger'"

- [ ] **Step 3: Implement `src/standalone/console-logger.ts`**

```typescript
// Console-based webLensLogger stub for standalone dev mode.
// Used instead of src/logging.ts when building src/standalone/server.ts,
// so the standalone server does not require the vscode runtime.

export const webLensLogger = {
  info(message: string, metadata?: unknown): void {
    if (metadata !== undefined) {
      console.log(`[info] ${message}`, metadata);
    } else {
      console.log(`[info] ${message}`);
    }
  },

  warn(message: string, metadata?: unknown): void {
    if (metadata !== undefined) {
      console.warn(`[warn] ${message}`, metadata);
    } else {
      console.warn(`[warn] ${message}`);
    }
  },

  error(message: string, metadata?: unknown): void {
    if (metadata !== undefined) {
      console.error(`[error] ${message}`, metadata);
    } else {
      console.error(`[error] ${message}`);
    }
  },

  show(): void {
    // No-op in standalone mode (no VS Code output channel)
  },

  dispose(): void {
    // No-op in standalone mode
  },
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --reporter=verbose src/standalone/console-logger.test.ts
```

Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/standalone/console-logger.ts src/standalone/console-logger.test.ts
git commit -m "feat(standalone): add console-logger stub for ProxyServer decoupling"
```

---

## Task 2: Create `src/standalone/vscode-shim.ts`

**Files:**
- Create: `src/standalone/vscode-shim.ts`

Browser IIFE loaded before `main.js` in `index.html`. Provides `window.acquireVsCodeApi()` backed by SSE + fetch. Intercepts two server-only message types — `copyToClipboard` (calls `navigator.clipboard.writeText`) and `__standalone_reload` (calls `location.reload`) — before forwarding all other messages as window `MessageEvent`s that `src/webview/main.ts` already listens for.

- [ ] **Step 1: Create `src/standalone/vscode-shim.ts`**

```typescript
// VS Code webview API shim for standalone dev mode.
//
// Provides acquireVsCodeApi() using:
//   - fetch POST /message  for webview → extension host direction
//   - EventSource /events  for extension host → webview direction
//
// Intercepts two special server-only message types before forwarding to webview:
//   - { type: 'copyToClipboard', text: string }  — calls navigator.clipboard.writeText()
//   - { type: '__standalone_reload' }             — calls location.reload()
//
// All other messages are synthesized as window MessageEvents so the existing
// webview code (src/webview/main.ts) receives them unchanged.

declare global {
  interface Window {
    acquireVsCodeApi(): {
      postMessage(msg: unknown): void;
      getState(): unknown;
      setState(state: unknown): void;
    };
  }
}

(function () {
  'use strict';

  // ── VS Code API ──────────────────────────────────────────────────────────
  window.acquireVsCodeApi = function () {
    return {
      postMessage(msg: unknown): void {
        fetch('/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg),
        }).catch(() => {
          // Fire-and-forget; swallow network errors silently
        });
      },
      getState(): unknown {
        try {
          return JSON.parse(sessionStorage.getItem('__vscode_state') || 'null');
        } catch {
          return null;
        }
      },
      setState(state: unknown): void {
        try {
          sessionStorage.setItem('__vscode_state', JSON.stringify(state));
        } catch {
          // Ignore storage errors
        }
      },
    };
  };

  // ── SSE → window MessageEvent bridge ─────────────────────────────────────
  const es = new EventSource('/events');

  es.onmessage = function (e: MessageEvent): void {
    let msg: { type: string; [key: string]: unknown };
    try {
      msg = JSON.parse(e.data as string) as { type: string; [key: string]: unknown };
    } catch {
      return;
    }

    // Intercept: clipboard write must happen in a browser context
    if (msg.type === 'copyToClipboard') {
      navigator.clipboard.writeText(msg.text as string).catch(() => {
        // Clipboard may be unavailable in some browser security contexts
      });
      return;
    }

    // Intercept: hot-reload signal sent by esbuild onEnd plugin
    if (msg.type === '__standalone_reload') {
      location.reload();
      return;
    }

    // Forward all other extension messages as a window MessageEvent.
    // src/webview/main.ts listens on window for these.
    window.dispatchEvent(new MessageEvent('message', { data: msg }));
  };

  es.onerror = function (): void {
    // EventSource auto-reconnects on error — no action needed
  };
})();
```

- [ ] **Step 2: Commit**

```bash
git add src/standalone/vscode-shim.ts
git commit -m "feat(standalone): add vscode-shim providing acquireVsCodeApi over SSE+fetch"
```

---

## Task 3: Create `src/standalone/index.html`

**Files:**
- Create: `src/standalone/index.html`

HTML template served at `GET /` by the standalone server. The server replaces `{{TARGET_ORIGIN}}` before sending. Structure mirrors `BrowserPanelManager.getHtmlForWebview()` but without VS Code CSP nonces; icons reference server-relative paths.

- [ ] **Step 1: Create `src/standalone/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src 'unsafe-inline' https://fonts.googleapis.com;
    font-src https://fonts.gstatic.com;
    script-src 'self';
    frame-src http: https:;
    img-src https: data: http: blob:;
    connect-src http: https:;
  ">
  <link
    href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
    rel="stylesheet"
  >
  <link href="/webview/main.css" rel="stylesheet">
  <title>Web Lens Dev</title>
</head>
<body data-theme="dark" data-target-origin="{{TARGET_ORIGIN}}">
  <div id="backend-icons" hidden
    data-opencode-light="/media/icons/opencode-light.svg"
    data-opencode-dark="/media/icons/opencode-dark.svg"
    data-openchamber-light="/media/icons/openchamber-light.svg"
    data-openchamber-dark="/media/icons/openchamber-dark.svg"
    data-codex-light="/media/icons/codex-light.svg"
    data-codex-dark="/media/icons/codex-dark.svg"
    data-claudecode-light="/media/icons/claudecode-light.svg"
    data-claudecode-dark="/media/icons/claudecode-dark.svg"
  ></div>
  <div id="toolbar"></div>
  <div id="browser-frame">
    <iframe
      id="browser-iframe"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    ></iframe>
  </div>
  <!-- Shim must load before main.js so acquireVsCodeApi() is defined -->
  <script src="/vscode-shim.js"></script>
  <script src="/webview/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/standalone/index.html
git commit -m "feat(standalone): add HTML template for standalone dev mode"
```

---

## Task 4: Create `src/standalone/server.ts`

**Files:**
- Create: `src/standalone/server.ts`

HTTP server using only Node.js built-ins. Manages: ProxyServer lifecycle, SSE client registry, all 17 WebviewMessage types (navigation history, context delivery, backend state), static file serving, and esbuild watch child process spawning.

- [ ] **Step 1: Create `src/standalone/server.ts`**

```typescript
/**
 * Standalone dev server for web-lens.
 *
 * Replaces the VS Code extension host with a plain Node.js HTTP server so the
 * webview UI can be developed and tested in any browser without VS Code.
 *
 * Usage (via package.json script):
 *   npm run dev:standalone
 *
 * Environment variables:
 *   PORT        HTTP port for this server (default: 3000)
 *   TARGET_URL  URL of the local app to proxy (default: http://localhost:3000)
 *
 * Note: changes to this file require restarting the dev server process.
 * All other source files hot-reload automatically via esbuild --watch.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { ProxyServer } from '../proxy/ProxyServer';
import { ContextExtractor } from '../context/ContextExtractor';
import type { WebviewMessage, ExtensionMessage } from '../types';

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);
const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000';

// __dirname is out/standalone/ after esbuild compilation
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// ── SSE client registry ───────────────────────────────────────────────────────

const sseClients = new Set<http.ServerResponse>();

type BroadcastMessage =
  | ExtensionMessage
  | { type: 'copyToClipboard'; text: string }
  | { type: '__standalone_reload' };

function broadcast(msg: BroadcastMessage): void {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ── Static file helpers ───────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.js':   'application/javascript',
  '.map':  'application/json',
  '.css':  'text/css',
  '.html': 'text/html; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.json': 'application/json',
};

function serveFile(res: http.ServerResponse, filePath: string): void {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── Backend state ─────────────────────────────────────────────────────────────
// Only clipboard is available in standalone mode.

const STANDALONE_BACKEND_STATE: ExtensionMessage = {
  type: 'backend:state',
  payload: {
    active: 'clipboard',
    available: {
      clipboard: true,
      opencode: false,
      openchamber: false,
      codex: false,
      claudecode: false,
    },
  },
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Start proxy server (same ProxyServer used by the VS Code extension)
  const proxy = new ProxyServer(PROJECT_ROOT, TARGET_URL);
  await proxy.start();
  console.log(`[standalone] Proxy started → ${proxy.getTargetOrigin()} via 127.0.0.1:${proxy.getPort()}`);

  const contextExtractor = new ContextExtractor();

  // Load HTML template once; {{TARGET_ORIGIN}} replaced per request
  const htmlTemplate = fs.readFileSync(
    path.join(__dirname, '../../src/standalone/index.html'),
    'utf8'
  );

  // Navigation history — mirrors BrowserPanelManager state
  const history: string[] = [TARGET_URL];
  let historyIndex = 0;
  let currentUrl = TARGET_URL;

  // ── WebviewMessage router ─────────────────────────────────────────────────

  function handleMessage(message: WebviewMessage): void {
    switch (message.type) {

      case 'navigate': {
        history.splice(historyIndex + 1);
        history.push(message.payload.url);
        historyIndex = history.length - 1;
        currentUrl = message.payload.url;
        broadcast({ type: 'navigate:url', payload: { url: proxy.getProxiedUrl(currentUrl) } });
        break;
      }

      case 'nav:back': {
        if (historyIndex > 0) {
          historyIndex--;
          currentUrl = history[historyIndex];
          broadcast({ type: 'navigate:url', payload: { url: proxy.getProxiedUrl(currentUrl) } });
        }
        break;
      }

      case 'nav:forward': {
        if (historyIndex < history.length - 1) {
          historyIndex++;
          currentUrl = history[historyIndex];
          broadcast({ type: 'navigate:url', payload: { url: proxy.getProxiedUrl(currentUrl) } });
        }
        break;
      }

      case 'nav:reload': {
        broadcast({ type: 'navigate:url', payload: { url: proxy.getProxiedUrl(currentUrl) } });
        break;
      }

      case 'iframe:loaded': {
        // SPA navigation or server redirect — convert proxy-space URL back to target-space
        const original = proxy.getOriginalUrl(message.payload.url);
        if (original !== currentUrl) {
          history.splice(historyIndex + 1);
          history.push(original);
          historyIndex = history.length - 1;
          currentUrl = original;
        }
        break;
      }

      case 'iframe:error': {
        broadcast({
          type: 'toast',
          payload: { message: `Failed to load: ${message.payload.error}`, toastType: 'error' },
        });
        break;
      }

      case 'menu:copyHtml': {
        broadcast({ type: 'copyToClipboard', text: message.payload.html });
        broadcast({ type: 'toast', payload: { message: 'HTML copied to clipboard', toastType: 'success' } });
        break;
      }

      case 'menu:openSettings': {
        broadcast({ type: 'toast', payload: { message: 'Settings not available in standalone mode', toastType: 'error' } });
        break;
      }

      case 'menu:clearSelection': {
        // Handled in webview overlay — no server action needed
        break;
      }

      case 'inspect:selected': {
        // Inspect overlay state is managed in the webview — no server action needed
        break;
      }

      // Context delivery — build ContextBundle, serialize to clipboard as JSON
      case 'inspect:sendToChat':
      case 'addElement:captured': {
        const bundle = contextExtractor.fromCapturedElement(message.payload, currentUrl);
        broadcast({ type: 'copyToClipboard', text: JSON.stringify(bundle, null, 2) });
        broadcast({ type: 'toast', payload: { message: 'Context copied to clipboard', toastType: 'success' } });
        break;
      }

      case 'action:addLogs': {
        const bundle = contextExtractor.fromLogs(message.payload.logs, currentUrl);
        broadcast({ type: 'copyToClipboard', text: JSON.stringify(bundle, null, 2) });
        broadcast({ type: 'toast', payload: { message: 'Logs copied to clipboard', toastType: 'success' } });
        break;
      }

      case 'action:screenshot': {
        const bundle = contextExtractor.fromScreenshot(message.payload.dataUrl, 0, 0, currentUrl);
        broadcast({ type: 'copyToClipboard', text: JSON.stringify(bundle, null, 2) });
        broadcast({ type: 'toast', payload: { message: 'Screenshot copied to clipboard', toastType: 'success' } });
        break;
      }

      case 'backend:request': {
        broadcast(STANDALONE_BACKEND_STATE);
        break;
      }

      case 'backend:select': {
        // Only clipboard works in standalone; always reply with clipboard-only state
        broadcast(STANDALONE_BACKEND_STATE);
        break;
      }

      case 'diagnostic:log': {
        const { level, source, message: msg } = message.payload;
        const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        logFn(`[${source}] ${msg}`);
        break;
      }
    }
  }

  // ── Static file map: URL path → filesystem path ───────────────────────────

  const STATIC: Record<string, string> = {
    '/webview/main.js':        path.join(PROJECT_ROOT, 'webview/main.js'),
    '/webview/main.js.map':    path.join(PROJECT_ROOT, 'webview/main.js.map'),
    '/webview/main.css':       path.join(PROJECT_ROOT, 'webview/main.css'),
    '/out/inject.js':          path.join(PROJECT_ROOT, 'out/inject.js'),
    '/vscode-shim.js':         path.join(PROJECT_ROOT, 'out/standalone/vscode-shim.js'),
    '/vscode-shim.js.map':     path.join(PROJECT_ROOT, 'out/standalone/vscode-shim.js.map'),
  };

  // ── HTTP server ───────────────────────────────────────────────────────────

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';

    res.setHeader('Access-Control-Allow-Origin', '*');

    // SSE stream: extension → browser
    if (url === '/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
      });
      sseClients.add(res);

      // Bootstrap: send backend state so toolbar renders immediately
      res.write(`data: ${JSON.stringify(STANDALONE_BACKEND_STATE)}\n\n`);
      // Bootstrap: navigate iframe to initial URL
      const initNav: ExtensionMessage = {
        type: 'navigate:url',
        payload: { url: proxy.getProxiedUrl(TARGET_URL) },
      };
      res.write(`data: ${JSON.stringify(initNav)}\n\n`);

      req.on('close', () => { sseClients.delete(res); });
      return;
    }

    // Message endpoint: browser → extension
    if (url === '/message' && method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          handleMessage(JSON.parse(body) as WebviewMessage);
        } catch {
          // Ignore malformed messages
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }

    // Internal: esbuild rebuild notification → broadcast hot-reload to browsers
    if (url === '/internal/rebuilt' && method === 'POST') {
      broadcast({ type: '__standalone_reload' });
      res.writeHead(204);
      res.end();
      return;
    }

    // Static files: GET only from here
    if (method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }

    // Root → HTML template with target origin injected
    if (url === '/') {
      const html = htmlTemplate.replace('{{TARGET_ORIGIN}}', proxy.getTargetOrigin());
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // Backend icons
    if (url.startsWith('/media/icons/')) {
      const iconName = url.replace('/media/icons/', '');
      // Reject path traversal attempts
      if (iconName.includes('..') || iconName.includes('/')) {
        res.writeHead(400); res.end(); return;
      }
      serveFile(res, path.join(PROJECT_ROOT, 'media', 'icons', iconName));
      return;
    }

    // Other known static files
    if (STATIC[url]) {
      serveFile(res, STATIC[url]);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[standalone] Web Lens dev server → http://127.0.0.1:${PORT}`);
    console.log(`[standalone] Open that URL in your browser`);
    console.log(`[standalone] Proxying ${proxy.getTargetOrigin()}`);
    console.log('[standalone] Watching src/ for changes (hot reload active)...');
  });

  // ── esbuild watch child process ───────────────────────────────────────────
  // Spawned after the HTTP server is up so the first /internal/rebuilt POST
  // (from the initial watch build) has a server to land on.

  const esbuildProc = spawn('node', ['esbuild.config.js', '--watch'], {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT) },
  });

  esbuildProc.on('error', (err: Error) => {
    console.error('[standalone] esbuild watch failed to start:', err.message);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  process.on('SIGINT', () => {
    console.log('\n[standalone] Shutting down...');
    esbuildProc.kill('SIGINT');
    proxy.stop().finally(() => {
      server.close();
      process.exit(0);
    });
  });
}

main().catch((err: unknown) => {
  console.error('[standalone] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/standalone/server.ts
git commit -m "feat(standalone): add HTTP dev server with SSE, message routing, and proxy lifecycle"
```

---

## Task 5: Rewrite `esbuild.config.js`

**Files:**
- Modify: `esbuild.config.js`

All four new standalone source files exist at this point. Rewrites esbuild.config.js to:
1. Support `--watch` flag using esbuild's context API (esbuild 0.24)
2. Add two new entry points: `vscode-shim.ts` and `server.ts`
3. Add a `notifyPlugin` that POSTs to `/internal/rebuilt` after each watch rebuild
4. Add a `loggingAliasPlugin` that redirects `../logging` imports to the console stub in the server bundle

- [ ] **Step 1: Replace `esbuild.config.js` entirely**

```javascript
const esbuild = require('esbuild');
const http = require('http');
const path = require('path');

const production = process.argv.includes('--production');
const watchMode = process.argv.includes('--watch');
const PORT = parseInt(process.env.PORT || '3000', 10);

// After each rebuild in watch mode, notify the standalone dev server so it can
// broadcast a hot-reload signal to connected browsers.
// Silently swallows ECONNREFUSED — server may not be up on the very first pass.
function makeNotifyPlugin() {
  return {
    name: 'notify-standalone',
    setup(build) {
      build.onEnd(() => {
        if (!watchMode) { return; }
        const req = http.request(
          { hostname: '127.0.0.1', port: PORT, path: '/internal/rebuilt', method: 'POST' },
          () => {}
        );
        req.on('error', () => {}); // swallow ECONNREFUSED
        req.end();
      });
    },
  };
}

// Redirect any import ending with /logging (the VS Code OutputChannel-based logger)
// to the console-based stub when building the standalone server bundle.
// This prevents require('vscode') from appearing in the standalone server at runtime.
const loggingAliasPlugin = {
  name: 'alias-logging',
  setup(build) {
    build.onResolve({ filter: /[/\\]logging$/ }, () => ({
      path: path.resolve(__dirname, 'src/standalone/console-logger.ts'),
    }));
  },
};

async function main() {
  const shared = { sourcemap: !production, minify: production };

  const configs = [
    // Extension host — runs in VS Code's Node.js process
    {
      entryPoints: ['./src/extension.ts'],
      bundle: true, outfile: './out/extension.js',
      external: ['vscode'], format: 'cjs', platform: 'node', target: 'node20',
      plugins: [makeNotifyPlugin()],
      ...shared,
    },
    // Webview bundle — runs in VS Code's sandboxed WebviewPanel
    {
      entryPoints: ['./src/webview/main.ts'],
      bundle: true, outfile: './webview/main.js',
      format: 'iife', platform: 'browser', target: 'es2022',
      plugins: [makeNotifyPlugin()],
      ...shared,
    },
    // Inject script — served by proxy into target pages
    {
      entryPoints: ['./src/webview/inject.ts'],
      bundle: true, outfile: './out/inject.js',
      format: 'iife', platform: 'browser', target: 'es2022',
      plugins: [makeNotifyPlugin()],
      ...shared,
    },
    // Standalone shim — provides acquireVsCodeApi() over SSE+fetch in a plain browser
    {
      entryPoints: ['./src/standalone/vscode-shim.ts'],
      bundle: true, outfile: './out/standalone/vscode-shim.js',
      format: 'iife', platform: 'browser', target: 'es2022',
      plugins: [makeNotifyPlugin()],
      ...shared,
    },
    // Standalone server — replaces the VS Code extension host for local dev
    {
      entryPoints: ['./src/standalone/server.ts'],
      bundle: true, outfile: './out/standalone/server.js',
      external: ['vscode'], format: 'cjs', platform: 'node', target: 'node20',
      plugins: [loggingAliasPlugin],
      ...shared,
    },
  ];

  if (watchMode) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[esbuild] Watching for changes... (Ctrl+C to stop)');
    // Process keeps running until killed by the standalone server's SIGINT handler
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
    console.log('Build complete');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run a full build to verify all five bundles compile**

```bash
npm run build 2>&1 | grep -E "error|Build complete"
```

Expected: only "Build complete" — no type errors, no import resolution failures.

Verify the new output files exist:

```bash
ls out/standalone/
```

Expected: `server.js  server.js.map  vscode-shim.js  vscode-shim.js.map`

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass (same count as before this task)

- [ ] **Step 4: Commit**

```bash
git add esbuild.config.js
git commit -m "feat(standalone): add watch mode and standalone entry points to esbuild"
```

---

## Task 6: Update `tsconfig.json`, `tsconfig.webview.json`, and `package.json`

**Files:**
- Modify: `tsconfig.json`
- Modify: `tsconfig.webview.json`
- Modify: `package.json`

`tsconfig.json` includes `src/**/*.ts` but has `"lib": ["ES2022"]` with no DOM types. `src/standalone/vscode-shim.ts` uses `EventSource`, `navigator.clipboard`, and `location` — it must be excluded from the Node.js tsconfig and instead type-checked by `tsconfig.webview.json` (which has DOM libs).

- [ ] **Step 1: Exclude `vscode-shim.ts` from `tsconfig.json`**

In `tsconfig.json`, change the `exclude` array:

From:
```json
"exclude": ["node_modules", "out", "webview", "src/webview"]
```

To:
```json
"exclude": ["node_modules", "out", "webview", "src/webview", "src/standalone/vscode-shim.ts"]
```

- [ ] **Step 2: Include `vscode-shim.ts` in `tsconfig.webview.json`**

In `tsconfig.webview.json`, change the `include` array:

From:
```json
"include": ["src/webview/**/*.ts", "src/types.ts"]
```

To:
```json
"include": ["src/webview/**/*.ts", "src/standalone/vscode-shim.ts", "src/types.ts"]
```

- [ ] **Step 3: Add `dev:standalone` to `package.json` scripts**

In `package.json`, in the `"scripts"` block, add after `"build:prod"`:

```json
"dev:standalone": "node esbuild.config.js && node out/standalone/server.js",
```

The first command builds all bundles (including `out/standalone/server.js`). The second starts the server, which internally spawns `node esbuild.config.js --watch` for hot reload.

- [ ] **Step 4: Run typecheck to verify no new type errors**

```bash
npm run typecheck
```

Expected: exits 0 with no error output. If errors appear, fix them before proceeding.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json tsconfig.webview.json package.json
git commit -m "feat(standalone): wire tsconfigs and add dev:standalone npm script"
```

---

## Task 7: Smoke Test

No automated test — the standalone server is dev tooling. Verify manually.

**Prerequisite:** have something running on `http://localhost:3000`. If you don't have a local app handy, `python3 -m http.server 3000` from any directory with an HTML file works.

- [ ] **Step 1: Start the standalone server**

```bash
npm run dev:standalone
```

Expected output within ~5 seconds:

```
Build complete
[standalone] Proxy started → http://localhost:3000 via 127.0.0.1:<proxy-port>
[standalone] Web Lens dev server → http://127.0.0.1:3000
[standalone] Open that URL in your browser
[standalone] Proxying http://localhost:3000
[standalone] Watching src/ for changes (hot reload active)...
[esbuild] Watching for changes... (Ctrl+C to stop)
```

- [ ] **Step 2: Verify the UI loads in a browser**

Open `http://127.0.0.1:3000`.

Expected:
- Web Lens toolbar renders (URL bar, navigation buttons, mode toggles, backend selector)
- Backend selector shows only "Clipboard" as active and available (all others greyed out)
- The iframe loads through the proxy (URL bar shows a `127.0.0.1:<proxy-port>` address)

- [ ] **Step 3: Test context copy (clipboard flow)**

1. Click the Inspect button in the toolbar
2. Hover over an element in the iframe — highlight overlay appears
3. Click an element to select it
4. Click "Send to Chat" (or the add-element button)

Expected: browser clipboard permission prompt appears (or writes silently if already granted). After granting, the context JSON is in the clipboard. A success toast appears. Console shows no errors.

- [ ] **Step 4: Test hot reload**

Make a trivial visible change in `src/webview/toolbar.ts` — for example change a tooltip string or button label.

Expected: within ~1 second the browser page reloads automatically and the change is visible. No manual rebuild or page refresh needed.

- [ ] **Step 5: Test graceful shutdown**

Press `Ctrl+C` in the terminal running `dev:standalone`.

Expected: `[standalone] Shutting down...` printed, then the process exits cleanly (no hanging).

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass (count is at least 102: 97 original + 5 from Task 1).

- [ ] **Step 7: Commit any fixes from smoke testing**

If any issues were discovered and fixed during smoke testing:

```bash
git add -A
git commit -m "fix(standalone): smoke test corrections"
```

---

## Notes for Implementer

**Server source changes require restart:** esbuild watch rebuilds `out/standalone/server.js` and broadcasts a browser hot-reload when `server.ts` changes — but that reloads the *browser*, not the Node.js server process itself. For server-side changes: `Ctrl+C` then `npm run dev:standalone` again.

**Changing the proxy target:** `TARGET_URL=http://localhost:4000 npm run dev:standalone`

**Changing the port:** `PORT=8080 npm run dev:standalone` — both the HTTP server and the esbuild notify plugin read `PORT` from the environment, so they stay in sync.

**Theme:** The HTML template hardcodes `data-theme="dark"`. To use light theme: open DevTools → Console → `document.body.dataset.theme = 'light'`.

**Spec:** `docs/superpowers/specs/2026-04-06-standalone-dev-mode-design.md`
