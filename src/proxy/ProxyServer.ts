import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { webLensLogger } from '../logging';
import type { CookieStore } from '../cookies/CookieStore';

/**
 * HTTP proxy server that fetches target pages and injects our inspect script.
 *
 * Runs in the extension host process. The webview iframe loads pages through
 * this proxy so that the injected script has same-origin DOM access while
 * communication with the webview happens via postMessage (cross-origin safe).
 */
export class ProxyServer {
  private server: http.Server | null = null;
  private port = 0;
  private injectScriptPath: string;
  private targetOrigin: string; // e.g. "http://localhost:3000"
  private targetHost: string;   // e.g. "localhost:3000"
  private targetHostname: string; // e.g. "localhost"
  private targetPort: number;    // e.g. 3000
  private targetIsHttps: boolean;
  private cookieStore: CookieStore | null = null;

  constructor(extensionPath: string, targetOrigin: string) {
    this.injectScriptPath = path.join(extensionPath, 'out', 'inject.js');
    const parsed = new URL(targetOrigin);
    this.targetOrigin = `${parsed.protocol}//${parsed.host}`;
    this.targetHost = parsed.host;
    this.targetHostname = parsed.hostname;
    this.targetPort = parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 80);
    this.targetIsHttps = parsed.protocol === 'https:';
  }

  /** Start the proxy on a random available port. Resolves with the port. */
  async start(): Promise<number> {
    if (this.server) {
      return this.port;
    }

    return new Promise<number>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('upgrade', (req, clientSocket, head) => {
        this.handleUpgrade(req, clientSocket as net.Socket, head).catch((err) => {
          webLensLogger.error('WebSocket upgrade unhandled error', { error: String(err) });
          (clientSocket as net.Socket).destroy();
        });
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (typeof addr === 'object' && addr) {
          this.port = addr.port;
          webLensLogger.info('Proxy server started', { port: this.port });
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.server.on('error', reject);
    });
  }

  /** Stop the proxy server. */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        webLensLogger.info('Proxy server stopped');
        this.server = null;
        this.port = 0;
        resolve();
      });
    });
  }

  getPort(): number {
    return this.port;
  }

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

  /** The normalized origin of the proxied target (e.g. "http://localhost:3000"). */
  getTargetOrigin(): string {
    return this.targetOrigin;
  }

  /** Attach a CookieStore for capture and replay. Call before start(). */
  setCookieStore(store: CookieStore | null): void {
    this.cookieStore = store;
  }

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

    this.proxyRequest(req, res).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      webLensLogger.error('Proxy request unhandled error', { path: req.url, error: msg });
      if (!res.headersSent) {
        this.sendError(res, 500, `Internal proxy error: ${msg}`);
      }
    });
  }

  private serveInjectScript(res: http.ServerResponse) {
    try {
      const script = fs.readFileSync(this.injectScriptPath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(script);
    } catch (err) {
      this.sendError(res, 500, `Failed to read inject script: ${err}`);
    }
  }

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

  /**
   * Handle WebSocket upgrade requests by piping to the target.
   * Supports HMR for Next.js, Vite, webpack-dev-server, etc.
   */
  private async handleUpgrade(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): Promise<void> {
    const requestPath = req.url || '/';
    webLensLogger.info('Proxy WebSocket upgrade', { path: requestPath });

    // Pre-fetch stored cookies for WebSocket upgrade
    let storedCookies: Record<string, string> = {};
    if (this.cookieStore?.isEnabled()) {
      storedCookies = await this.cookieStore.get(this.targetOrigin);
    }

    const targetSocket = this.targetIsHttps
      ? tls.connect({ host: this.targetHostname, port: this.targetPort, servername: this.targetHostname })
      : net.connect(this.targetPort, this.targetHostname);
    const readyEvent = this.targetIsHttps ? 'secureConnect' : 'connect';
    const connectTimeout = setTimeout(() => {
      webLensLogger.error('Proxy WebSocket target timed out', { path: requestPath });
      targetSocket.destroy();
      clientSocket.destroy();
    }, 10000);

    targetSocket.once(readyEvent, () => {
      clearTimeout(connectTimeout);
      const headers = this.prepareRequestHeaders(req.headers, storedCookies);
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

      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });

    targetSocket.on('error', (err) => {
      clearTimeout(connectTimeout);
      webLensLogger.error('Proxy WebSocket target error', { path: requestPath, error: err.message });
      clientSocket.destroy();
    });

    clientSocket.on('error', (err) => {
      webLensLogger.error('Proxy WebSocket client error', { path: requestPath, error: err.message });
      targetSocket.destroy();
    });

    targetSocket.on('close', () => {
      clearTimeout(connectTimeout);
      clientSocket.destroy();
    });
    clientSocket.on('close', () => targetSocket.destroy());
  }

  /**
   * Prepare client request headers for forwarding to the upstream target.
   * Rewrites Host, Referer, Origin; strips Accept-Encoding, Sec-Fetch-*, hop-by-hop.
   */
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

  /** Inject our inspect script before the first <script> tag (or at end of document). */
  private injectScript(html: string): string {
    const sanitizedHtml = this.stripBlockingMetaTags(html);
    const bootstrapScriptTag = `<script>(function(){var injectSrc='/__web_lens/inject.js';var post=function(level,message,details){try{window.parent.postMessage({type:'bc:diagnostic',payload:{source:'page.bootstrap',level:level,message:message,details:details}},'*');}catch{}};var format=function(value){if(value instanceof Error){return value.stack||value.message;}if(typeof value==='string'){return value;}try{return JSON.stringify(value);}catch{return String(value);}};var ensureInject=function(reason){if(window.__webLensInjected){post('info','Inject script already attached',reason);return;}if(document.querySelector('script[data-web-lens-loader="inject"]')){post('info','Inject script request already pending',reason);return;}try{var script=document.createElement('script');script.src=injectSrc;script.async=false;script.setAttribute('data-web-lens-loader','inject');script.addEventListener('load',function(){post('info','Inject script loaded',script.src);});script.addEventListener('error',function(){post('error','Inject script failed to load',script.src);});(document.head||document.documentElement).appendChild(script);post('info','Inject script fallback requested',reason);}catch(error){post('error','Inject script fallback failed',format(error));}};window.addEventListener('error',function(event){post('error',event.message||'Unhandled page error',format(event.error||event.filename||window.location.href));});window.addEventListener('unhandledrejection',function(event){post('error','Unhandled promise rejection',format(event.reason));});post('info','Bootstrap attached',window.location.href);ensureInject('bootstrap');})();</script>`;
    const injection = bootstrapScriptTag;

    const firstScriptIndex = sanitizedHtml.search(/<script\b/i);
    if (firstScriptIndex !== -1) {
      return sanitizedHtml.slice(0, firstScriptIndex) + injection + sanitizedHtml.slice(firstScriptIndex);
    }

    const headOpenIndex = sanitizedHtml.search(/<head[^>]*>/i);
    if (headOpenIndex !== -1) {
      const headCloseAngle = sanitizedHtml.indexOf('>', headOpenIndex);
      if (headCloseAngle !== -1) {
        return sanitizedHtml.slice(0, headCloseAngle + 1) + injection + sanitizedHtml.slice(headCloseAngle + 1);
      }
    }

    const bodyCloseIndex = sanitizedHtml.lastIndexOf('</body>');
    if (bodyCloseIndex !== -1) {
      return sanitizedHtml.slice(0, bodyCloseIndex) + injection + sanitizedHtml.slice(bodyCloseIndex);
    }

    const htmlCloseIndex = sanitizedHtml.lastIndexOf('</html>');
    if (htmlCloseIndex !== -1) {
      return sanitizedHtml.slice(0, htmlCloseIndex) + injection + sanitizedHtml.slice(htmlCloseIndex);
    }

    return sanitizedHtml + injection;
  }

  private stripBlockingMetaTags(html: string): string {
    return html.replace(
      /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']?(?:content-security-policy|content-security-policy-report-only|x-frame-options)["']?)[^>]*>\s*/gi,
      ''
    );
  }

  /**
   * Strip hop-by-hop headers that must not be forwarded by proxies.
   * Forwarding these (especially `connection` and `transfer-encoding`)
   * causes HTTP parse errors in the client.
   */
  private stripHopByHopHeaders(headers: http.IncomingHttpHeaders): http.IncomingHttpHeaders {
    const cleaned = { ...headers };
    const hopByHop = [
      'connection',
      'keep-alive',
      'transfer-encoding',
      'te',
      'trailer',
      'upgrade',
      'proxy-authorization',
      'proxy-authenticate',
    ];
    for (const h of hopByHop) {
      delete cleaned[h];
    }
    return cleaned;
  }

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

  private sendError(res: http.ServerResponse, statusCode: number, message: string) {
    const html = `<!DOCTYPE html>
<html>
<head><title>Web Lens Proxy Error</title></head>
<body style="font-family:system-ui,sans-serif;padding:40px;color:#ccc;background:#1e1e1e;">
  <h2 style="color:#e74c3c;">Proxy Error (${statusCode})</h2>
  <p>${this.escapeHtml(message)}</p>
  <p style="color:#888;font-size:12px;margin-top:20px;">
    This page is served by the Web Lens proxy. The target URL could not be loaded.
  </p>
</body>
</html>`;
    res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
