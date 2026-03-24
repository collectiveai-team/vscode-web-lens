/**
 * Inspect overlay — message relay between iframe (inject script) and extension host.
 *
 * The actual DOM inspection and highlighting now happens inside the inject
 * script running in the target page. This module:
 * - Sends mode changes to the iframe via postMessage
 * - Listens for messages from the iframe and translates them to WebviewMessages
 * - Handles screenshot request/response flow
 */

import type { WebviewMessage } from '../types';

type PostMessage = (msg: WebviewMessage) => void;
type Mode = 'inspect' | 'addElement' | 'off';

interface PendingScreenshot {
  resolve: (dataUrl: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createInspectOverlay(
  iframe: HTMLIFrameElement,
  postMessage: PostMessage,
) {
  let currentMode: Mode = 'off';
  let pendingScreenshot: PendingScreenshot | null = null;

  // ── Listen for messages from the inject script ──────────

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data.type !== 'string') return;

    // Only handle messages with the bc: prefix (from our inject script)
    if (!data.type.startsWith('bc:')) return;

    switch (data.type) {
      case 'bc:elementSelected':
        postMessage({
          type: 'inspect:selected',
          payload: {
            html: data.payload.html,
            tag: data.payload.tag,
            classes: data.payload.classes,
            dimensions: data.payload.dimensions,
            accessibility: data.payload.accessibility,
          },
        });
        break;

      case 'bc:sendToChat':
        resolveElementScreenshot(data.payload.screenshotDataUrl).then((screenshotDataUrl) => {
          postMessage({
            type: 'inspect:sendToChat',
            payload: {
              html: data.payload.html,
              tag: data.payload.tag,
              classes: data.payload.classes,
              dimensions: data.payload.dimensions,
              accessibility: data.payload.accessibility,
              parentHtml: data.payload.parentHtml,
              ancestorPath: data.payload.ancestorPath,
              sourceLocation: data.payload.sourceLocation,
              screenshotDataUrl,
              attributes: data.payload.attributes,
              innerText: data.payload.innerText,
              computedStyles: data.payload.computedStyles,
            },
          });
        });
        break;

      case 'bc:addElementCaptured':
        resolveElementScreenshot(data.payload.screenshotDataUrl).then((screenshotDataUrl) => {
          postMessage({
            type: 'addElement:captured',
            payload: {
              html: data.payload.html,
              tag: data.payload.tag,
              classes: data.payload.classes,
              dimensions: data.payload.dimensions,
              accessibility: data.payload.accessibility,
              parentHtml: data.payload.parentHtml,
              ancestorPath: data.payload.ancestorPath,
              sourceLocation: data.payload.sourceLocation,
              screenshotDataUrl,
              attributes: data.payload.attributes,
              innerText: data.payload.innerText,
              computedStyles: data.payload.computedStyles,
            },
          });
        });
        break;

      case 'bc:screenshot':
        // Response from screenshot request
        if (pendingScreenshot) {
          clearTimeout(pendingScreenshot.timer);
          pendingScreenshot.resolve(data.dataUrl || '');
          pendingScreenshot = null;
        }
        break;

      case 'bc:modeExited':
        // The inject script exited mode (e.g. ESC pressed inside iframe)
        currentMode = 'off';
        break;

      case 'bc:diagnostic':
        postMessage({
          type: 'diagnostic:log',
          payload: {
            source: data.payload?.source || 'page',
            level: data.payload?.level || 'info',
            message: data.payload?.message || 'Diagnostic event',
            details: data.payload?.details,
          },
        });
        break;
    }
  });

  // ── Public API ──────────────────────────────────────────

  function setMode(mode: Mode) {
    currentMode = mode;

    // Tell the inject script about the mode change
    try {
      iframe.contentWindow?.postMessage({ type: 'bc:setMode', mode }, '*');
    } catch {
      // iframe not ready — will be set on next load
    }
  }

  function cleanup() {
    setMode('off');
    if (pendingScreenshot) {
      clearTimeout(pendingScreenshot.timer);
      pendingScreenshot.resolve('');
      pendingScreenshot = null;
    }
  }

  /**
   * Request a screenshot from the inject script.
   * The inject script uses html2canvas to capture the page and posts back
   * a bc:screenshot message with the dataUrl.
   */
  function requestScreenshot(): Promise<string> {
    return new Promise<string>((resolve) => {
      // Clean up any previous pending request
      if (pendingScreenshot) {
        clearTimeout(pendingScreenshot.timer);
        pendingScreenshot.resolve('');
      }

      const timer = setTimeout(() => {
        // Timeout after 10 seconds
        pendingScreenshot = null;
        resolve('');
      }, 10000);

      pendingScreenshot = { resolve, timer };

      try {
        iframe.contentWindow?.postMessage({ type: 'bc:captureScreenshot' }, '*');
      } catch {
        clearTimeout(timer);
        pendingScreenshot = null;
        resolve('');
      }
    });
  }

  function resolveElementScreenshot(embeddedScreenshotDataUrl?: string): Promise<string> {
    if (embeddedScreenshotDataUrl) {
      postMessage({
        type: 'diagnostic:log',
        payload: {
          source: 'webview.overlay',
          level: 'info',
          message: 'Using embedded element screenshot',
        },
      });
      return Promise.resolve(embeddedScreenshotDataUrl);
    }

    postMessage({
      type: 'diagnostic:log',
      payload: {
        source: 'webview.overlay',
        level: 'warn',
        message: 'Falling back to generic screenshot capture',
      },
    });
    return requestScreenshot();
  }

  return { setMode, cleanup, requestScreenshot };
}
