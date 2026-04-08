import { describe, expect, it, vi } from 'vitest';
import type { ContextBundle, WebviewMessage } from '../types';
import { handleStandaloneContextDelivery } from './contextDelivery';

describe('handleStandaloneContextDelivery', () => {
  it('copies annotation bundles to the clipboard and broadcasts a success toast', () => {
    const annotationBundle: ContextBundle = {
      url: 'http://localhost:3000/page',
      timestamp: 123,
      screenshot: { dataUrl: 'data:image/png;base64,abc', width: 10, height: 20 },
      annotation: 'Explain the highlighted issue.',
    };
    const contextExtractor = {
      fromCapturedElement: vi.fn(),
      fromAnnotation: vi.fn().mockReturnValue(annotationBundle),
      fromLogs: vi.fn(),
      fromScreenshot: vi.fn(),
    };
    const broadcast = vi.fn();
    const message: WebviewMessage = {
      type: 'annotate:sendToChat',
      payload: {
        imageDataUrl: 'data:image/png;base64,abc',
        prompt: 'Explain the highlighted issue.',
      },
    };

    const handled = handleStandaloneContextDelivery(message, {
      contextExtractor: contextExtractor as any,
      currentUrl: 'http://localhost:3000/page',
      broadcast,
    });

    expect(handled).toBe(true);
    expect(contextExtractor.fromAnnotation).toHaveBeenCalledWith(
      'data:image/png;base64,abc',
      'Explain the highlighted issue.',
      'http://localhost:3000/page'
    );
    expect(broadcast).toHaveBeenNthCalledWith(1, {
      type: 'copyToClipboard',
      text: JSON.stringify(annotationBundle, null, 2),
    });
    expect(broadcast).toHaveBeenNthCalledWith(2, {
      type: 'toast',
      payload: { message: 'Context copied to clipboard', toastType: 'success' },
    });
  });
});
