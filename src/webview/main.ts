import type { ExtensionMessage, ConsoleEntry } from '../types';
import { createToolbar } from './toolbar';
import { createInspectOverlay } from './inspect-overlay';
import { createConsoleReceiver } from './console-capture';

// VS Code webview API
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const targetOrigin = document.body.dataset.targetOrigin || '';

function postMessage(msg: unknown) {
  vscode.postMessage(msg);
}

function postDiagnostic(level: 'info' | 'warn' | 'error', source: string, message: string, details?: string) {
  postMessage({
    type: 'diagnostic:log',
    payload: { source, level, message, details },
  });
}

// ── Console receiver state ──────────────────────────────────
const consoleReceiver = createConsoleReceiver((entry) => {
  postDiagnostic(entry.level === 'log' ? 'info' : entry.level, 'page.console', entry.message);
});

// ── Initialize toolbar ──────────────────────────────────────
const toolbarContainer = document.getElementById('toolbar')!;
const toolbar = createToolbar(toolbarContainer, postMessage, {
  onLogsRequest() {
    const entries: ConsoleEntry[] = consoleReceiver.getEntries();
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
  let url = iframe.src;
  let title = '';
  let canInject = true; // Proxy always injects

  try {
    url = iframe.contentWindow?.location.href || '';
    title = iframe.contentDocument?.title || '';
  } catch {
    url = iframe.src;
    canInject = false;
  }

  const originalUrl = extractOriginalUrl(url);

  if (originalUrl && originalUrl !== 'about:blank') {
    toolbar.setUrl(originalUrl);
    postMessage({
      type: 'iframe:loaded',
      payload: { url: originalUrl, title, canInject },
    });
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

  if (message.type === 'bc:navigated') {
    const originalUrl = extractOriginalUrl(message.payload?.url || iframe.src);
    let title = '';

    try {
      title = iframe.contentDocument?.title || '';
    } catch {
      // Ignore title lookup failures for cross-origin transitions.
    }

    toolbar.setUrl(originalUrl || message.payload?.url || iframe.src);
    postMessage({
      type: 'iframe:loaded',
      payload: { url: originalUrl || message.payload?.url || iframe.src, title, canInject: true },
    });
    return;
  }

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

    case 'storage:state':
      toolbar.setStorageDataState(msg.payload.enabled, msg.payload.hasData);
      break;

    case 'storage:view':
      showStorageDataView(msg.payload.origin, msg.payload.names);
      break;
  }
});

// ── Helpers ────────────────────────────────────────────────

/**
 * Reconstruct the original target URL from a proxy URL by replacing the
 * 127.0.0.1:PORT origin with the configured target origin.
 * Returns the input unchanged if it is not a proxy URL.
 */
function extractOriginalUrl(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl);
    if (parsed.hostname === '127.0.0.1' && targetOrigin) {
      const target = new URL(targetOrigin);
      return `${target.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showStorageDataView(origin: string, names: string[]) {
  // Remove any existing view
  document.getElementById('storage-data-view')?.remove();

  const view = document.createElement('div');
  view.id = 'storage-data-view';
  view.className = 'storage-data-view';

  const rowsHtml = names.length === 0
    ? `<tr><td colspan="3" class="storage-data-empty">No cookies stored for this origin</td></tr>`
    : names.map(name => `
        <tr>
          <td><input type="checkbox" class="storage-row-check" data-name="${escapeHtml(name)}"></td>
          <td class="storage-data-name">${escapeHtml(name)}</td>
          <td class="storage-data-value">••••••••••</td>
        </tr>
      `).join('');

  view.innerHTML = `
    <div class="storage-data-header">
      Storage Data — <span class="storage-data-origin">${escapeHtml(origin)}</span>
    </div>
    <div class="storage-data-scroll">
      <table class="storage-data-table">
        <thead>
          <tr>
            <th><input type="checkbox" id="storage-select-all" ${names.length === 0 ? 'disabled' : ''}></th>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody id="storage-data-tbody">
          ${rowsHtml}
        </tbody>
      </table>
    </div>
    <div class="storage-data-actions">
      <button id="storage-delete-selected" disabled>Delete Selected</button>
      <button id="storage-clear-all" ${names.length === 0 ? 'disabled' : ''}>Clear All</button>
      <button id="storage-close">Close</button>
    </div>
  `;

  // Append over the browser-frame area
  document.getElementById('browser-frame')?.appendChild(view);

  // ── Wire interactions ─────────────────────────────────────

  const selectAll = view.querySelector('#storage-select-all') as HTMLInputElement;
  const deleteSelected = view.querySelector('#storage-delete-selected') as HTMLButtonElement;
  const clearAll = view.querySelector('#storage-clear-all') as HTMLButtonElement;
  const closeBtn = view.querySelector('#storage-close') as HTMLButtonElement;

  function updateDeleteButton() {
    const checked = view.querySelectorAll('.storage-row-check:checked');
    deleteSelected.disabled = checked.length === 0;
  }

  selectAll.addEventListener('change', () => {
    view.querySelectorAll<HTMLInputElement>('.storage-row-check').forEach((cb) => {
      cb.checked = selectAll.checked;
    });
    updateDeleteButton();
  });

  view.querySelector('#storage-data-tbody')!.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).classList.contains('storage-row-check')) {
      updateDeleteButton();
      const allChecks = view.querySelectorAll<HTMLInputElement>('.storage-row-check');
      const allChecked = Array.from(allChecks).every((cb) => cb.checked);
      selectAll.checked = allChecked;
    }
  });

  deleteSelected.addEventListener('click', () => {
    const checked = view.querySelectorAll<HTMLInputElement>('.storage-row-check:checked');
    const namesToDelete = Array.from(checked).map((cb) => cb.dataset.name!).filter(Boolean);
    if (namesToDelete.length > 0) {
      postMessage({ type: 'storage:deleteEntries', payload: { origin, names: namesToDelete } });
    }
  });

  clearAll.addEventListener('click', () => {
    postMessage({ type: 'storage:clear', payload: { origin } });
    view.remove();
  });

  closeBtn.addEventListener('click', () => {
    view.remove();
  });
}
