# Storage Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist cookies captured from proxied sites in VS Code's encrypted SecretStorage and replay them across panel sessions, with a UI toggle and viewer in the overflow menu.

**Architecture:** A new `CookieStore` class wraps `vscode.SecretStorage` and owns all read/write/delete logic, keyed per origin and scoped by workspace folder. `ProxyServer` is extended to intercept `Set-Cookie` response headers and inject a `Cookie` header on outbound requests. A new overflow-menu section in the toolbar lets users toggle the feature on/off and open a full-screen Storage Data viewer.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode.SecretStorage`, `vscode.workspace.getConfiguration`), Node.js `http`, Vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/cookies/CookieStore.ts` | Create | All SecretStorage read/write/delete, key naming, scope resolution |
| `src/cookies/CookieStore.test.ts` | Create | Unit tests for CookieStore |
| `src/types.ts` | Modify | 4 new WebviewMessage types + 2 new ExtensionMessage types |
| `src/proxy/ProxyServer.ts` | Modify | Cookie capture from Set-Cookie headers; cookie replay into Cookie header |
| `src/extension.ts` | Modify | Instantiate CookieStore; pass to BrowserPanelManager; react to config change |
| `src/panel/BrowserPanelManager.ts` | Modify | Accept CookieStore; handle 4 new message types; expose refreshStorageState() |
| `package.json` | Modify | Add `webLens.storeCookies` setting |
| `src/webview/toolbar.ts` | Modify | Add Storage Data toggle + View button to overflow menu |
| `src/webview/main.ts` | Modify | Handle storage:state and storage:view; render Storage Data view |

---

## Task 1: CookieStore module

**Files:**
- Create: `src/cookies/CookieStore.ts`
- Create: `src/cookies/CookieStore.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `src/cookies/CookieStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(false),
    }),
  },
}));

vi.mock('../logging', () => ({
  webLensLogger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn(), dispose: vi.fn(),
  },
}));

import * as vscode from 'vscode';
import { CookieStore } from './CookieStore';

function makeSecrets(): vscode.SecretStorage {
  const map = new Map<string, string>();
  return {
    get: vi.fn((key: string) => Promise.resolve(map.get(key))),
    store: vi.fn((key: string, value: string) => { map.set(key, value); return Promise.resolve(); }),
    delete: vi.fn((key: string) => { map.delete(key); return Promise.resolve(); }),
    onDidChange: vi.fn() as any,
  };
}

describe('CookieStore', () => {
  let secrets: vscode.SecretStorage;

  beforeEach(() => {
    secrets = makeSecrets();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue(false),
    } as any);
  });

  describe('isEnabled', () => {
    it('returns false when storeCookies setting is false', () => {
      const store = new CookieStore(secrets);
      expect(store.isEnabled()).toBe(false);
    });

    it('returns true when storeCookies setting is true', () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(true),
      } as any);
      const store = new CookieStore(secrets);
      expect(store.isEnabled()).toBe(true);
    });
  });

  describe('key naming', () => {
    it('uses global key when no workspace folder provided', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc' });
      expect(secrets.store).toHaveBeenCalledWith(
        'web-lens:cookies:global:http://localhost:3000',
        expect.any(String)
      );
    });

    it('uses workspace-scoped key when workspace folder provided', async () => {
      const store = new CookieStore(secrets, 'file:///home/user/myapp');
      await store.merge('http://localhost:3000', { session: 'abc' });
      expect(secrets.store).toHaveBeenCalledWith(
        'web-lens:cookies:ws:file:///home/user/myapp:http://localhost:3000',
        expect.any(String)
      );
    });
  });

  describe('get', () => {
    it('returns empty object when no cookies stored', async () => {
      const store = new CookieStore(secrets);
      expect(await store.get('http://localhost:3000')).toEqual({});
    });

    it('returns stored cookies', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc', csrf: 'xyz' });
      expect(await store.get('http://localhost:3000')).toEqual({ session: 'abc', csrf: 'xyz' });
    });

    it('returns empty object on malformed JSON', async () => {
      vi.mocked(secrets.get).mockResolvedValueOnce('not-valid-json');
      const store = new CookieStore(secrets);
      expect(await store.get('http://localhost:3000')).toEqual({});
    });
  });

  describe('merge', () => {
    it('adds new cookies without removing existing ones', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc' });
      await store.merge('http://localhost:3000', { csrf: 'xyz' });
      expect(await store.get('http://localhost:3000')).toEqual({ session: 'abc', csrf: 'xyz' });
    });

    it('overwrites existing cookie with the same name', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'old' });
      await store.merge('http://localhost:3000', { session: 'new' });
      expect(await store.get('http://localhost:3000')).toEqual({ session: 'new' });
    });
  });

  describe('remove', () => {
    it('removes specified cookie names', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc', csrf: 'xyz', pref: '1' });
      await store.remove('http://localhost:3000', ['session', 'csrf']);
      expect(await store.get('http://localhost:3000')).toEqual({ pref: '1' });
    });

    it('deletes the key entirely when all cookies removed', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc' });
      await store.remove('http://localhost:3000', ['session']);
      expect(secrets.delete).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('deletes the key for the given origin', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc' });
      await store.clear('http://localhost:3000');
      expect(await store.get('http://localhost:3000')).toEqual({});
    });
  });

  describe('listNames', () => {
    it('returns empty array when no cookies stored', async () => {
      const store = new CookieStore(secrets);
      expect(await store.listNames('http://localhost:3000')).toEqual([]);
    });

    it('returns cookie names without values', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc', csrf: 'xyz' });
      const names = await store.listNames('http://localhost:3000');
      expect(names.sort()).toEqual(['csrf', 'session']);
    });
  });
});
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
npm test -- --run src/cookies/CookieStore.test.ts
```

Expected: FAIL — `Cannot find module './CookieStore'`

- [ ] **Step 1.3: Implement CookieStore**

Create `src/cookies/CookieStore.ts`:

```ts
import * as vscode from 'vscode';
import { webLensLogger } from '../logging';

/**
 * Persists cookies in VS Code's encrypted SecretStorage.
 *
 * Scope is determined at construction: if a workspaceFolderUri is provided,
 * cookies are stored per-workspace (isolated per project). Otherwise global.
 *
 * All public methods are fire-and-forget safe: they catch and log errors
 * instead of throwing, so proxy requests are never blocked by storage failures.
 */
export class CookieStore {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly workspaceFolderUri?: string,
  ) {}

  /** Returns true if the webLens.storeCookies setting is enabled. */
  isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('webLens')
      .get<boolean>('storeCookies', false);
  }

  private buildKey(origin: string): string {
    if (this.workspaceFolderUri) {
      return `web-lens:cookies:ws:${this.workspaceFolderUri}:${origin}`;
    }
    return `web-lens:cookies:global:${origin}`;
  }

  /** Read stored cookies for an origin. Returns {} on any error. */
  async get(origin: string): Promise<Record<string, string>> {
    try {
      const raw = await this.secrets.get(this.buildKey(origin));
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, string>;
    } catch (err) {
      webLensLogger.warn('CookieStore: failed to read cookies', String(err));
      return {};
    }
  }

  /** Merge new cookies into existing storage for an origin. */
  async merge(origin: string, cookies: Record<string, string>): Promise<void> {
    try {
      const existing = await this.get(origin);
      const merged = { ...existing, ...cookies };
      await this.secrets.store(this.buildKey(origin), JSON.stringify(merged));
    } catch (err) {
      webLensLogger.warn('CookieStore: failed to save cookies', String(err));
    }
  }

  /** Remove specific cookie names for an origin. */
  async remove(origin: string, names: string[]): Promise<void> {
    try {
      const existing = await this.get(origin);
      for (const name of names) {
        delete existing[name];
      }
      if (Object.keys(existing).length === 0) {
        await this.secrets.delete(this.buildKey(origin));
      } else {
        await this.secrets.store(this.buildKey(origin), JSON.stringify(existing));
      }
    } catch (err) {
      webLensLogger.warn('CookieStore: failed to remove cookies', String(err));
    }
  }

  /** Delete all cookies for an origin. */
  async clear(origin: string): Promise<void> {
    try {
      await this.secrets.delete(this.buildKey(origin));
    } catch (err) {
      webLensLogger.warn('CookieStore: failed to clear cookies', String(err));
    }
  }

  /** List stored cookie names (not values) for an origin. */
  async listNames(origin: string): Promise<string[]> {
    const cookies = await this.get(origin);
    return Object.keys(cookies);
  }
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
npm test -- --run src/cookies/CookieStore.test.ts
```

Expected: 12 tests passing, 0 failures.

- [ ] **Step 1.5: Commit**

```bash
git add src/cookies/CookieStore.ts src/cookies/CookieStore.test.ts
git commit -m "feat: add CookieStore for encrypted per-origin cookie persistence"
```

---

## Task 2: Extend message protocol

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 2.1: Add new message types to `src/types.ts`**

In `src/types.ts`, replace the existing `WebviewMessage` type:

```ts
// Webview -> Extension Host
export type WebviewMessage =
  | { type: 'navigate'; payload: { url: string } }
  | { type: 'nav:back'; payload: Record<string, never> }
  | { type: 'nav:forward'; payload: Record<string, never> }
  | { type: 'nav:reload'; payload: Record<string, never> }
  | { type: 'inspect:selected'; payload: InspectSelectedPayload }
  | { type: 'inspect:sendToChat'; payload: CapturedElementPayload }
  | { type: 'addElement:captured'; payload: CapturedElementPayload }
  | { type: 'action:addLogs'; payload: { logs: ConsoleEntry[] } }
  | { type: 'action:screenshot'; payload: { dataUrl: string } }
  | { type: 'iframe:loaded'; payload: { url: string; title: string; canInject: boolean } }
  | { type: 'iframe:error'; payload: { url: string; error: string } }
  | { type: 'menu:copyHtml'; payload: { html: string } }
  | { type: 'menu:clearSelection'; payload: Record<string, never> }
  | { type: 'menu:openSettings'; payload: Record<string, never> }
  | { type: 'diagnostic:log'; payload: DiagnosticPayload }
  | { type: 'backend:request'; payload: Record<string, never> }
  | { type: 'backend:select'; payload: { backend: string } }
  | { type: 'storage:setEnabled'; payload: { enabled: boolean } }
  | { type: 'storage:openView'; payload: Record<string, never> }
  | { type: 'storage:clear'; payload: { origin: string } }
  | { type: 'storage:deleteEntries'; payload: { origin: string; names: string[] } };
```

Replace the existing `ExtensionMessage` type:

```ts
// Extension Host -> Webview
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
  | { type: 'storage:view'; payload: { origin: string; names: string[] } };
  // Note: spec uses `type` for toast payload, but we use `toastType` to avoid
  // collision with the message discriminant `type` field.
```

- [ ] **Step 2.2: Run all tests to confirm no regressions**

```bash
npm test -- --run
```

Expected: all 97+ tests passing.

- [ ] **Step 2.3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add storage data message types to protocol"
```

---

## Task 3: ProxyServer — cookie capture and replay

**Files:**
- Modify: `src/proxy/ProxyServer.ts`

- [ ] **Step 3.1: Add `setCookieStore`, `parseSetCookieHeaders`, and extend `prepareRequestHeaders`**

At the top of `ProxyServer.ts`, add the import:

```ts
import type { CookieStore } from '../cookies/CookieStore';
```

Inside the `ProxyServer` class, add a private field after the existing private fields (after line 25):

```ts
  private cookieStore: CookieStore | null = null;
```

Add the `setCookieStore` public method after the `getTargetOrigin()` method (after line 111):

```ts
  /** Attach a CookieStore for capture and replay. Call before start(). */
  setCookieStore(store: CookieStore | null): void {
    this.cookieStore = store;
  }
```

Add the `parseSetCookieHeaders` private method after `stripHopByHopHeaders`:

```ts
  /**
   * Parse Set-Cookie header values into a name→value map.
   * Drops all cookie attributes (HttpOnly, Secure, SameSite, expires, path).
   */
  private parseSetCookieHeaders(setCookieHeaders: string[] | undefined): Record<string, string> {
    if (!setCookieHeaders) return {};
    const result: Record<string, string> = {};
    for (const header of setCookieHeaders) {
      const [nameValue] = header.split(';');
      const eqIdx = nameValue.indexOf('=');
      if (eqIdx > 0) {
        const name = nameValue.slice(0, eqIdx).trim();
        const value = nameValue.slice(eqIdx + 1).trim();
        if (name) {
          result[name] = value;
        }
      }
    }
    return result;
  }
```

Modify `prepareRequestHeaders` signature to accept optional stored cookies. Replace the existing method signature and its closing brace:

```ts
  private prepareRequestHeaders(
    clientHeaders: http.IncomingHttpHeaders,
    storedCookies: Record<string, string> = {},
  ): http.OutgoingHttpHeaders {
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

    // Merge stored cookies: request cookies take precedence (they were set first in the loop).
    // We only add stored cookies whose name isn't already present in the request.
    if (Object.keys(storedCookies).length > 0) {
      const existingCookieStr = headers['cookie'] as string | undefined;
      const existingNames = existingCookieStr
        ? new Set(existingCookieStr.split(';').map((p) => p.trim().split('=')[0].trim()))
        : new Set<string>();
      const additions = Object.entries(storedCookies)
        .filter(([name]) => !existingNames.has(name))
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      if (additions) {
        headers['cookie'] = existingCookieStr ? `${existingCookieStr}; ${additions}` : additions;
      }
    }

    return headers;
  }
```

- [ ] **Step 3.2: Make `proxyRequest` async and wire cookie capture + replay**

Replace the entire `proxyRequest` method (lines 153–245 in the original):

```ts
  private async proxyRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const requestPath = req.url || '/';
    webLensLogger.info('Proxy request started', { method: req.method, path: requestPath });

    // Pre-fetch stored cookies before creating the upstream request
    let storedCookies: Record<string, string> = {};
    if (this.cookieStore?.isEnabled()) {
      storedCookies = await this.cookieStore.get(this.targetOrigin);
    }

    const requestModule = this.targetIsHttps ? https : http;
    const headers = this.prepareRequestHeaders(req.headers, storedCookies);

    const options: http.RequestOptions = {
      hostname: this.targetHostname,
      port: this.targetPort,
      path: requestPath,
      method: req.method || 'GET',
      headers,
    };

    const proxyReq = requestModule.request(options, (proxyRes) => {
      // Capture Set-Cookie headers from upstream response
      const setCookieHeaders = proxyRes.headers['set-cookie'];
      if (this.cookieStore?.isEnabled() && setCookieHeaders) {
        const captured = this.parseSetCookieHeaders(setCookieHeaders);
        if (Object.keys(captured).length > 0) {
          this.cookieStore.merge(this.targetOrigin, captured).catch((err) => {
            webLensLogger.warn('CookieStore: failed to save Set-Cookie', String(err));
          });
        }
      }

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
        proxyRes.on('error', (err) => {
          webLensLogger.error('Upstream response error', { path: requestPath, error: err.message });
          if (!res.headersSent) {
            this.sendError(res, 502, `Upstream response error: ${err.message}`);
          } else {
            res.end();
          }
        });
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
      if (!res.headersSent) {
        this.sendError(res, 502, `Failed to reach ${this.targetOrigin}${requestPath}: ${err.message}`);
      }
    });

    proxyReq.setTimeout(10000, () => {
      proxyReq.destroy();
      webLensLogger.error('Proxy request timed out', { path: requestPath });
      if (!res.headersSent) {
        this.sendError(res, 504, `Request to ${this.targetOrigin}${requestPath} timed out`);
      }
    });

    // Pipe request bodies for all methods except GET/HEAD.
    const method = (req.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  }
```

Update the call site in `handleRequest` (around line 137) to handle the returned promise:

Replace:
```ts
    this.proxyRequest(req, res);
```

With:
```ts
    this.proxyRequest(req, res).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      webLensLogger.error('Proxy request unhandled error', { path: req.url, error: msg });
      if (!res.headersSent) {
        this.sendError(res, 500, `Internal proxy error: ${msg}`);
      }
    });
```

- [ ] **Step 3.3: Add ProxyServer cookie tests**

In `src/proxy/ProxyServer.test.ts`, add this describe block before the final closing `});`:

```ts
  describe('cookie handling', () => {
    it('parseSetCookieHeaders extracts name=value pairs and drops attributes', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      const result = server.parseSetCookieHeaders([
        'session_id=abc123; HttpOnly; Path=/; Secure',
        'csrf_token=xyz; SameSite=Strict',
      ]);
      expect(result).toEqual({ session_id: 'abc123', csrf_token: 'xyz' });
    });

    it('parseSetCookieHeaders ignores entries without =', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      const result = server.parseSetCookieHeaders(['bad-cookie', 'good=value']);
      expect(result).toEqual({ good: 'value' });
    });

    it('parseSetCookieHeaders returns empty object for undefined input', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      expect(server.parseSetCookieHeaders(undefined)).toEqual({});
    });

    it('prepareRequestHeaders injects stored cookies not already in request', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      server.port = 9000;
      const headers = { host: '127.0.0.1:9000', cookie: 'existing=val' };
      const result = server.prepareRequestHeaders(headers, { stored: 'abc', existing: 'ignored' });
      expect(result['cookie']).toContain('existing=val');
      expect(result['cookie']).toContain('stored=abc');
      // existing= from request must not be overwritten by stored
      const cookieParts = (result['cookie'] as string).split('; ');
      const existingEntry = cookieParts.find((p: string) => p.startsWith('existing='));
      expect(existingEntry).toBe('existing=val');
    });

    it('prepareRequestHeaders sets Cookie header from stored cookies when no request cookie', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      server.port = 9000;
      const headers = { host: '127.0.0.1:9000' };
      const result = server.prepareRequestHeaders(headers, { session: 'tok' });
      expect(result['cookie']).toBe('session=tok');
    });
  });
```

- [ ] **Step 3.4: Run all tests to confirm pass**

```bash
npm test -- --run
```

Expected: all tests passing including the 5 new cookie handling tests.

- [ ] **Step 3.5: Commit**

```bash
git add src/proxy/ProxyServer.ts src/proxy/ProxyServer.test.ts
git commit -m "feat: ProxyServer captures Set-Cookie headers and replays stored cookies"
```

---

## Task 4: Wire CookieStore in extension.ts

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 4.1: Instantiate CookieStore and pass to BrowserPanelManager**

In `src/extension.ts`, add the import after the existing imports:

```ts
import { CookieStore } from './cookies/CookieStore';
```

In the `activate` function, replace:

```ts
  contextExtractor = new ContextExtractor();
  panelManager = new BrowserPanelManager(context.extensionUri);
```

With:

```ts
  contextExtractor = new ContextExtractor();
  const workspaceFolderUri = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
  const cookieStore = new CookieStore(context.secrets, workspaceFolderUri);
  panelManager = new BrowserPanelManager(context.extensionUri, cookieStore);
```

In the `onDidChangeConfiguration` handler, add after the existing `webLens.backend` block:

```ts
      if (e.affectsConfiguration('webLens.storeCookies')) {
        panelManager?.refreshStorageState();
      }
```

The full updated `onDidChangeConfiguration` subscription becomes:

```ts
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('webLens.backend')) {
        const adapter = getAdapter();
        panelManager?.postMessage({
          type: 'config:update',
          payload: { backend: adapter.name },
        });
        getBackendState().then((state) => {
          panelManager?.postMessage({ type: 'backend:state', payload: state });
        });
      }
      if (e.affectsConfiguration('webLens.storeCookies')) {
        panelManager?.refreshStorageState();
      }
    })
  );
```

- [ ] **Step 4.2: Run all tests to confirm no regressions**

```bash
npm test -- --run
```

Expected: all tests passing. (BrowserPanelManager tests will still pass because the extra argument is optional — we add that in Task 5.)

- [ ] **Step 4.3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: instantiate CookieStore in extension activation and react to config changes"
```

---

## Task 5: BrowserPanelManager — handle storage messages

**Files:**
- Modify: `src/panel/BrowserPanelManager.ts`
- Modify: `src/panel/BrowserPanelManager.test.ts`

- [ ] **Step 5.1: Update BrowserPanelManager to accept CookieStore**

In `src/panel/BrowserPanelManager.ts`, add the import:

```ts
import type { CookieStore } from '../cookies/CookieStore';
```

Update the constructor signature (replace lines 19–28):

```ts
  constructor(extensionUri: vscode.Uri, private readonly cookieStore?: CookieStore) {
    this.extensionUri = extensionUri;
    const config = vscode.workspace.getConfiguration('webLens');
    this.state = {
      url: config.get<string>('defaultUrl') || 'http://localhost:3000',
      history: [],
      historyIndex: -1,
    };
    this.proxyServer = new ProxyServer(extensionUri.fsPath, this.state.url);
    if (cookieStore) {
      this.proxyServer.setCookieStore(cookieStore);
    }
  }
```

- [ ] **Step 5.2: Add `sendStorageState` and `refreshStorageState` methods**

Add these two methods to `BrowserPanelManager` after `onIframeLoaded`:

```ts
  /** Send current storage state to the webview. Called on navigation and config changes. */
  async sendStorageState(): Promise<void> {
    if (!this.cookieStore) return;
    const origin = this.proxyServer.getTargetOrigin();
    const enabled = this.cookieStore.isEnabled();
    const names = enabled ? await this.cookieStore.listNames(origin) : [];
    this.postMessage({
      type: 'storage:state',
      payload: { origin, enabled, hasData: names.length > 0 },
    });
  }

  /** Called by extension.ts when webLens.storeCookies config changes. */
  refreshStorageState(): void {
    this.sendStorageState().catch((err) => {
      webLensLogger.warn('BrowserPanelManager: failed to refresh storage state', String(err));
    });
  }
```

- [ ] **Step 5.3: Handle new message types in `handleMessage`**

In the `handleMessage` switch statement, add these cases before the `default:` case:

```ts
      case 'storage:setEnabled': {
        const target = vscode.workspace.workspaceFolders
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
        vscode.workspace
          .getConfiguration('webLens')
          .update('storeCookies', message.payload.enabled, target)
          .then(() => this.sendStorageState())
          .catch((err) => {
            webLensLogger.warn('BrowserPanelManager: failed to update storeCookies', String(err));
          });
        break;
      }
      case 'storage:openView': {
        if (!this.cookieStore) break;
        const origin = this.proxyServer.getTargetOrigin();
        this.cookieStore.listNames(origin).then((names) => {
          this.postMessage({ type: 'storage:view', payload: { origin, names } });
        }).catch(() => {/* silent */});
        break;
      }
      case 'storage:clear': {
        if (!this.cookieStore) break;
        this.cookieStore.clear(message.payload.origin).then(() => this.sendStorageState()).catch(() => {/* silent */});
        break;
      }
      case 'storage:deleteEntries': {
        if (!this.cookieStore) break;
        const { origin, names } = message.payload;
        this.cookieStore.remove(origin, names).then(async () => {
          const remaining = await this.cookieStore!.listNames(origin);
          this.postMessage({ type: 'storage:view', payload: { origin, names: remaining } });
          await this.sendStorageState();
        }).catch(() => {/* silent */});
        break;
      }
```

- [ ] **Step 5.4: Send storage state after iframe loads**

Update the `onIframeLoaded` method (replace the existing implementation):

```ts
  private onIframeLoaded(url: string) {
    webLensLogger.info('Iframe reported load', { url });
    const fullUrl = url.startsWith('/')
      ? `${this.proxyServer.getTargetOrigin()}${url}`
      : url;
    if (fullUrl !== this.state.url) {
      this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
      this.state.history.push(fullUrl);
      this.state.historyIndex = this.state.history.length - 1;
      this.state.url = fullUrl;
    }
    // Send storage state so the webview toolbar can update
    this.sendStorageState().catch(() => {/* silent */});
  }
```

Also update `open()` to send storage state after the initial navigation message (after line `this.postMessage({ type: 'navigate:url', ... })`):

```ts
    // Navigate to default URL (through proxy)
    const proxiedUrl = this.proxyServer.getProxiedUrl(this.state.url);
    this.postMessage({ type: 'navigate:url', payload: { url: proxiedUrl } });
    this.sendStorageState().catch(() => {/* silent */});
```

- [ ] **Step 5.5: Add BrowserPanelManager tests for storage messages**

In `src/panel/BrowserPanelManager.test.ts`, update the vscode mock to include `ConfigurationTarget` and `workspaceFolders`, and add test cases:

Add to the vscode mock (inside `vi.mock('vscode', ...)`, add to the `workspace` object):

```ts
    workspace: {
      getConfiguration: vi.fn().mockReturnValue({
        get: vi.fn((key: string) => {
          const defaults: Record<string, any> = {
            defaultUrl: 'http://localhost:3000',
            backend: 'clipboard',
            screenshotFormat: 'png',
            screenshotQuality: 0.9,
            storeCookies: false,
          };
          return defaults[key];
        }),
        update: vi.fn().mockResolvedValue(undefined),
      }),
      workspaceFolders: [{ uri: { toString: () => 'file:///test' } }],
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
```

Add new test cases in the `describe('BrowserPanelManager', ...)` block:

```ts
  describe('storage message handling', () => {
    let mockCookieStore: any;

    beforeEach(() => {
      mockCookieStore = {
        isEnabled: vi.fn().mockReturnValue(false),
        get: vi.fn().mockResolvedValue({}),
        merge: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
        listNames: vi.fn().mockResolvedValue([]),
      };
    });

    it('passes cookieStore to ProxyServer via setCookieStore', () => {
      const proxyInstance = mockState.proxyServerMock.mock.results[0]?.value;
      proxyInstance.setCookieStore = vi.fn();
      new (require('./BrowserPanelManager').BrowserPanelManager)(mockExtensionUri, mockCookieStore);
      expect(proxyInstance.setCookieStore).toHaveBeenCalledWith(mockCookieStore);
    });

    it('handles storage:clear by calling cookieStore.clear', async () => {
      manager = new BrowserPanelManager(mockExtensionUri, mockCookieStore);
      await manager.open();
      await mockState.lastMessageHandler?.({ type: 'storage:clear', payload: { origin: 'http://localhost:3000' } });
      expect(mockCookieStore.clear).toHaveBeenCalledWith('http://localhost:3000');
    });

    it('handles storage:openView by posting storage:view with cookie names', async () => {
      mockCookieStore.listNames.mockResolvedValue(['session', 'csrf']);
      manager = new BrowserPanelManager(mockExtensionUri, mockCookieStore);
      await manager.open();
      const panel = mockedVscode.window.createWebviewPanel.mock.results[0]?.value;
      const postMessage = panel?.webview.postMessage as ReturnType<typeof vi.fn>;
      postMessage.mockClear();

      await mockState.lastMessageHandler?.({ type: 'storage:openView', payload: {} });
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'storage:view', payload: expect.objectContaining({ names: ['session', 'csrf'] }) })
      );
    });
  });
```

- [ ] **Step 5.6: Run all tests**

```bash
npm test -- --run
```

Expected: all tests passing.

- [ ] **Step 5.7: Commit**

```bash
git add src/panel/BrowserPanelManager.ts src/panel/BrowserPanelManager.test.ts
git commit -m "feat: BrowserPanelManager handles storage messages and syncs state to webview"
```

---

## Task 6: Add webLens.storeCookies setting

**Files:**
- Modify: `package.json`

- [ ] **Step 6.1: Add setting to package.json**

In `package.json`, inside `"contributes" > "configuration" > "properties"`, add after the last property and before the closing `}`:

```json
        "webLens.storeCookies": {
          "type": "boolean",
          "default": false,
          "description": "When enabled, cookies are captured from proxied sites and replayed across panel sessions. Stored securely in VS Code's encrypted secret storage.",
          "scope": "resource"
        }
```

- [ ] **Step 6.2: Run all tests to confirm no regressions**

```bash
npm test -- --run
```

Expected: all tests passing.

- [ ] **Step 6.3: Commit**

```bash
git add package.json
git commit -m "feat: add webLens.storeCookies setting (default false, resource scope)"
```

---

## Task 7: Toolbar — Storage Data overflow menu items

**Files:**
- Modify: `src/webview/toolbar.ts`

- [ ] **Step 7.1: Add Storage Data items to the overflow menu HTML**

In `src/webview/toolbar.ts`, replace the overflow menu HTML block (the `<div class="overflow-menu" ...>` contents):

```ts
        <div class="overflow-menu" id="overflow-menu">
          <button class="overflow-menu-item" id="menu-settings">
            <span class="material-symbols-outlined">settings</span>
            Settings
          </button>
          <button class="overflow-menu-item" id="menu-copy-html">
            <span class="material-symbols-outlined">content_copy</span>
            Copy Page HTML
          </button>
          <button class="overflow-menu-item" id="menu-clear">
            <span class="material-symbols-outlined">deselect</span>
            Clear Selection
          </button>
          <div class="overflow-menu-separator"></div>
          <button class="overflow-menu-item" id="menu-storage-toggle">
            <span class="material-symbols-outlined">cookie</span>
            <span id="menu-storage-label">Storage Data</span>
            <span class="overflow-menu-check" id="menu-storage-check" style="display:none;">
              <span class="material-symbols-outlined" style="font-size:16px;margin-left:auto;">check</span>
            </span>
          </button>
          <button class="overflow-menu-item" id="menu-storage-view" style="display:none;">
            <span class="material-symbols-outlined">manage_search</span>
            View Storage Data
          </button>
        </div>
```

- [ ] **Step 7.2: Add storage state to ToolbarAPI and wire up event handlers**

Update the `ToolbarAPI` interface to add the new method:

```ts
export interface ToolbarAPI {
  setUrl(url: string): void;
  setInspectActive(active: boolean): void;
  setAddElementActive(active: boolean): void;
  setBackendState(active: string, available: Record<string, boolean>): void;
  setStorageDataState(enabled: boolean, hasData: boolean): void;
  onStateChange(cb: (state: ToolbarState) => void): void;
}
```

Inside `createToolbar`, after the existing element references, add:

```ts
  const menuStorageToggle = container.querySelector('#menu-storage-toggle') as HTMLButtonElement;
  const menuStorageCheck = container.querySelector('#menu-storage-check') as HTMLElement;
  const menuStorageView = container.querySelector('#menu-storage-view') as HTMLButtonElement;
```

After the existing `container.querySelector('#menu-clear')!.addEventListener` block, add:

```ts
  menuStorageToggle.addEventListener('click', () => {
    // Read current state from the check visibility and invert
    const currentlyEnabled = menuStorageCheck.style.display !== 'none';
    postMessage({ type: 'storage:setEnabled', payload: { enabled: !currentlyEnabled } });
    overflowMenu.classList.remove('visible');
  });

  menuStorageView.addEventListener('click', () => {
    postMessage({ type: 'storage:openView', payload: {} });
    overflowMenu.classList.remove('visible');
  });
```

In the returned `ToolbarAPI` object, add the `setStorageDataState` implementation:

```ts
    setStorageDataState(enabled: boolean, hasData: boolean) {
      menuStorageCheck.style.display = enabled ? 'inline' : 'none';
      menuStorageView.style.display = (enabled && hasData) ? '' : 'none';
    },
```

- [ ] **Step 7.3: Run all tests to confirm no regressions**

```bash
npm test -- --run
```

Expected: all tests passing.

- [ ] **Step 7.4: Commit**

```bash
git add src/webview/toolbar.ts
git commit -m "feat: add Storage Data toggle and view items to overflow menu"
```

---

## Task 8: Webview — handle storage messages and render Storage Data view

**Files:**
- Modify: `src/webview/main.ts`

- [ ] **Step 8.1: Add storage message handling to the `window.addEventListener('message')` switch**

In `src/webview/main.ts`, inside the `switch (msg.type)` block (after the `case 'toast':` handler, before the closing `}`), add:

```ts
    case 'storage:state':
      toolbar.setStorageDataState(msg.payload.enabled, msg.payload.hasData);
      break;

    case 'storage:view':
      showStorageDataView(msg.payload.origin, msg.payload.names);
      break;
```

- [ ] **Step 8.2: Add `showStorageDataView` and helpers at the bottom of main.ts**

Add these functions after the `formatUnknown` function:

```ts
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showStorageDataView(origin: string, names: string[]) {
  // Remove any existing view
  document.getElementById('storage-data-view')?.remove();

  const view = document.createElement('div');
  view.id = 'storage-data-view';
  view.className = 'storage-data-view';

  const rowsHtml = names.length === 0
    ? `<tr><td colspan="3" class="storage-data-empty">No cookies stored for this origin</td></tr>`
    : names.map(name => `
        <tr>
          <td><input type="checkbox" class="storage-row-check" data-name="${escapeHtml(name)}"></td>
          <td class="storage-data-name">${escapeHtml(name)}</td>
          <td class="storage-data-value">••••••••••</td>
        </tr>
      `).join('');

  view.innerHTML = `
    <div class="storage-data-header">
      Storage Data — <span class="storage-data-origin">${escapeHtml(origin)}</span>
    </div>
    <div class="storage-data-scroll">
      <table class="storage-data-table">
        <thead>
          <tr>
            <th><input type="checkbox" id="storage-select-all" ${names.length === 0 ? 'disabled' : ''}></th>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody id="storage-data-tbody">
          ${rowsHtml}
        </tbody>
      </table>
    </div>
    <div class="storage-data-actions">
      <button id="storage-delete-selected" disabled>Delete Selected</button>
      <button id="storage-clear-all" ${names.length === 0 ? 'disabled' : ''}>Clear All</button>
      <button id="storage-close">Close</button>
    </div>
  `;

  // Append over the browser-frame area
  document.getElementById('browser-frame')?.appendChild(view);

  // ── Wire interactions ─────────────────────────────────────

  const selectAll = view.querySelector('#storage-select-all') as HTMLInputElement;
  const deleteSelected = view.querySelector('#storage-delete-selected') as HTMLButtonElement;
  const clearAll = view.querySelector('#storage-clear-all') as HTMLButtonElement;
  const closeBtn = view.querySelector('#storage-close') as HTMLButtonElement;

  function updateDeleteButton() {
    const checked = view.querySelectorAll('.storage-row-check:checked');
    deleteSelected.disabled = checked.length === 0;
  }

  selectAll.addEventListener('change', () => {
    view.querySelectorAll<HTMLInputElement>('.storage-row-check').forEach((cb) => {
      cb.checked = selectAll.checked;
    });
    updateDeleteButton();
  });

  view.querySelector('#storage-data-tbody')!.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).classList.contains('storage-row-check')) {
      updateDeleteButton();
      const allChecks = view.querySelectorAll<HTMLInputElement>('.storage-row-check');
      const allChecked = Array.from(allChecks).every((cb) => cb.checked);
      selectAll.checked = allChecked;
    }
  });

  deleteSelected.addEventListener('click', () => {
    const checked = view.querySelectorAll<HTMLInputElement>('.storage-row-check:checked');
    const namesToDelete = Array.from(checked).map((cb) => cb.dataset.name!).filter(Boolean);
    if (namesToDelete.length > 0) {
      postMessage({ type: 'storage:deleteEntries', payload: { origin, names: namesToDelete } });
    }
  });

  clearAll.addEventListener('click', () => {
    postMessage({ type: 'storage:clear', payload: { origin } });
    view.remove();
  });

  closeBtn.addEventListener('click', () => {
    view.remove();
  });
}
```

Also update the `storage:view` case to handle re-render after deletion (the extension sends a fresh `storage:view` after `deleteEntries`):

```ts
    case 'storage:view':
      showStorageDataView(msg.payload.origin, msg.payload.names);
      break;
```

(No change needed — `showStorageDataView` already removes the existing view and re-renders.)

- [ ] **Step 8.3: Add basic CSS for the Storage Data view**

In the webview CSS file (`webview/main.css` or wherever styles live — check with `ls src/webview/*.css`):

```bash
ls src/webview/*.css 2>/dev/null || ls webview/*.css 2>/dev/null
```

Look for the CSS file and add these rules at the end:

```css
/* ── Storage Data View ──────────────────────────────────────── */

/* Required so the absolute-positioned view fills the frame area */
#browser-frame {
  position: relative;
}

.storage-data-view {
  position: absolute;
  inset: 0;
  background: var(--vscode-editor-background);
  display: flex;
  flex-direction: column;
  z-index: 100;
  padding: 16px;
  gap: 12px;
}

.storage-data-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.storage-data-origin {
  font-weight: 400;
  color: var(--vscode-descriptionForeground);
}

.storage-data-scroll {
  flex: 1;
  overflow-y: auto;
}

.storage-data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.storage-data-table th,
.storage-data-table td {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.storage-data-table th {
  color: var(--vscode-descriptionForeground);
  font-weight: 600;
}

.storage-data-name {
  font-family: monospace;
}

.storage-data-value {
  color: var(--vscode-descriptionForeground);
  letter-spacing: 2px;
}

.storage-data-empty {
  color: var(--vscode-descriptionForeground);
  text-align: center;
  padding: 24px 0;
}

.storage-data-actions {
  display: flex;
  gap: 8px;
}

.storage-data-actions button {
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--vscode-button-border, transparent);
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border-radius: 2px;
}

.storage-data-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.storage-data-actions button#storage-delete-selected:not(:disabled),
.storage-data-actions button#storage-clear-all:not(:disabled) {
  background: var(--vscode-errorForeground);
  color: #fff;
}

.overflow-menu-separator {
  height: 1px;
  background: var(--vscode-panel-border);
  margin: 4px 0;
}
```

- [ ] **Step 8.4: Run all tests to confirm no regressions**

```bash
npm test -- --run
```

Expected: all tests passing.

- [ ] **Step 8.5: Commit**

```bash
git add src/webview/main.ts
git commit -m "feat: render Storage Data view and wire storage message handlers in webview"
```

---

## Task 9: Build and final verification

- [ ] **Step 9.1: Run the full test suite**

```bash
npm test -- --run
```

Expected: all tests passing, 0 failures.

- [ ] **Step 9.2: Run the TypeScript build**

```bash
npm run compile 2>&1 || npx tsc --noEmit 2>&1
```

Expected: 0 type errors.

- [ ] **Step 9.3: Run the webview build**

```bash
npm run build:webview 2>&1 || npx esbuild src/webview/main.ts --bundle --outfile=webview/main.js 2>&1
```

Check project scripts with `cat package.json | grep -A5 '"scripts"'` and use the appropriate build command.

- [ ] **Step 9.4: Final commit**

```bash
git add -A
git commit -m "chore: verify build passes for Storage Data feature"
```

---

## Checklist: Spec Coverage

| Spec requirement | Task |
|---|---|
| Cookies captured from Set-Cookie headers automatically | Task 3 |
| Cookies replayed on outbound proxy requests | Task 3 |
| SecretStorage for encrypted storage | Task 1 |
| Workspace-scoped vs global scope | Task 1 |
| `webLens.storeCookies: false` default, resource scope | Task 6 |
| Toggle in overflow menu | Task 7 |
| "View Storage Data" button (only when enabled + has data) | Task 7 |
| Storage Data view with checkbox rows and masked values | Task 8 |
| Delete Selected button | Task 8 |
| Clear All button | Task 8 |
| Cookie values never sent to webview | Tasks 5, 8 |
| Toggling off preserves stored data | Tasks 3, 5 (isEnabled() gates capture/replay, not delete) |
| Config change refreshes webview state | Tasks 4, 5 |
| Error resilience (SecretStorage failures are silent) | Task 1 |
| Unit tests for CookieStore | Task 1 |
| ProxyServer cookie tests | Task 3 |
| BrowserPanelManager storage message tests | Task 5 |
