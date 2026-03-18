import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';

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

  constructor(extensionPath: string) {
    this.injectScriptPath = path.join(extensionPath, 'out', 'inject.js');
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

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (typeof addr === 'object' && addr) {
          this.port = addr.port;
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
    return `http://127.0.0.1:${this.port}/?url=${encodeURIComponent(targetUrl)}`;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // CORS headers on all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);

    // Serve the inject script bundle
    if (requestUrl.pathname === '/__bc_inject.js') {
      this.serveInjectScript(res);
      return;
    }

    // All other requests need a `url` query param
    const targetUrlStr = requestUrl.searchParams.get('url');
    if (!targetUrlStr) {
      this.sendError(res, 400, 'Missing ?url= parameter');
      return;
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch {
      this.sendError(res, 400, `Invalid target URL: ${targetUrlStr}`);
      return;
    }

    this.proxyRequest(targetUrl, res);
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

  private proxyRequest(targetUrl: URL, res: http.ServerResponse) {
    const isHttps = targetUrl.protocol === 'https:';
    const requestModule = isHttps ? https : http;

    const options: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'BrowserChat-Proxy/1.0',
        'Accept': '*/*',
      },
    };

    const proxyReq = requestModule.request(options, (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';
      const isHtml = contentType.includes('text/html');

      if (isHtml) {
        // Buffer the HTML so we can inject our script and rewrite URLs
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf-8');
          html = this.injectScript(html);
          html = this.rewriteUrls(html, targetUrl);

          // Forward headers but override content-length
          const headers = { ...proxyRes.headers };
          delete headers['content-length'];
          delete headers['content-encoding'];
          // Remove security headers that would block our injection
          delete headers['content-security-policy'];
          delete headers['content-security-policy-report-only'];
          delete headers['x-frame-options'];

          res.writeHead(proxyRes.statusCode || 200, headers);
          res.end(html);
        });
      } else {
        // Non-HTML: stream through unchanged
        const headers = { ...proxyRes.headers };
        // Remove frame-blocking headers for non-HTML too
        delete headers['x-frame-options'];
        delete headers['content-security-policy'];
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      }
    });

    proxyReq.on('error', (err) => {
      this.sendError(res, 502, `Failed to fetch ${targetUrl.href}: ${err.message}`);
    });

    proxyReq.setTimeout(10000, () => {
      proxyReq.destroy();
      this.sendError(res, 504, `Request to ${targetUrl.href} timed out`);
    });

    proxyReq.end();
  }

  /** Inject our inspect script before </body> (or at end of document). */
  private injectScript(html: string): string {
    const scriptTag = `<script src="http://127.0.0.1:${this.port}/__bc_inject.js"></script>`;

    // Try to inject before </body>
    const bodyCloseIndex = html.lastIndexOf('</body>');
    if (bodyCloseIndex !== -1) {
      return html.slice(0, bodyCloseIndex) + scriptTag + html.slice(bodyCloseIndex);
    }

    // Try before </html>
    const htmlCloseIndex = html.lastIndexOf('</html>');
    if (htmlCloseIndex !== -1) {
      return html.slice(0, htmlCloseIndex) + scriptTag + html.slice(htmlCloseIndex);
    }

    // Fallback: append at end
    return html + scriptTag;
  }

  /**
   * Rewrite relative URLs in HTML to go through the proxy.
   * This ensures navigation within the site continues through the proxy.
   */
  private rewriteUrls(html: string, baseUrl: URL): string {
    const base = `${baseUrl.protocol}//${baseUrl.host}`;
    const proxyBase = `http://127.0.0.1:${this.port}/?url=`;

    // Rewrite href="/..." and src="/..." (absolute-path references)
    html = html.replace(
      /((?:href|src|action)\s*=\s*["'])(\/(?!\/)[^"']*)(["'])/gi,
      (_match, prefix, urlPath, suffix) => {
        return `${prefix}${proxyBase}${encodeURIComponent(base + urlPath)}${suffix}`;
      }
    );

    // Inject <base> tag so the browser resolves relative URLs correctly.
    // We use the original base URL so that relative paths like "style.css"
    // resolve against the target origin. The proxy handles absolute-path
    // rewrites above; truly relative paths (no leading /) are handled by <base>.
    const baseTag = `<base href="${base}${baseUrl.pathname.replace(/\/[^/]*$/, '/')}">`;
    const headIndex = html.indexOf('<head');
    if (headIndex !== -1) {
      const headCloseAngle = html.indexOf('>', headIndex);
      if (headCloseAngle !== -1) {
        html = html.slice(0, headCloseAngle + 1) + baseTag + html.slice(headCloseAngle + 1);
      }
    }

    return html;
  }

  private sendError(res: http.ServerResponse, statusCode: number, message: string) {
    const html = `<!DOCTYPE html>
<html>
<head><title>Browser Chat Proxy Error</title></head>
<body style="font-family:system-ui,sans-serif;padding:40px;color:#ccc;background:#1e1e1e;">
  <h2 style="color:#e74c3c;">Proxy Error (${statusCode})</h2>
  <p>${this.escapeHtml(message)}</p>
  <p style="color:#888;font-size:12px;margin-top:20px;">
    This page is served by the Browser Chat proxy. The target URL could not be loaded.
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
