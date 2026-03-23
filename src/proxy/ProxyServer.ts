import * as http from 'http';
import * as https from 'https';
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
    webLensLogger.info('Proxy request started', { url: targetUrl.href });
    const isHttps = targetUrl.protocol === 'https:';
    const requestModule = isHttps ? https : http;

    const options: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: 'GET',
      headers: {
        'Host': targetUrl.host,
        'User-Agent': 'WebLens-Proxy/1.0',
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
          webLensLogger.info('Proxy HTML response', {
            url: targetUrl.href,
            statusCode: proxyRes.statusCode || 200,
          });

          // Forward headers but override content-length
          const headers = this.stripHopByHopHeaders(proxyRes.headers);
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
        webLensLogger.info('Proxy asset response', {
          url: targetUrl.href,
          statusCode: proxyRes.statusCode || 200,
          contentType,
        });
        // Non-HTML: stream through unchanged
        const headers = this.stripHopByHopHeaders(proxyRes.headers);
        // Remove frame-blocking headers for non-HTML too
        delete headers['x-frame-options'];
        delete headers['content-security-policy'];
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      }
    });

    proxyReq.on('error', (err) => {
      webLensLogger.error('Proxy request failed', { url: targetUrl.href, error: err.message });
      this.sendError(res, 502, `Failed to fetch ${targetUrl.href}: ${err.message}`);
    });

    proxyReq.setTimeout(10000, () => {
      proxyReq.destroy();
      webLensLogger.error('Proxy request timed out', { url: targetUrl.href });
      this.sendError(res, 504, `Request to ${targetUrl.href} timed out`);
    });

    proxyReq.end();
  }

  /** Inject our inspect script before </body> (or at end of document). */
  private injectScript(html: string): string {
    const externalScriptTag = `<script src="http://127.0.0.1:${this.port}/__bc_inject.js"></script>`;
    const bootstrapScriptTag = `<script>(function(){var post=function(level,message,details){try{window.parent.postMessage({type:'bc:diagnostic',payload:{source:'page.bootstrap',level:level,message:message,details:details}},'*');}catch{}};var format=function(value){if(value instanceof Error){return value.stack||value.message;}if(typeof value==='string'){return value;}try{return JSON.stringify(value);}catch{return String(value);}};var patchHistory=function(method){var orig=history[method];history[method]=function(state,title,url){try{return orig.call(this,state,title,url);}catch(e){if(e.name==='SecurityError'){post('warn','Suppressed cross-origin '+method,String(url));return;}throw e;}};};patchHistory('pushState');patchHistory('replaceState');window.addEventListener('error',function(event){post('error',event.message||'Unhandled page error',format(event.error||event.filename||window.location.href));});window.addEventListener('unhandledrejection',function(event){post('error','Unhandled promise rejection',format(event.reason));});post('info','Bootstrap attached',window.location.href);})();</script>`;
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
