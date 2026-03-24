const MAX_SCREENSHOT_SIZE = 2 * 1024 * 1024; // 2MB
const CAPTURE_IGNORE_IDS = new Set(['__bc-highlight', '__bc-tooltip']);

interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function captureScreenshot(
  targetBody: HTMLElement,
  viewportWidth: number,
  viewportHeight: number,
  scrollX: number = 0,
  scrollY: number = 0,
): Promise<string> {
  try {
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(
      targetBody,
      buildViewportCaptureOptions(viewportWidth, viewportHeight, scrollX, scrollY),
    );
    const dataUrl = canvasToDataUrl(canvas);

    return dataUrl;
  } catch {
    return '';
  }
}

export async function captureElementScreenshot(
  targetBody: HTMLElement,
  element: HTMLElement,
  viewportWidth: number,
  viewportHeight: number,
  scrollX: number = 0,
  scrollY: number = 0,
): Promise<string> {
  try {
    const rect = element.getBoundingClientRect();
    const crop = computeCropRegion(rect, viewportWidth, viewportHeight);
    if (!crop) {
      return '';
    }

    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(
      targetBody,
      buildElementCaptureOptions(rect, viewportWidth, viewportHeight, scrollX, scrollY),
    );

    return canvasToDataUrl(canvas);
  } catch {
    return '';
  }
}

export function buildViewportCaptureOptions(
  viewportWidth: number,
  viewportHeight: number,
  scrollX: number,
  scrollY: number,
  backgroundColor: string | null = '#ffffff',
) {
  return {
    useCORS: true,
    logging: false,
    backgroundColor,
    width: viewportWidth,
    height: viewportHeight,
    windowWidth: viewportWidth,
    windowHeight: viewportHeight,
    x: scrollX,
    y: scrollY,
    scrollX,
    scrollY,
    ignoreElements: shouldIgnoreCaptureElement,
  };
}

export function buildElementCaptureOptions(
  rect: RectLike,
  viewportWidth: number,
  viewportHeight: number,
  scrollX: number,
  scrollY: number,
) {
  return {
    ...buildViewportCaptureOptions(viewportWidth, viewportHeight, scrollX, scrollY, null),
    x: Math.floor(rect.left + scrollX),
    y: Math.floor(rect.top + scrollY),
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
  };
}

export function shouldIgnoreCaptureElement(element: Element): boolean {
  return CAPTURE_IGNORE_IDS.has(element.id);
}

export function computeCropRegion(
  rect: RectLike,
  viewportWidth: number,
  viewportHeight: number
): CropRegion | null {
  const left = Math.max(0, Math.floor(rect.left));
  const top = Math.max(0, Math.floor(rect.top));
  const right = Math.min(viewportWidth, Math.ceil(rect.left + rect.width));
  const bottom = Math.min(viewportHeight, Math.ceil(rect.top + rect.height));

  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x: left, y: top, width, height };
}

function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  let dataUrl = canvas.toDataURL('image/png');

  // Cap at 2MB — downscale if larger
  if (dataUrl.length > MAX_SCREENSHOT_SIZE) {
    const scale = Math.sqrt(MAX_SCREENSHOT_SIZE / dataUrl.length);
    const scaledCanvas = document.createElement('canvas');
    scaledCanvas.width = canvas.width * scale;
    scaledCanvas.height = canvas.height * scale;
    const ctx = scaledCanvas.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
    dataUrl = scaledCanvas.toDataURL('image/png');
  }

  return dataUrl;
}
