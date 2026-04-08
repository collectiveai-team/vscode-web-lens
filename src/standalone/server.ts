/**
 * Standalone dev server for web-lens.
 *
 * Replaces the VS Code extension host with a plain Node.js HTTP server so the
 * webview UI can be developed and tested in any browser without VS Code.
 *
 * Usage (via package.json script):
 *   npm run dev:standalone
 *
 * Environment variables:
 *   PORT        HTTP port for this server (default: 3000)
 *   TARGET_URL  URL of the local app to proxy (default: http://127.0.0.1:5173)
 *
 * Note: changes to this file require restarting the dev server process.
 * All other source files hot-reload automatically via esbuild --watch.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { ProxyServer } from '../proxy/ProxyServer';
import { ContextExtractor } from '../context/ContextExtractor';
import type { WebviewMessage, ExtensionMessage } from '../types';
import { handleStandaloneContextDelivery } from './contextDelivery';

// -- Configuration -------------------------------------------------------------

const MAX_MESSAGE_BODY_BYTES = 1024 * 1024; // 1 MiB
const DEFAULT_STANDALONE_PORT = 3000;
const DEFAULT_TARGET_URL = 'http://127.0.0.1:5173';
const SHUTDOWN_TIMEOUT_MS = 5000;

// __dirname is out/standalone/ after esbuild compilation
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// -- SSE client registry -------------------------------------------------------

const sseClients = new Set<http.ServerResponse>();

function parseStandalonePort(value: string | undefined): number {
  const parsed = Number.parseInt(value || String(DEFAULT_STANDALONE_PORT), 10);
  return Number.isNaN(parsed) ? DEFAULT_STANDALONE_PORT : parsed;
}

function resolveUrlPort(url: URL): number {
  if (url.port) {
    return Number.parseInt(url.port, 10);
  }
  return url.protocol === 'https:' ? 443 : 80;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function assertNoImplicitDefaultSelfTarget(
  port: number,
  targetUrl: string,
  targetUrlExplicit: boolean
): void {
  if (targetUrlExplicit) {
    return;
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return;
  }

  if (!isLoopbackHostname(parsedTarget.hostname)) {
    return;
  }

  if (resolveUrlPort(parsedTarget) !== port) {
    return;
  }

  throw new Error(
    `[standalone] Invalid startup defaults: PORT=${port} and TARGET_URL=${targetUrl} point to the same local server. Set TARGET_URL to your app URL (for example http://127.0.0.1:5173) or set PORT to a different value.`
  );
}

function closeSseClientsForShutdown(clients: Set<http.ServerResponse>): void {
  const activeClients = Array.from(clients);
  clients.clear();

  for (const client of activeClients) {
    try {
      client.end();
    } catch {
      // Best effort during shutdown.
    }

    try {
      client.socket?.end();
      client.socket?.destroy();
    } catch {
      // Best effort during shutdown.
    }
  }
}

function waitForServerListen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };

    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port, '127.0.0.1');
  });
}

type BroadcastMessage =
  | ExtensionMessage
  | { type: 'copyToClipboard'; text: string }
  | { type: '__standalone_reload' };

function broadcast(msg: BroadcastMessage): void {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

// -- Static file helpers -------------------------------------------------------

const MIME: Record<string, string> = {
  '.js': 'application/javascript',
  '.map': 'application/json',
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function serveFile(res: http.ServerResponse, filePath: string): void {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// -- Backend state -------------------------------------------------------------
// Only clipboard is available in standalone mode.

const STANDALONE_BACKEND_STATE: ExtensionMessage = {
  type: 'backend:state',
  payload: {
    active: 'clipboard',
    available: {
      clipboard: true,
      opencode: false,
      openchamber: false,
      codex: false,
      claudecode: false,
    },
  },
};

// -- Main ----------------------------------------------------------------------

async function main(): Promise<void> {
  const port = parseStandalonePort(process.env.PORT);
  const targetUrl = process.env.TARGET_URL || DEFAULT_TARGET_URL;
  assertNoImplicitDefaultSelfTarget(port, targetUrl, process.env.TARGET_URL !== undefined);

  // Start proxy server (same ProxyServer used by the VS Code extension)
  const proxy = new ProxyServer(PROJECT_ROOT, targetUrl);
  await proxy.start();
  console.log(`[standalone] Proxy started -> ${proxy.getTargetOrigin()} via 127.0.0.1:${proxy.getPort()}`);

  const contextExtractor = new ContextExtractor();

  // Load HTML template once; {{TARGET_ORIGIN}} replaced per request
  const htmlTemplate = fs.readFileSync(
    path.join(__dirname, '../../src/standalone/index.html'),
    'utf8'
  );

  // Navigation history - mirrors BrowserPanelManager state
  const history: string[] = [targetUrl];
  let historyIndex = 0;
  let currentUrl = targetUrl;

  // -- WebviewMessage router -------------------------------------------------

  function handleMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'navigate': {
        history.splice(historyIndex + 1);
        history.push(message.payload.url);
        historyIndex = history.length - 1;
        currentUrl = message.payload.url;
        broadcast({ type: 'navigate:url', payload: { url: proxy.getProxiedUrl(currentUrl) } });
        break;
      }

      case 'nav:back': {
        if (historyIndex > 0) {
          historyIndex--;
          currentUrl = history[historyIndex];
          broadcast({ type: 'navigate:url', payload: { url: proxy.getProxiedUrl(currentUrl) } });
        }
        break;
      }

      case 'nav:forward': {
        if (historyIndex < history.length - 1) {
          historyIndex++;
          currentUrl = history[historyIndex];
          broadcast({ type: 'navigate:url', payload: { url: proxy.getProxiedUrl(currentUrl) } });
        }
        break;
      }

      case 'nav:reload': {
        broadcast({ type: 'navigate:url', payload: { url: proxy.getProxiedUrl(currentUrl) } });
        break;
      }

      case 'iframe:loaded': {
        // SPA navigation or server redirect - convert proxy-space URL back to target-space
        const original = proxy.getOriginalUrl(message.payload.url);
        if (original !== currentUrl) {
          history.splice(historyIndex + 1);
          history.push(original);
          historyIndex = history.length - 1;
          currentUrl = original;
        }
        break;
      }

      case 'iframe:error': {
        broadcast({
          type: 'toast',
          payload: { message: `Failed to load: ${message.payload.error}`, toastType: 'error' },
        });
        break;
      }

      case 'menu:copyHtml': {
        broadcast({ type: 'copyToClipboard', text: message.payload.html });
        broadcast({ type: 'toast', payload: { message: 'HTML copied to clipboard', toastType: 'success' } });
        break;
      }

      case 'menu:openSettings': {
        broadcast({ type: 'toast', payload: { message: 'Settings not available in standalone mode', toastType: 'error' } });
        break;
      }

      case 'menu:clearSelection': {
        // Handled in webview overlay - no server action needed
        break;
      }

      case 'inspect:selected': {
        // Inspect overlay state is managed in the webview - no server action needed
        break;
      }

      case 'backend:request': {
        broadcast(STANDALONE_BACKEND_STATE);
        break;
      }

      case 'backend:select': {
        // Only clipboard works in standalone; always reply with clipboard-only state
        broadcast(STANDALONE_BACKEND_STATE);
        break;
      }

      case 'diagnostic:log': {
        const { level, source, message: msg } = message.payload;
        const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        logFn(`[${source}] ${msg}`);
        break;
      }
      case 'inspect:sendToChat':
      case 'annotate:sendToChat':
      case 'addElement:captured':
      case 'action:addLogs':
      case 'action:screenshot': {
        handleStandaloneContextDelivery(message, { contextExtractor, currentUrl, broadcast });
        break;
      }
    }
  }

  // -- Static file map: URL path -> filesystem path ---------------------------

  const STATIC: Record<string, string> = {
    '/webview/main.js': path.join(PROJECT_ROOT, 'webview/main.js'),
    '/webview/main.js.map': path.join(PROJECT_ROOT, 'webview/main.js.map'),
    '/webview/main.css': path.join(PROJECT_ROOT, 'webview/main.css'),
    '/out/inject.js': path.join(PROJECT_ROOT, 'out/inject.js'),
    '/vscode-shim.js': path.join(PROJECT_ROOT, 'out/standalone/vscode-shim.js'),
    '/vscode-shim.js.map': path.join(PROJECT_ROOT, 'out/standalone/vscode-shim.js.map'),
  };

  // -- HTTP server -------------------------------------------------------------

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';

    res.setHeader('Access-Control-Allow-Origin', '*');

    // SSE stream: extension -> browser
    if (url === '/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      sseClients.add(res);

      // Bootstrap: send backend state so toolbar renders immediately
      res.write(`data: ${JSON.stringify(STANDALONE_BACKEND_STATE)}\n\n`);
      // Bootstrap: navigate iframe to initial URL
      const initNav: ExtensionMessage = {
        type: 'navigate:url',
        payload: { url: proxy.getProxiedUrl(currentUrl) },
      };
      res.write(`data: ${JSON.stringify(initNav)}\n\n`);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // Message endpoint: browser -> extension
    if (url === '/message' && method === 'POST') {
      let body = '';
      let bodyBytes = 0;
      let rejected = false;

      req.on('data', (chunk: Buffer) => {
        if (rejected) {
          return;
        }

        bodyBytes += chunk.length;
        if (bodyBytes > MAX_MESSAGE_BODY_BYTES) {
          rejected = true;
          res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Payload too large');
          req.destroy();
          return;
        }

        body += chunk.toString();
      });

      req.on('end', () => {
        if (rejected) {
          return;
        }

        try {
          handleMessage(JSON.parse(body) as WebviewMessage);
        } catch {
          // Ignore malformed messages
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }

    // Internal: esbuild rebuild notification -> broadcast hot-reload to browsers
    if (url === '/internal/rebuilt' && method === 'POST') {
      broadcast({ type: '__standalone_reload' });
      res.writeHead(204);
      res.end();
      return;
    }

    // Static files: GET only from here
    if (method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }

    // Root -> HTML template with target origin injected
    if (url === '/') {
      const html = htmlTemplate.replace('{{TARGET_ORIGIN}}', proxy.getTargetOrigin());
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    // Backend icons
    if (url.startsWith('/media/icons/')) {
      const iconName = url.replace('/media/icons/', '');
      // Reject path traversal attempts
      if (iconName.includes('..') || iconName.includes('/')) {
        res.writeHead(400);
        res.end();
        return;
      }
      serveFile(res, path.join(PROJECT_ROOT, 'media', 'icons', iconName));
      return;
    }

    // Other known static files
    if (STATIC[url]) {
      serveFile(res, STATIC[url]);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  try {
    await waitForServerListen(server, port);
  } catch (err) {
    const listenError = err as NodeJS.ErrnoException;
    if (listenError.code === 'EADDRINUSE') {
      console.error(`[standalone] Failed to bind HTTP server: 127.0.0.1:${port} is already in use.`);
    } else {
      console.error('[standalone] Failed to bind HTTP server:', listenError);
    }

    await proxy.stop().catch((stopError: unknown) => {
      console.error('[standalone] Failed while stopping proxy after bind error:', stopError);
    });

    process.exit(1);
    return;
  }

  server.on('error', (err: Error) => {
    console.error('[standalone] HTTP server error:', err);
  });

  console.log(`[standalone] Web Lens dev server -> http://127.0.0.1:${port}`);
  console.log('[standalone] Open that URL in your browser');
  console.log(`[standalone] Proxying ${proxy.getTargetOrigin()}`);
  console.log('[standalone] Watching src/ for changes (hot reload active)...');

  // -- esbuild watch child process --------------------------------------------
  // Spawned after the HTTP server is up so the first /internal/rebuilt POST
  // (from the initial watch build) has a server to land on.

  const esbuildProc = spawn('node', ['esbuild.config.js', '--watch'], {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(port) },
  });

  esbuildProc.on('error', (err: Error) => {
    console.error('[standalone] esbuild watch failed to start:', err.message);
  });

  // -- Graceful shutdown -------------------------------------------------------

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    console.log(`\n[standalone] Shutting down (${signal})...`);
    esbuildProc.kill(signal);
    closeSseClientsForShutdown(sseClients);

    const timeout = setTimeout(() => {
      console.error(`[standalone] Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit.`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timeout.unref();

    proxy.stop()
      .catch((err: unknown) => {
        console.error('[standalone] Error while stopping proxy during shutdown:', err);
      })
      .finally(() => {
        try {
          server.close((closeErr?: Error) => {
            if (closeErr) {
              console.error('[standalone] Error while closing HTTP server:', closeErr);
              clearTimeout(timeout);
              process.exit(1);
              return;
            }

            clearTimeout(timeout);
            process.exit(0);
          });
        } catch (closeErr) {
          console.error('[standalone] Error while closing HTTP server:', closeErr);
          clearTimeout(timeout);
          process.exit(1);
        }
      });
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

main().catch((err: unknown) => {
  console.error('[standalone] Fatal error:', err);
  process.exit(1);
});
