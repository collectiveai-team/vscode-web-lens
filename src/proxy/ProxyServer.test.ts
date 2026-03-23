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
  });
});
