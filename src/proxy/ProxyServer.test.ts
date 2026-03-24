import * as http from 'http';
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

    it('forwards request bodies for DELETE requests', async () => {
      let receivedBody = '';

      const upstream = http.createServer((req, res) => {
        req.on('data', (chunk) => {
          receivedBody += chunk.toString();
        });
        req.on('end', () => {
          res.writeHead(204);
          res.end();
        });
      });

      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
      const upstreamAddress = upstream.address();
      if (!upstreamAddress || typeof upstreamAddress === 'string') {
        throw new Error('Failed to get upstream server address');
      }

      const server = new ProxyServer('/fake-path', `http://127.0.0.1:${upstreamAddress.port}`);
      const proxyPort = await server.start();

      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: proxyPort,
            path: '/api/item/123',
            method: 'DELETE',
            headers: {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength('{"hard":true}'),
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve());
          }
        );

        req.on('error', reject);
        req.write('{"hard":true}');
        req.end();
      });

      expect(receivedBody).toBe('{"hard":true}');

      await server.stop();
      await new Promise<void>((resolve, reject) => {
        upstream.close((err) => (err ? reject(err) : resolve()));
      });
    });
  });

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

      expect(injected).toContain("window.addEventListener('error'");
      expect(injected).toContain('/__web_lens/inject.js');
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

      expect(injected).not.toContain('<base');
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

    it('removes meta CSP tags that would block the injected script', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      server.port = 9000;

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'nonce-app'; style-src 'self'">
  <script src="/app.js"></script>
</head>
<body></body>
</html>`;

      const injected = server.injectScript(html);

      expect(injected).not.toContain('Content-Security-Policy');
      expect(injected).toContain('/__web_lens/inject.js');
    });

    it('adds bootstrap diagnostics for inject fallback request and load events', () => {
      const server = new ProxyServer('/fake-path', 'http://localhost:3000') as any;
      server.port = 9000;

      const injected = server.injectScript('<html><head></head><body></body></html>');

      expect(injected).toContain('Inject script fallback requested');
      expect(injected).toContain('Inject script loaded');
      expect(injected).toContain('Inject script failed to load');
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
});
