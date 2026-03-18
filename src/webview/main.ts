import type { ExtensionMessage } from '../types';
import { createToolbar } from './toolbar';

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

// ── Initialize toolbar ──────────────────────────────────────
const toolbarContainer = document.getElementById('toolbar')!;
const toolbar = createToolbar(toolbarContainer, postMessage);

// ── Get iframe reference ────────────────────────────────────
const iframe = document.getElementById('browser-iframe') as HTMLIFrameElement;

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
});

iframe.addEventListener('error', () => {
  postMessage({
    type: 'iframe:error',
    payload: { url: iframe.src, error: 'Failed to load page' },
  });
});

// ── Listen for messages from extension host ─────────────────
window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as ExtensionMessage;
  if (!message || !message.type) return;

  switch (message.type) {
    case 'navigate:url':
      iframe.src = message.payload.url;
      toolbar.setUrl(message.payload.url);
      break;

    case 'mode:inspect':
      toolbar.setInspectActive(message.payload.enabled);
      // Inspect overlay will be wired in Chunk 3 (Task 10)
      break;

    case 'mode:addElement':
      toolbar.setAddElementActive(message.payload.enabled);
      // Inspect overlay will be wired in Chunk 3 (Task 10)
      break;

    case 'screenshot:request':
      // Screenshot capture will be wired in Chunk 3 (Task 10)
      break;

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
