// VS Code webview API shim for standalone dev mode.
//
// Provides acquireVsCodeApi() using:
//   - fetch POST /message for webview -> extension host direction
//   - EventSource /events for extension host -> webview direction
//
// Intercepts two special server-only message types before forwarding to webview:
//   - { type: 'copyToClipboard', text: string } - calls navigator.clipboard.writeText()
//   - { type: '__standalone_reload' } - calls location.reload()
//
// All other messages are synthesized as window MessageEvents so the existing
// webview code (src/webview/main.ts) receives them unchanged.

interface Window {
  acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
  };
}

(function () {
  'use strict';

  window.acquireVsCodeApi = function () {
    return {
      postMessage(msg: unknown): void {
        fetch('/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg),
        }).catch(() => {
          // Fire-and-forget: swallow network errors silently.
        });
      },
      getState(): unknown {
        try {
          return JSON.parse(sessionStorage.getItem('__vscode_state') || 'null');
        } catch {
          return null;
        }
      },
      setState(state: unknown): void {
        try {
          sessionStorage.setItem('__vscode_state', JSON.stringify(state));
        } catch {
          // Ignore storage errors.
        }
      },
    };
  };

  const es = new EventSource('/events');

  es.onmessage = function (event: MessageEvent): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return;
    }

    const msg = parsed as { type?: unknown; [key: string]: unknown };

    if (msg.type === 'copyToClipboard' && typeof msg.text === 'string') {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (clipboard && typeof clipboard.writeText === 'function') {
        clipboard.writeText(msg.text).catch(() => {
          // Clipboard may be unavailable in some browser contexts.
        });
      }
      return;
    }

    if (msg.type === '__standalone_reload') {
      location.reload();
      return;
    }

    window.dispatchEvent(new MessageEvent('message', { data: msg }));
  };

  es.onerror = function (): void {
    // EventSource auto-reconnects on error.
  };
})();
