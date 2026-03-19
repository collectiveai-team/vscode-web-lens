import type {
  ContextBundle,
  CapturedElementPayload,
  ConsoleEntry,
} from '../types';

export class ContextExtractor {
  fromCapturedElement(
    payload: CapturedElementPayload,
    url: string
  ): ContextBundle {
    const bundle: ContextBundle = {
      url,
      timestamp: Date.now(),
      element: {
        html: payload.html,
        parentHtml: payload.parentHtml,
        ancestorPath: payload.ancestorPath,
        tag: payload.tag,
        classes: payload.classes,
        dimensions: payload.dimensions,
        accessibility: payload.accessibility,
        sourceLocation: payload.sourceLocation,
        attributes: payload.attributes,
        innerText: payload.innerText,
        computedStyles: payload.computedStyles,
      },
    };

    if (payload.screenshotDataUrl) {
      const dimensions = this.getImageDimensions(payload.screenshotDataUrl);
      bundle.screenshot = {
        dataUrl: payload.screenshotDataUrl,
        ...dimensions,
      };
    }

    return bundle;
  }

  fromScreenshot(
    dataUrl: string,
    width: number,
    height: number,
    url: string
  ): ContextBundle {
    return {
      url,
      timestamp: Date.now(),
      screenshot: { dataUrl, width, height },
    };
  }

  fromLogs(logs: ConsoleEntry[], url: string): ContextBundle {
    return {
      url,
      timestamp: Date.now(),
      logs,
    };
  }

  private getImageDimensions(dataUrl: string): { width: number; height: number } {
    // Approximate from base64 length — actual dimensions would require decoding
    // For now, return 0,0 — the backend adapter can decode if needed
    return { width: 0, height: 0 };
  }
}
