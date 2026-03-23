import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { webLensLogger } from '../logging';

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
        this.handleUpgrade(req, clientSocket as net.Socket, head);
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

    // Pipe request body for POST/PUT/PATCH
    if (req.method && ['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())) {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  }

  /**
   * Handle WebSocket upgrade requests by piping to the target.
   * Supports HMR for Next.js, Vite, webpack-dev-server, etc.
   */
  private handleUpgrade(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) {
    const requestPath = req.url || '/';
    webLensLogger.info('Proxy WebSocket upgrade', { path: requestPath });

    const targetSocket = net.connect(this.targetPort, this.targetHostname, () => {
      const headers = this.prepareRequestHeaders(req.headers);
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

      let headersSent = false;
      targetSocket.on('data', (chunk) => {
        if (!headersSent) {
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
