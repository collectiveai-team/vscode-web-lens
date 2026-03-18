import type { ExtensionMessage, ConsoleEntry } from '../types';
import { createToolbar } from './toolbar';
import { createInspectOverlay } from './inspect-overlay';
import { createConsoleCapture } from './console-capture';
import { captureScreenshot } from './screenshot';

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
    const iframe = document.getElementById('browser-iframe') as HTMLIFrameElement;
    try {
      if (iframe.contentDocument?.body) {
        captureScreenshot(iframe.contentDocument.body, iframe.clientWidth, iframe.clientHeight).then(
          (dataUrl) => {
            postMessage({ type: 'action:screenshot', payload: { dataUrl } });
          }
        );
      }
    } catch {
      // Cross-origin — can't capture
      postMessage({ type: 'action:screenshot', payload: { dataUrl: '' } });
    }
  },
});

// ── Get iframe reference ────────────────────────────────────
const iframe = document.getElementById('browser-iframe') as HTMLIFrameElement;

// ── Initialize inspect overlay ──────────────────────────────
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
  let url = '';
  let title = '';
  let canInject = false;

  try {
    // Same-origin: we can access contentWindow.location
    url = iframe.contentWindow?.location.href || '';
    title = iframe.contentDocument?.title || '';
    canInject = true;
  } catch {
    // Cross-origin: use the last known URL
    url = iframe.src;
    canInject = false;
  }

  if (url && url !== 'about:blank') {
    toolbar.setUrl(url);
    postMessage({
      type: 'iframe:loaded',
      payload: { url, title, canInject },
    });
  }

  // Attach console capture on same-origin iframe load
  if (canInject) {
    try {
      const iframeConsole = (iframe.contentWindow as any)?.console as Console | undefined;
      if (iframeConsole) {
        // Detach previous capture if any
        consoleCapture?.detach();
        consoleCapture = createConsoleCapture(iframeConsole);
      }
    } catch {
      // Cross-origin — skip
    }
  }
});

iframe.addEventListener('error', () => {
  postMessage({
    type: 'iframe:error',
    payload: { url: iframe.src, error: 'Failed to load page' },
  });
});

// ── Listen for messages from extension host ─────────────────
window.addEventListener('message', async (event: MessageEvent) => {
  const message = event.data as ExtensionMessage;
  if (!message || !message.type) return;

  switch (message.type) {
    case 'navigate:url':
      iframe.src = message.payload.url;
      toolbar.setUrl(message.payload.url);
      break;

    case 'mode:inspect':
      toolbar.setInspectActive(message.payload.enabled);
      overlay.setMode(message.payload.enabled ? 'inspect' : 'off');
      break;

    case 'mode:addElement':
      toolbar.setAddElementActive(message.payload.enabled);
      overlay.setMode(message.payload.enabled ? 'addElement' : 'off');
      break;

    case 'screenshot:request': {
      try {
        if (iframe.contentDocument?.body) {
          const dataUrl = await captureScreenshot(
            iframe.contentDocument.body,
            iframe.clientWidth,
            iframe.clientHeight
          );
          postMessage({ type: 'action:screenshot', payload: { dataUrl } });
        }
      } catch {
        // Cross-origin — can't capture
        postMessage({ type: 'action:screenshot', payload: { dataUrl: '' } });
      }
      break;
    }

    case 'config:update':
      // Config updates handled in Chunk 4
      break;

    case 'toast':
      showToast(message.payload.message, message.payload.toastType);
      break;
  }
});

// ── Toast helper ────────────────────────────────────────────
function showToast(message: string, toastType: 'success' | 'error') {
  const toast = document.createElement('div');
  toast.className = `toast ${toastType}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2600);
}
