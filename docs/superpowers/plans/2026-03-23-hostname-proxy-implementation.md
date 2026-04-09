# Hostname-Based Reverse Proxy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the query-parameter proxy (`?url=encoded`) with a hostname-based reverse proxy that forwards all requests from `127.0.0.1:port/path` to the configured target origin, eliminating the origin mismatch that breaks SPA frameworks, HMR, and API requests.

**Architecture:** The proxy stores a target origin (e.g., `http://localhost:3000`) and transparently forwards every request (any HTTP method, any path) to that target. HTML responses are buffered for script injection; everything else streams through. WebSocket upgrades are handled via raw TCP socket piping. Console capture moves from the webview into the inject script. SPA navigation is detected by wrapping pushState/replaceState in the inject script.

**Tech Stack:** Node.js `http`, `net`, `https` modules. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-20-router-safe-proxy-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src/proxy/ProxyServer.ts` | HTTP reverse proxy: forward requests, inject scripts into HTML, handle WebSocket upgrades | Rewrite |
| `src/proxy/ProxyServer.test.ts` | Unit tests for proxy: URL mapping, header stripping, HTML injection, request forwarding | Rewrite |
| `src/webview/inject.ts` | Page instrumentation: element inspection, screenshots, console capture, SPA navigation detection | Modify (add console capture + navigation detection + nested iframe guard) |
| `src/webview/console-capture.ts` | Message-based console entry receiver (listens for `bc:console` postMessages, buffers entries) | Rewrite (remove monkey-patching, become message receiver) |
| `src/webview/main.ts` | Webview entry point: toolbar, iframe management, message routing | Modify (update URL extraction, wire `bc:console`/`bc:navigated` listeners, remove direct console patching) |
| `src/panel/BrowserPanelManager.ts` | Panel lifecycle, navigation history, proxy integration | Modify (pass target origin to ProxyServer, update `getProxiedUrl` usage) |
| `src/types.ts` | Message protocol types | Modify (add `bc:console` and `bc:navigated` to documentation comments) |

---

## Chunk 1: ProxyServer Rewrite + Tests

**Preservation note:** The existing `start`, `stop`, `getPort`, `stripHopByHopHeaders`, `serveInjectScript`, `sendError`, and `escapeHtml` methods are preserved as-is unless explicitly mentioned in a task. Only `handleRequest`, `proxyRequest`, `injectScript`, `rewriteUrls`, and the constructor/URL methods are changed.

### Task 1: Rewrite ProxyServer constructor and URL mapping

**Files:**
- Modify: `src/proxy/ProxyServer.ts:15-73`
- Test: `src/proxy/ProxyServer.test.ts`

- [ ] **Step 1: Write failing tests for new constructor and URL mapping**

In `src/proxy/ProxyServer.test.ts`, replace the entire file with:

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('../logging', () => ({
  webLensLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  },
}));

import { ProxyServer } from './ProxyServer';

describe('ProxyServer', () => {
  describe('URL mapping', () => {
    it('getProxiedUrl replaces target origin with proxy origin', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000');
      (server as any).port = 9000;

      expect(server.getProxiedUrl('http://localhost:3000/dashboard?tab=1'))
        .toBe('http://127.0.0.1:9000/dashboard?tab=1');
    });

    it('getProxiedUrl handles root path', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000');
      (server as any).port = 9000;

      expect(server.getProxiedUrl('http://localhost:3000/'))
        .toBe('http://127.0.0.1:9000/');
    });

    it('getProxiedUrl handles path with fragment', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000');
      (server as any).port = 9000;

      expect(server.getProxiedUrl('http://localhost:3000/page#section'))
        .toBe('http://127.0.0.1:9000/page#section');
    });

    it('getOriginalUrl replaces proxy origin with target origin', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000');
      (server as any).port = 9000;

      expect(server.getOriginalUrl('http://127.0.0.1:9000/dashboard?tab=1'))
        .toBe('http://localhost:3000/dashboard?tab=1');
    });

    it('getOriginalUrl returns input unchanged if not a proxy URL', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000');
      (server as any).port = 9000;

      expect(server.getOriginalUrl('http://example.com/page'))
        .toBe('http://example.com/page');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/proxy/ProxyServer.test.ts`
Expected: FAIL — `ProxyServer` constructor doesn't accept a target origin parameter yet, and `getOriginalUrl` doesn't exist.

- [ ] **Step 3: Implement new constructor, `getProxiedUrl`, and `getOriginalUrl`**

In `src/proxy/ProxyServer.ts`, replace the class fields and constructor (lines 15-22) with:

```typescript
export class ProxyServer {
  private server: http.Server | null = null;
  private port = 0;
  private injectScriptPath: string;
  private targetOrigin: string; // e.g. "http://localhost:3000"
  private targetHost: string;   // e.g. "localhost:3000"
  private targetHostname: string; // e.g. "localhost"
  private targetPort: number;    // e.g. 3000
  private targetIsHttps: boolean;

  constructor(extensionPath: string, targetOrigin: string) {
    this.injectScriptPath = path.join(extensionPath, 'out', 'inject.js');
    const parsed = new URL(targetOrigin);
    this.targetOrigin = `${parsed.protocol}//${parsed.host}`;
    this.targetHost = parsed.host;
    this.targetHostname = parsed.hostname;
    this.targetPort = parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 80);
    this.targetIsHttps = parsed.protocol === 'https:';
  }
```

Replace `getProxiedUrl` (line 71-73) with:

```typescript
  /** Build the proxied URL for a given target URL. */
  getProxiedUrl(targetUrl: string): string {
    const parsed = new URL(targetUrl);
    const proxyOrigin = `http://127.0.0.1:${this.port}`;
    return `${proxyOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  /** Convert a proxy-space URL back to the original target URL. */
  getOriginalUrl(proxyUrl: string): string {
    try {
      const parsed = new URL(proxyUrl);
      const proxyOrigin = `http://127.0.0.1:${this.port}`;
      if (`${parsed.protocol}//${parsed.host}` !== proxyOrigin) {
        return proxyUrl; // Not a proxy URL
      }
      return `${this.targetOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return proxyUrl;
    }
  }

  getTargetOrigin(): string {
    return this.targetOrigin;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/proxy/ProxyServer.test.ts`
Expected: PASS — all 5 URL mapping tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/ProxyServer.ts src/proxy/ProxyServer.test.ts
git commit -m "refactor(proxy): replace query-param URL model with hostname-based mapping"
```

---

### Task 2: Rewrite request handling (path-based forwarding, all HTTP methods)

**Files:**
- Modify: `src/proxy/ProxyServer.ts:75-199` (handleRequest + proxyRequest)
- Test: `src/proxy/ProxyServer.test.ts`

- [ ] **Step 1: Write failing tests for path-based request forwarding**

Add to the `describe('ProxyServer')` block in `src/proxy/ProxyServer.test.ts`:

```typescript
  describe('header handling', () => {
    it('strips hop-by-hop headers from response', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      const headers = {
        'content-type': 'text/html',
        'connection': 'keep-alive',
        'keep-alive': 'timeout=5',
        'transfer-encoding': 'chunked',
        'x-custom': 'value',
      };
      const cleaned = server.stripHopByHopHeaders(headers);
      expect(cleaned['connection']).toBeUndefined();
      expect(cleaned['keep-alive']).toBeUndefined();
      expect(cleaned['transfer-encoding']).toBeUndefined();
      expect(cleaned['x-custom']).toBe('value');
      expect(cleaned['content-type']).toBe('text/html');
    });

    it('strips Accept-Encoding from forwarded request headers', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      const headers = {
        'accept-encoding': 'gzip, deflate, br',
        'accept': 'text/html',
        'host': '127.0.0.1:9000',
        'sec-fetch-dest': 'document',
        'referer': 'http://127.0.0.1:9000/page',
        'origin': 'http://127.0.0.1:9000',
      };
      server.port = 9000;
      const cleaned = server.prepareRequestHeaders(headers);
      expect(cleaned['accept-encoding']).toBeUndefined();
      expect(cleaned['accept']).toBe('text/html');
      expect(cleaned['host']).toBe('localhost:3000');
      expect(cleaned['sec-fetch-dest']).toBeUndefined();
      expect(cleaned['referer']).toBe('http://localhost:3000/page');
      expect(cleaned['origin']).toBe('http://localhost:3000');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/proxy/ProxyServer.test.ts`
Expected: FAIL — `prepareRequestHeaders` method doesn't exist.

- [ ] **Step 3: Implement `prepareRequestHeaders` and rewrite `handleRequest`/`proxyRequest`**

Add the `prepareRequestHeaders` method to `ProxyServer`:

```typescript
  /**
   * Prepare client request headers for forwarding to the upstream target.
   * Rewrites Host, Referer, Origin; strips Accept-Encoding, Sec-Fetch-*, hop-by-hop.
   */
  private prepareRequestHeaders(clientHeaders: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {};
    const proxyOrigin = `http://127.0.0.1:${this.port}`;

    for (const [key, value] of Object.entries(clientHeaders)) {
      if (value === undefined) continue;

      const lower = key.toLowerCase();

      // Skip hop-by-hop headers
      if (['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer',
           'upgrade', 'proxy-authorization', 'proxy-authenticate'].includes(lower)) continue;

      // Strip Accept-Encoding so upstream sends uncompressed (we modify HTML)
      if (lower === 'accept-encoding') continue;

      // Strip Sec-Fetch-* (misleading proxy-origin metadata)
      if (lower.startsWith('sec-fetch-')) continue;

      // Rewrite Host
      if (lower === 'host') {
        headers['host'] = this.targetHost;
        continue;
      }

      // Rewrite Referer
      if (lower === 'referer' && typeof value === 'string') {
        headers['referer'] = value.replace(proxyOrigin, this.targetOrigin);
        continue;
      }

      // Rewrite Origin
      if (lower === 'origin' && typeof value === 'string') {
        headers['origin'] = value.replace(proxyOrigin, this.targetOrigin);
        continue;
      }

      headers[key] = value;
    }

    return headers;
  }
```

Replace `handleRequest` (lines 75-111) with:

```typescript
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // CORS headers on all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const requestPath = req.url || '/';

    // Serve internal endpoints
    if (requestPath.startsWith('/__web_lens/')) {
      if (requestPath === '/__web_lens/inject.js') {
        this.serveInjectScript(res);
      } else {
        this.sendError(res, 404, `Unknown internal endpoint: ${requestPath}`);
      }
      return;
    }

    this.proxyRequest(req, res);
  }
```

Replace `proxyRequest` (lines 126-199) with:

```typescript
  private proxyRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const requestPath = req.url || '/';
    webLensLogger.info('Proxy request started', { method: req.method, path: requestPath });

    const requestModule = this.targetIsHttps ? https : http;
    const headers = this.prepareRequestHeaders(req.headers);

    const options: http.RequestOptions = {
      hostname: this.targetHostname,
      port: this.targetPort,
      path: requestPath,
      method: req.method || 'GET',
      headers,
    };

    const proxyReq = requestModule.request(options, (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';
      const statusCode = proxyRes.statusCode || 200;
      const isHtml = contentType.includes('text/html');
      const isRedirect = statusCode >= 300 && statusCode < 400 && proxyRes.headers['location'];

      // Handle redirects: rewrite Location header
      if (isRedirect) {
        const location = proxyRes.headers['location']!;
        const rewrittenHeaders = this.stripHopByHopHeaders(proxyRes.headers);
        delete rewrittenHeaders['x-frame-options'];
        delete rewrittenHeaders['content-security-policy'];
        rewrittenHeaders['location'] = this.rewriteLocationHeader(location as string, requestPath);
        res.writeHead(statusCode, rewrittenHeaders);
        proxyRes.pipe(res);
        return;
      }

      if (isHtml) {
        // Buffer the HTML so we can inject our script
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf-8');
          html = this.injectScript(html);
          webLensLogger.info('Proxy HTML response', { path: requestPath, statusCode });

          const responseHeaders = this.stripHopByHopHeaders(proxyRes.headers);
          delete responseHeaders['content-length'];
          delete responseHeaders['content-encoding'];
          delete responseHeaders['content-security-policy'];
          delete responseHeaders['content-security-policy-report-only'];
          delete responseHeaders['x-frame-options'];

          res.writeHead(statusCode, responseHeaders);
          res.end(html);
        });
      } else {
        webLensLogger.info('Proxy asset response', { path: requestPath, statusCode, contentType });
        const responseHeaders = this.stripHopByHopHeaders(proxyRes.headers);
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['content-security-policy'];
        res.writeHead(statusCode, responseHeaders);
        proxyRes.pipe(res);
      }
    });

    proxyReq.on('error', (err) => {
      webLensLogger.error('Proxy request failed', { path: requestPath, error: err.message });
      this.sendError(res, 502, `Failed to reach ${this.targetOrigin}${requestPath}: ${err.message}`);
    });

    proxyReq.setTimeout(10000, () => {
      proxyReq.destroy();
      webLensLogger.error('Proxy request timed out', { path: requestPath });
      this.sendError(res, 504, `Request to ${this.targetOrigin}${requestPath} timed out`);
    });

    // Pipe request body for POST/PUT/PATCH
    if (req.method && ['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())) {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  }
```

- [ ] **Step 4: Implement `rewriteLocationHeader`**

Add this method to `ProxyServer`:

```typescript
  /**
   * Rewrite a redirect Location header.
   * Same-origin absolute URLs are mapped back to proxy-space.
   * Relative URLs are left as-is (browser resolves against proxy origin).
   */
  private rewriteLocationHeader(location: string, _requestPath: string): string {
    // Absolute URL pointing to target origin → rewrite to proxy-space
    if (location.startsWith(this.targetOrigin)) {
      const path = location.slice(this.targetOrigin.length);
      return path || '/';
    }
    // Relative or cross-origin — leave unchanged
    return location;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/proxy/ProxyServer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/proxy/ProxyServer.ts src/proxy/ProxyServer.test.ts
git commit -m "refactor(proxy): path-based forwarding with all HTTP methods and header rewriting"
```

---

### Task 3: Simplify HTML injection (remove URL rewriting, remove history patch)

**Files:**
- Modify: `src/proxy/ProxyServer.ts` (injectScript, delete rewriteUrls)
- Test: `src/proxy/ProxyServer.test.ts`

- [ ] **Step 1: Write failing test for simplified injection**

Add to the test file:

```typescript
  describe('HTML injection', () => {
    it('injects bootstrap and inject script before first app script', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      server.port = 9000;

      const html = `<!DOCTYPE html>
<html>
<head>
  <script src="/_next/static/chunks/main-app.js"></script>
</head>
<body><div id="app"></div></body>
</html>`;

      const injected = server.injectScript(html);

      // Bootstrap script is present
      expect(injected).toContain("window.addEventListener('error'");
      // Inject script uses new internal path
      expect(injected).toContain('/__web_lens/inject.js');
      // Bootstrap comes before app script
      expect(injected.indexOf("window.addEventListener('error'"))
        .toBeLessThan(injected.indexOf('/_next/static/chunks/main-app.js'));
    });

    it('does NOT inject base tag or rewrite URLs', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      server.port = 9000;

      const html = `<!DOCTYPE html>
<html>
<head></head>
<body><a href="/about">About</a></body>
</html>`;

      const injected = server.injectScript(html);

      // No base tag injected
      expect(injected).not.toContain('<base');
      // href is NOT rewritten (stays as /about, not proxied)
      expect(injected).toContain('href="/about"');
    });

    it('does NOT contain history pushState/replaceState monkey-patch', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      server.port = 9000;

      const html = '<html><head></head><body></body></html>';
      const injected = server.injectScript(html);

      expect(injected).not.toContain('patchHistory');
      expect(injected).not.toContain('SecurityError');
    });
  });

  describe('redirect rewriting', () => {
    it('rewrites same-origin absolute Location to proxy-space', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      server.port = 9000;

      const result = server.rewriteLocationHeader('http://localhost:3000/login', '/');
      expect(result).toBe('/login');
    });

    it('leaves relative Location unchanged', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      server.port = 9000;

      const result = server.rewriteLocationHeader('/other', '/page');
      expect(result).toBe('/other');
    });

    it('leaves cross-origin Location unchanged', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      server.port = 9000;

      const result = server.rewriteLocationHeader('https://auth.example.com/login', '/');
      expect(result).toBe('https://auth.example.com/login');
    });
  });
```

- [ ] **Step 2: Run tests to verify some fail**

Run: `npx vitest run src/proxy/ProxyServer.test.ts`
Expected: FAIL — inject script path still uses `/__bc_inject.js`, history patch is still present.

- [ ] **Step 3: Simplify `injectScript` and delete `rewriteUrls`**

Replace `injectScript` method. The bootstrap script is simplified — no more history monkey-patch:

```typescript
  /** Inject our inspect script before the first <script> tag (or at end of document). */
  private injectScript(html: string): string {
    const externalScriptTag = `<script src="/__web_lens/inject.js"></script>`;
    const bootstrapScriptTag = `<script>(function(){var post=function(level,message,details){try{window.parent.postMessage({type:'bc:diagnostic',payload:{source:'page.bootstrap',level:level,message:message,details:details}},'*');}catch{}};var format=function(value){if(value instanceof Error){return value.stack||value.message;}if(typeof value==='string'){return value;}try{return JSON.stringify(value);}catch{return String(value);}};window.addEventListener('error',function(event){post('error',event.message||'Unhandled page error',format(event.error||event.filename||window.location.href));});window.addEventListener('unhandledrejection',function(event){post('error','Unhandled promise rejection',format(event.reason));});post('info','Bootstrap attached',window.location.href);})();</script>`;
    const injection = `${bootstrapScriptTag}${externalScriptTag}`;

    const firstScriptIndex = html.search(/<script\b/i);
    if (firstScriptIndex !== -1) {
      return html.slice(0, firstScriptIndex) + injection + html.slice(firstScriptIndex);
    }

    const headOpenIndex = html.search(/<head[^>]*>/i);
    if (headOpenIndex !== -1) {
      const headCloseAngle = html.indexOf('>', headOpenIndex);
      if (headCloseAngle !== -1) {
        return html.slice(0, headCloseAngle + 1) + injection + html.slice(headCloseAngle + 1);
      }
    }

    const bodyCloseIndex = html.lastIndexOf('</body>');
    if (bodyCloseIndex !== -1) {
      return html.slice(0, bodyCloseIndex) + injection + html.slice(bodyCloseIndex);
    }

    const htmlCloseIndex = html.lastIndexOf('</html>');
    if (htmlCloseIndex !== -1) {
      return html.slice(0, htmlCloseIndex) + injection + html.slice(htmlCloseIndex);
    }

    return html + injection;
  }
```

Delete the `rewriteUrls` method entirely (old lines 234-264). Also update `serveInjectScript` path check to `/__web_lens/inject.js` (already done in handleRequest from Task 2). Remove the `html = this.rewriteUrls(html, targetUrl);` call from `proxyRequest` (already removed in Task 2 since the new proxyRequest doesn't call it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/proxy/ProxyServer.test.ts`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/ProxyServer.ts src/proxy/ProxyServer.test.ts
git commit -m "refactor(proxy): simplify HTML injection, remove URL rewriting and history patch"
```

---

### Task 4: Add WebSocket upgrade handling

**Files:**
- Modify: `src/proxy/ProxyServer.ts` (start method, new handleUpgrade method)
- Modify: `src/proxy/ProxyServer.ts` — add `import * as net from 'net';` at top

- [ ] **Step 1: Add `net` import and WebSocket upgrade handler**

Add `import * as net from 'net';` to the imports at top of `src/proxy/ProxyServer.ts`.

Add the WebSocket upgrade handler. In the `start()` method, after `this.server = http.createServer(...)` and before `this.server.listen(...)`, add:

```typescript
      this.server.on('upgrade', (req, clientSocket, head) => {
        this.handleUpgrade(req, clientSocket as net.Socket, head);
      });
```

Add the `handleUpgrade` method to the class:

```typescript
  /**
   * Handle WebSocket upgrade requests by piping to the target.
   * Supports HMR for Next.js, Vite, webpack-dev-server, etc.
   */
  private handleUpgrade(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) {
    const requestPath = req.url || '/';
    webLensLogger.info('Proxy WebSocket upgrade', { path: requestPath });

    const targetSocket = net.connect(this.targetPort, this.targetHostname, () => {
      // Build the raw HTTP upgrade request
      const headers = this.prepareRequestHeaders(req.headers);
      // Restore upgrade-related headers for the target
      headers['connection'] = 'Upgrade';
      headers['upgrade'] = req.headers['upgrade'] || 'websocket';

      let rawRequest = `${req.method} ${requestPath} HTTP/1.1\r\n`;
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) {
            rawRequest += `${key}: ${v}\r\n`;
          }
        } else {
          rawRequest += `${key}: ${value}\r\n`;
        }
      }
      rawRequest += '\r\n';

      targetSocket.write(rawRequest);
      if (head.length > 0) {
        targetSocket.write(head);
      }

      // Once the target responds, pipe everything bidirectionally.
      // The first data from the target is the HTTP 101 response + any initial frames.
      let headersSent = false;
      targetSocket.on('data', (chunk) => {
        if (!headersSent) {
          // Forward the 101 response to the client
          clientSocket.write(chunk);
          headersSent = true;
        } else {
          clientSocket.write(chunk);
        }
      });

      clientSocket.on('data', (chunk) => {
        targetSocket.write(chunk);
      });
    });

    targetSocket.on('error', (err) => {
      webLensLogger.error('Proxy WebSocket target error', { path: requestPath, error: err.message });
      clientSocket.destroy();
    });

    clientSocket.on('error', (err) => {
      webLensLogger.error('Proxy WebSocket client error', { path: requestPath, error: err.message });
      targetSocket.destroy();
    });

    targetSocket.on('close', () => clientSocket.destroy());
    clientSocket.on('close', () => targetSocket.destroy());
  }
```

- [ ] **Step 2: Run all tests to verify nothing broke**

Run: `npx vitest run src/proxy/ProxyServer.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS — all existing tests still pass.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/proxy/ProxyServer.ts
git commit -m "feat(proxy): add WebSocket upgrade handling for HMR support"
```

---

## Chunk 2: Inject Script Additions + Console Capture Refactor

### Task 5: Add nested iframe guard to inject.ts

**Files:**
- Modify: `src/webview/inject.ts:1-81` (add guard at top)

- [ ] **Step 1: Add nested iframe guard**

At the top of `src/webview/inject.ts`, right after the imports and before the type definitions (before line 10), add:

```typescript
// ── Nested iframe guard ────────────────────────────────────
// Only initialize in the top-level proxied frame (direct child of the webview).
// Nested iframes within the target app should NOT get instrumentation.
if (window.__webLensInjected) {
  // Already initialized in this frame — skip
} else if (window.parent !== window && window.parent !== window.top) {
  // This frame's parent is NOT the top frame (webview) — it's a nested iframe
  // Skip initialization but mark as seen
} else {
  (window as any).__webLensInjected = true;
  initWebLens();
}

declare global {
  interface Window {
    __webLensInjected?: boolean;
  }
}

function initWebLens() {
```

Then wrap the rest of the file's **executable code** inside this `initWebLens()` function. The closing `}` goes at the very end of the file.

**Must stay OUTSIDE `initWebLens` (module-level):**
- The `import html2canvas from 'html2canvas'` import
- All TypeScript `type` and `interface` definitions (`Mode`, `AccessibilityInfo`, `SourceLocation`, `ElementInfo`) — these cannot be declared inside a function body
- The helper functions `postToParent`, `truncate`, `escapeHtml`, `formatDiagnosticDetails` — so they can be used regardless of initialization
- The `MAX_SCREENSHOT_SIZE` constant

**Must go INSIDE `initWebLens`:**
- State variables (`currentMode`, `highlightEl`, `tooltipEl`, `selectedElement`)
- All event listeners (`error`, `unhandledrejection`, `message`)
- Mode management, event handlers, element extraction, tooltip, and screenshot code
- The `postToParent` diagnostic call (`'Inject script attached'`)

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/inject.ts
git commit -m "feat(inject): add nested iframe guard to prevent double initialization"
```

---

### Task 6: Add console capture to inject.ts

**Files:**
- Modify: `src/webview/inject.ts` (inside `initWebLens`, after error listeners)

- [ ] **Step 1: Add console capture code inside `initWebLens`**

Add this block inside `initWebLens()`, after the `unhandledrejection` listener and before the `// ── Message listener` section:

```typescript
// ── Console capture ────────────────────────────────────────
// Monkey-patch console.log/warn/error to forward entries to the webview.
// No local buffer needed — the receiver in console-capture.ts buffers entries.
(function captureConsole() {
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  function formatArgs(args: any[]): string {
    return args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try { return JSON.stringify(arg); } catch { return String(arg); }
      })
      .join(' ');
  }

  function forward(level: 'log' | 'warn' | 'error', args: any[]) {
    postToParent({
      type: 'bc:console',
      payload: { level, message: formatArgs(args), timestamp: Date.now() },
    });
  }

  console.log = (...args: any[]) => { forward('log', args); originalLog(...args); };
  console.warn = (...args: any[]) => { forward('warn', args); originalWarn(...args); };
  console.error = (...args: any[]) => { forward('error', args); originalError(...args); };
})();
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/inject.ts
git commit -m "feat(inject): add console capture with bc:console message forwarding"
```

---

### Task 7: Add SPA navigation detection to inject.ts

**Files:**
- Modify: `src/webview/inject.ts` (inside `initWebLens`, after console capture)

- [ ] **Step 1: Add navigation detection code**

Add this block inside `initWebLens()`, after the console capture IIFE and before the `// ── Message listener` section:

```typescript
// ── SPA navigation detection ───────────────────────────────
// Wrap pushState/replaceState to notify the webview of SPA navigations.
(function detectNavigation() {
  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);

  history.pushState = function (state: any, title: string, url?: string | URL | null) {
    const result = origPushState(state, title, url);
    postToParent({ type: 'bc:navigated', payload: { url: window.location.href } });
    return result;
  };

  history.replaceState = function (state: any, title: string, url?: string | URL | null) {
    const result = origReplaceState(state, title, url);
    postToParent({ type: 'bc:navigated', payload: { url: window.location.href } });
    return result;
  };

  // Also listen for popstate (back/forward within the iframe)
  window.addEventListener('popstate', () => {
    postToParent({ type: 'bc:navigated', payload: { url: window.location.href } });
  });
})();
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/webview/inject.ts
git commit -m "feat(inject): add SPA navigation detection via pushState/replaceState wrapping"
```

---

### Task 8: Refactor console-capture.ts to message receiver

**Files:**
- Rewrite: `src/webview/console-capture.ts`

- [ ] **Step 1: Rewrite `console-capture.ts` as a message-based receiver**

Replace the entire file:

```typescript
import type { ConsoleEntry } from '../types';

const MAX_ENTRIES = 200;
const MAX_BUFFER_SIZE = 50000; // ~50KB

/**
 * Console capture receiver — listens for bc:console postMessages from the
 * inject script and buffers entries for the "Add Logs to Chat" flow.
 *
 * The actual console monkey-patching now lives in inject.ts (inside the iframe).
 * This module runs in the webview and receives forwarded entries.
 */
export function createConsoleReceiver(onEntry?: (entry: ConsoleEntry) => void) {
  const buffer: ConsoleEntry[] = [];
  let bufferSize = 0;

  function handleMessage(event: MessageEvent) {
    const data = event.data;
    if (!data || data.type !== 'bc:console' || !data.payload) return;

    const entry: ConsoleEntry = {
      level: data.payload.level === 'log' ? 'log' : data.payload.level === 'warn' ? 'warn' : 'error',
      message: data.payload.message || '',
      timestamp: data.payload.timestamp || Date.now(),
    };

    buffer.push(entry);
    bufferSize += entry.message.length;

    onEntry?.(entry);

    // Evict oldest entries if over limits
    while (buffer.length > MAX_ENTRIES || bufferSize > MAX_BUFFER_SIZE) {
      const removed = buffer.shift();
      if (removed) {
        bufferSize -= removed.message.length;
      }
    }
  }

  window.addEventListener('message', handleMessage);

  return {
    getEntries(): ConsoleEntry[] {
      return [...buffer];
    },

    clear() {
      buffer.length = 0;
      bufferSize = 0;
    },

    detach() {
      window.removeEventListener('message', handleMessage);
    },
  };
}
```

- [ ] **Step 2: Add backward-compatible alias**

At the bottom of the file, add a temporary alias so `main.ts` doesn't break before Chunk 3 updates it:

```typescript
/** @deprecated Use createConsoleReceiver instead. Temporary alias for backwards compatibility. */
export const createConsoleCapture = createConsoleReceiver as any;
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors (the alias keeps `main.ts` imports working).

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/webview/console-capture.ts
git commit -m "refactor(console-capture): convert to message receiver for bc:console events"
```

---

## Chunk 3: Webview + Panel Manager Updates

### Task 9: Update main.ts (URL extraction, console receiver, navigation listener)

**Files:**
- Modify: `src/webview/main.ts`

- [ ] **Step 1: Update imports and console capture initialization**

In `src/webview/main.ts`, replace line 4:
```typescript
import { createConsoleCapture } from './console-capture';
```
with:
```typescript
import { createConsoleReceiver } from './console-capture';
```

Replace lines 26-27:
```typescript
// ── Console capture state (per iframe) ──────────────────────
let consoleCapture: ReturnType<typeof createConsoleCapture> | null = null;
```
with:
```typescript
// ── Console capture receiver (listens for bc:console from inject script) ──
const consoleReceiver = createConsoleReceiver((entry) => {
  postDiagnostic(entry.level === 'log' ? 'info' : entry.level, 'page.console', entry.message);
});
```

Update the `onLogsRequest` callback (line 33) to use `consoleReceiver`:
```typescript
  onLogsRequest() {
    const entries: ConsoleEntry[] = consoleReceiver.getEntries();
    postMessage({ type: 'action:addLogs', payload: { logs: entries } });
  },
```

- [ ] **Step 2: Read target origin from data attribute and update `extractOriginalUrl`**

First, add a line near the top of `main.ts` (after the `vscode` API setup, around line 14) to read the target origin from the HTML:

```typescript
// Read the target origin from a data attribute set by BrowserPanelManager
const targetOrigin = document.body.dataset.targetOrigin || '';
```

Then replace `extractOriginalUrl` (lines 194-203) with:

```typescript
/**
 * Extract the original target URL from a proxy URL.
 * With hostname-based proxy, the proxy URL is http://127.0.0.1:<port>/path
 * and we swap the origin back to the target origin for display.
 */
function extractOriginalUrl(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl);

    // Legacy: check for ?url= query parameter (old proxy format)
    const urlParam = parsed.searchParams.get('url');
    if (urlParam) return urlParam;

    // New: if origin is 127.0.0.1, it's a proxy URL — swap origin back
    if (parsed.hostname === '127.0.0.1' && targetOrigin) {
      return `${targetOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Not a valid URL — return as-is
  }
  return proxyUrl;
}
```

- [ ] **Step 3: Remove direct console monkey-patching from iframe load handler**

Replace the iframe `load` event handler (lines 68-110) with:

```typescript
iframe.addEventListener('load', () => {
  let url = '';
  let title = '';

  try {
    url = iframe.contentWindow?.location.href || '';
    title = iframe.contentDocument?.title || '';
  } catch {
    url = iframe.src;
  }

  const originalUrl = extractOriginalUrl(url);

  if (originalUrl && originalUrl !== 'about:blank') {
    toolbar.setUrl(originalUrl);
    postMessage({
      type: 'iframe:loaded',
      payload: { url: originalUrl, title, canInject: true },
    });
  }

  postDiagnostic('info', 'webview', 'Iframe loaded', `url=${originalUrl || url}`);
});
```

- [ ] **Step 4: Add `bc:navigated` message handler**

In the `window.addEventListener('message', ...)` handler (line 138), update the `bc:` prefix filter. Replace the line:
```typescript
  // Skip messages from the inject script (bc: prefix) — handled by inspect-overlay
  if (typeof message.type === 'string' && message.type.startsWith('bc:')) return;
```
with:
```typescript
  // Handle bc:navigated from inject script
  if (message.type === 'bc:navigated' && message.payload?.url) {
    const originalUrl = extractOriginalUrl(message.payload.url);
    toolbar.setUrl(originalUrl);
    postMessage({ type: 'iframe:loaded', payload: { url: originalUrl, title: '', canInject: true } });
    return;
  }

  // Skip other bc: messages — handled by inspect-overlay and console-receiver
  if (typeof message.type === 'string' && message.type.startsWith('bc:')) return;
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/webview/main.ts
git commit -m "refactor(webview): use console receiver, origin-swap URL extraction, bc:navigated handler"
```

---

### Task 10: Update BrowserPanelManager (pass target origin to proxy)

**Files:**
- Modify: `src/panel/BrowserPanelManager.ts`

- [ ] **Step 1: Update constructor to pass target origin**

In `src/panel/BrowserPanelManager.ts`, replace line 27:
```typescript
    this.proxyServer = new ProxyServer(extensionUri.fsPath);
```
with:
```typescript
    this.proxyServer = new ProxyServer(extensionUri.fsPath, this.state.url);
```

- [ ] **Step 2: Add `data-target-origin` attribute to webview HTML**

In `getHtmlForWebview()` (line 215), add the target origin as a data attribute on the body tag. Replace:
```typescript
<body data-theme="${dataTheme}">
```
with:
```typescript
<body data-theme="${dataTheme}" data-target-origin="${this.proxyServer.getTargetOrigin()}">
```

This allows `main.ts` to read the target origin via `document.body.dataset.targetOrigin` for URL display in the toolbar.

- [ ] **Step 3: Update `onIframeLoaded` to handle path-only URLs**

Replace `onIframeLoaded` (lines 162-168):

```typescript
  private onIframeLoaded(url: string) {
    webLensLogger.info('Iframe reported load', { url });
    // The url from the webview is the full target URL (origin-swapped by extractOriginalUrl).
    // But if it's somehow path-only, reconstruct the full URL.
    const fullUrl = url.startsWith('/') 
      ? `${this.proxyServer.getTargetOrigin()}${url}` 
      : url;
    if (fullUrl !== this.state.url) {
      this.navigate(fullUrl);
    }
  }
```

- [ ] **Step 4: Update BrowserPanelManager test mock**

In `src/panel/BrowserPanelManager.test.ts`, update the ProxyServer mock (lines 4-11) to match the new API:

```typescript
vi.mock('../proxy/ProxyServer', () => ({
  ProxyServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(9876),
    stop: vi.fn().mockResolvedValue(undefined),
    getPort: vi.fn().mockReturnValue(9876),
    getProxiedUrl: vi.fn((url: string) => {
      const parsed = new URL(url);
      return `http://127.0.0.1:9876${parsed.pathname}${parsed.search}${parsed.hash}`;
    }),
    getOriginalUrl: vi.fn((url: string) => url),
    getTargetOrigin: vi.fn().mockReturnValue('http://localhost:3000'),
  })),
}));
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS — all tests pass.

- [ ] **Step 7: Remove deprecated `createConsoleCapture` alias**

In `src/webview/console-capture.ts`, remove the backward-compatible alias added in Chunk 2 Task 8:
```typescript
/** @deprecated Use createConsoleReceiver instead. Temporary alias for backwards compatibility. */
export const createConsoleCapture = createConsoleReceiver as any;
```

- [ ] **Step 8: Commit**

```bash
git add src/panel/BrowserPanelManager.ts src/panel/BrowserPanelManager.test.ts src/webview/console-capture.ts
git commit -m "refactor(panel): pass target origin to ProxyServer, update test mocks, clean up compat alias"
```

---

### Task 11: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds without errors.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: No lint errors (or only pre-existing ones).

- [ ] **Step 5: Commit any remaining fixes**

If any fixes were needed during verification, commit them:
```bash
git add -A
git commit -m "fix: address test/lint/build issues from proxy rewrite"
```
