const MAX_SCREENSHOT_SIZE = 2 * 1024 * 1024; // 2MB

export async function captureScreenshot(
  targetBody: HTMLElement,
  viewportWidth: number,
  viewportHeight: number
): Promise<string> {
  try {
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(targetBody, {
      useCORS: true,
      logging: false,
      width: viewportWidth,
      height: viewportHeight,
      windowWidth: viewportWidth,
      windowHeight: viewportHeight,
    });
    const dataUrl = canvas.toDataURL('image/png');

    // Cap at 2MB — downscale if larger
    if (dataUrl.length > MAX_SCREENSHOT_SIZE) {
      const scale = Math.sqrt(MAX_SCREENSHOT_SIZE / dataUrl.length);
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = canvas.width * scale;
      scaledCanvas.height = canvas.height * scale;
      const ctx = scaledCanvas.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
      return scaledCanvas.toDataURL('image/png');
    }

    return dataUrl;
  } catch {
    return '';
  }
}
