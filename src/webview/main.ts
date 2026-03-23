import type { ExtensionMessage, ConsoleEntry } from '../types';
import { createToolbar } from './toolbar';
import { createInspectOverlay } from './inspect-overlay';
import { createConsoleCapture } from './console-capture';

// VS Code webview API
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

function postMessage(msg: unknown) {
  vscode.postMessage(msg);
}

function postDiagnostic(level: 'info' | 'warn' | 'error', source: string, message: string, details?: string) {
  postMessage({
    type: 'diagnostic:log',
    payload: { source, level, message, details },
  });
}

// ── Console capture state (per iframe) ──────────────────────
let consoleCapture: ReturnType<typeof createConsoleCapture> | null = null;

// ── Initialize toolbar ──────────────────────────────────────
const toolbarContainer = document.getElementById('toolbar')!;
const toolbar = createToolbar(toolbarContainer, postMessage, {
  onLogsRequest() {
    const entries: ConsoleEntry[] = consoleCapture?.getEntries() ?? [];
    postMessage({ type: 'action:addLogs', payload: { logs: entries } });
  },
  onScreenshotRequest() {
    // Request screenshot from the inject script inside the iframe
    overlay.requestScreenshot().then((dataUrl) => {
      postMessage({ type: 'action:screenshot', payload: { dataUrl } });
    });
  },
  onBackendRequest() {
    postMessage({ type: 'backend:request', payload: {} });
  },
  onBackendSelect(backend: string) {
    postMessage({ type: 'backend:select', payload: { backend } });
  },
});

// ── Get iframe reference ────────────────────────────────────
const iframe = document.getElementById('browser-iframe') as HTMLIFrameElement;

// ── Initialize inspect overlay (message relay) ──────────────
const overlay = createInspectOverlay(iframe, postMessage);

// Sync toolbar state changes with overlay mode
toolbar.onStateChange((state) => {
  if (state.inspectActive) {
    overlay.setMode('inspect');
  } else if (state.addElementActive) {
    overlay.setMode('addElement');
  } else {
    overlay.setMode('off');
  }
});

// ── iframe load handler ─────────────────────────────────────
iframe.addEventListener('load', () => {
  // With the proxy approach, the iframe content is loaded through our proxy
  // so it appears same-origin. But we keep the try/catch for safety.
  let url = '';
  let title = '';
  let canInject = true; // Proxy always injects

  try {
    url = iframe.contentWindow?.location.href || '';
    title = iframe.contentDocument?.title || '';
  } catch {
    url = iframe.src;
    canInject = false;
  }

  // Extract the original URL from the proxy URL if present
  const originalUrl = extractOriginalUrl(url);

  if (originalUrl && originalUrl !== 'about:blank') {
    toolbar.setUrl(originalUrl);
    postMessage({
      type: 'iframe:loaded',
      payload: { url: originalUrl, title, canInject },
    });
  }

  // Attach console capture on same-origin iframe load
  if (canInject) {
    try {
      const iframeConsole = (iframe.contentWindow as any)?.console as Console | undefined;
      if (iframeConsole) {
        consoleCapture?.detach();
        consoleCapture = createConsoleCapture(iframeConsole, (entry) => {
          postDiagnostic(entry.level === 'log' ? 'info' : entry.level, 'page.console', entry.message);
        });
      }
    } catch {
      // Cross-origin — skip
    }
  }

  postDiagnostic('info', 'webview', 'Iframe loaded', `url=${originalUrl || url}; canInject=${String(canInject)}`);
});

iframe.addEventListener('error', () => {
  const originalUrl = extractOriginalUrl(iframe.src);
  postDiagnostic('error', 'webview', 'Iframe failed to load', originalUrl || iframe.src);
  postMessage({
    type: 'iframe:error',
    payload: { url: originalUrl || iframe.src, error: 'Failed to load page' },
  });
});

window.addEventListener('error', (event: ErrorEvent) => {
  postDiagnostic(
    'error',
    'webview',
    event.message || 'Unhandled webview error',
    formatUnknown(event.error || event.filename || 'unknown error')
  );
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  postDiagnostic('error', 'webview', 'Unhandled promise rejection', formatUnknown(event.reason));
});

// Request initial backend state so the toolbar icon is correct from the start
postMessage({ type: 'backend:request', payload: {} });

// ── Listen for messages from extension host ─────────────────
window.addEventListener('message', async (event: MessageEvent) => {
  const message = event.data;
  if (!message || !message.type) return;

  // Skip messages from the inject script (bc: prefix) — handled by inspect-overlay
  if (typeof message.type === 'string' && message.type.startsWith('bc:')) return;

  const msg = message as ExtensionMessage;

  switch (msg.type) {
    case 'navigate:url':
      iframe.src = msg.payload.url;
      // Show the original URL in the toolbar, not the proxy URL
      toolbar.setUrl(extractOriginalUrl(msg.payload.url) || msg.payload.url);
      break;

    case 'mode:inspect':
      toolbar.setInspectActive(msg.payload.enabled);
      overlay.setMode(msg.payload.enabled ? 'inspect' : 'off');
      break;

    case 'mode:addElement':
      toolbar.setAddElementActive(msg.payload.enabled);
      overlay.setMode(msg.payload.enabled ? 'addElement' : 'off');
      break;

    case 'screenshot:request': {
      const dataUrl = await overlay.requestScreenshot();
      postMessage({ type: 'action:screenshot', payload: { dataUrl } });
      break;
    }

    case 'config:update':
      // Config updates handled in Chunk 4
      break;

    case 'backend:state':
      toolbar.setBackendState(msg.payload.active, msg.payload.available);
      break;

    case 'theme:update':
      document.body.dataset.theme = msg.payload.kind;
      break;

    case 'toast':
      showToast(msg.payload.message, msg.payload.toastType);
      break;
  }
});

// ── Helpers ────────────────────────────────────────────────

/**
 * Extract the original target URL from a proxy URL.
 * Proxy URLs look like: http://127.0.0.1:<port>/?url=<encodedTargetUrl>
 */
function extractOriginalUrl(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl);
    const urlParam = parsed.searchParams.get('url');
    if (urlParam) return urlParam;
  } catch {
    // Not a valid URL — return as-is
  }
  return proxyUrl;
}

function showToast(message: string, toastType: 'success' | 'error') {
  const toast = document.createElement('div');
  toast.className = `toast ${toastType}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2600);
}

function formatUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
