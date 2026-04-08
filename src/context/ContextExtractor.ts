import type {
  ContextBundle,
  CapturedElementPayload,
  ConsoleEntry,
} from '../types';

/**
 * Decode width and height from a PNG or JPEG data URL.
 * Returns {width:0, height:0} for unknown formats or on any error.
 */
export function getImageDimensions(dataUrl: string): { width: number; height: number } {
  try {
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
    if (!match) return { width: 0, height: 0 };

    const format = match[1];
    const buf = Buffer.from(match[2], 'base64');

    if (format === 'png') {
      if (buf.length < 24) return { width: 0, height: 0 };
      // PNG IHDR: width at bytes 16-19, height at bytes 20-23 (big-endian uint32)
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
      };
    }

    if (format === 'jpeg' || format === 'jpg') {
      // Scan JPEG markers starting after SOI (0xFF 0xD8)
      let i = 2;
      while (i + 1 < buf.length) {
        if (buf[i] !== 0xff) break;
        const markerType = buf[i + 1];
        // SOF0 (0xC0, baseline DCT) or SOF2 (0xC2, progressive DCT)
        if (markerType === 0xc0 || markerType === 0xc2) {
          if (i + 8 >= buf.length) break;
          // Segment layout after marker (2 bytes): length (2), precision (1), height (2), width (2)
          return {
            height: buf.readUInt16BE(i + 5),
            width: buf.readUInt16BE(i + 7),
          };
        }
        if (markerType === 0xd9) break; // EOI — end of image
        // Skip segment: marker (2 bytes) + segment length (includes its own 2 bytes)
        if (i + 3 >= buf.length) break;
        const segLen = buf.readUInt16BE(i + 2);
        i += 2 + segLen;
      }
    }
  } catch {
    // fall through
  }
  return { width: 0, height: 0 };
}

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
      const dimensions = getImageDimensions(payload.screenshotDataUrl);
      bundle.screenshot = {
        dataUrl: payload.screenshotDataUrl,
        ...dimensions,
      };
    }

    return bundle;
  }

  fromScreenshot(
    dataUrl: string,
    url: string
  ): ContextBundle {
    return {
      url,
      timestamp: Date.now(),
      screenshot: { dataUrl, ...getImageDimensions(dataUrl) },
    };
  }

  fromLogs(logs: ConsoleEntry[], url: string): ContextBundle {
    return {
      url,
      timestamp: Date.now(),
      logs,
    };
  }

}
