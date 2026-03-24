import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInspectOverlay } from './inspect-overlay';

type MessageHandler = (event: MessageEvent) => void;

describe('createInspectOverlay', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }
  });

  it('uses element screenshot from add-element payload without requesting full-page capture', async () => {
    let messageHandler: MessageHandler | undefined;
    const iframePostMessage = vi.fn();
    const forwarded = vi.fn();

    globalThis.window = {
      addEventListener: vi.fn((type: string, handler: MessageHandler) => {
        if (type === 'message') messageHandler = handler;
      }),
    } as unknown as Window & typeof globalThis;

    createInspectOverlay(
      { contentWindow: { postMessage: iframePostMessage } } as unknown as HTMLIFrameElement,
      forwarded,
    );

    messageHandler?.({
      data: {
        type: 'bc:addElementCaptured',
        payload: {
          html: '<button>Save</button>',
          tag: 'button',
          classes: ['primary'],
          dimensions: { top: 10, left: 20, width: 80, height: 30 },
          accessibility: { role: 'button' },
          parentHtml: '<div><button>Save</button></div>',
          ancestorPath: 'body > div > button',
          screenshotDataUrl: 'data:image/png;base64,element-shot',
        },
      },
    } as MessageEvent);

    await Promise.resolve();

    expect(iframePostMessage).not.toHaveBeenCalledWith({ type: 'bc:captureScreenshot' }, '*');
    expect(forwarded).toHaveBeenCalledWith(expect.objectContaining({
      type: 'addElement:captured',
      payload: expect.objectContaining({
        screenshotDataUrl: 'data:image/png;base64,element-shot',
      }),
    }));
  });
});
