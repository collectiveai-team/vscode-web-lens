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
