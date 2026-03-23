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
  it('injects an early diagnostic bootstrap before app scripts', () => {
    const server = new ProxyServer('/fake-extension-path') as any;
    server.port = 41045;

    const html = `<!DOCTYPE html>
<html>
<head>
  <script src="/_next/static/chunks/main-app.js"></script>
</head>
<body>
  <div id="app"></div>
</body>
</html>`;

    const injected = server.injectScript(html);

    expect(injected).toContain("window.addEventListener('error'");
    expect(injected).toContain('http://127.0.0.1:41045/__bc_inject.js');
    expect(injected.indexOf("window.addEventListener('error'"))
      .toBeLessThan(injected.indexOf('<script src="/_next/static/chunks/main-app.js"></script>'));
  });
});
