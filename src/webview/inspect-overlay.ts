import type { WebviewMessage, AccessibilityInfo, SourceLocation } from '../types';

type PostMessage = (msg: WebviewMessage) => void;
type Mode = 'inspect' | 'addElement' | 'off';

interface OverlayState {
  mode: Mode;
  selectedElement: HTMLElement | null;
}

export function createInspectOverlay(
  iframe: HTMLIFrameElement,
  postMessage: PostMessage
) {
  const state: OverlayState = { mode: 'off', selectedElement: null };

  let highlight: HTMLElement | null = null;
  let tooltip: HTMLElement | null = null;
  let iframeDoc: Document | null = null;

  function setMode(mode: Mode) {
    state.mode = mode;
    state.selectedElement = null;
    cleanup();

    if (mode !== 'off') {
      tryAttach();
    }
  }

  function tryAttach() {
    try {
      iframeDoc = iframe.contentDocument;
      if (!iframeDoc) return;

      iframeDoc.addEventListener('mousemove', onMouseMove, true);
      iframeDoc.addEventListener('click', onClick, true);
      iframeDoc.addEventListener('keydown', onKeyDown, true);

      // Create highlight overlay
      highlight = iframeDoc.createElement('div');
      highlight.id = '__bc-highlight';
      highlight.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 2147483647;
        border: 2px solid #007acc;
        background: rgba(0, 122, 204, 0.18);
        border-radius: 4px;
        display: none;
        transition: all 0.05s ease;
      `;
      iframeDoc.body.appendChild(highlight);
    } catch {
      // Cross-origin — can't attach
    }
  }

  function cleanup() {
    if (iframeDoc) {
      iframeDoc.removeEventListener('mousemove', onMouseMove, true);
      iframeDoc.removeEventListener('click', onClick, true);
      iframeDoc.removeEventListener('keydown', onKeyDown, true);
    }

    highlight?.remove();
    highlight = null;
    tooltip?.remove();
    tooltip = null;
    iframeDoc = null;
  }

  function onMouseMove(e: MouseEvent) {
    if (state.mode === 'off' || !highlight) return;

    const target = e.target as HTMLElement;
    if (target === highlight || target === tooltip || target.closest('#__bc-tooltip')) return;

    const rect = target.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.top = `${rect.top}px`;
    highlight.style.left = `${rect.left}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;

    // Dashed border for add-element mode
    highlight.style.borderStyle = state.mode === 'addElement' ? 'dashed' : 'solid';
  }

  function onClick(e: MouseEvent) {
    if (state.mode === 'off') return;

    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target === highlight || target === tooltip || target.closest('#__bc-tooltip')) return;

    state.selectedElement = target;

    if (state.mode === 'inspect') {
      handleInspectClick(target);
    } else if (state.mode === 'addElement') {
      handleAddElementClick(target);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setMode('off');
    }
  }

  function handleInspectClick(el: HTMLElement) {
    const info = extractElementInfo(el);

    postMessage({
      type: 'inspect:selected',
      payload: {
        html: info.html,
        tag: info.tag,
        classes: info.classes,
        dimensions: info.dimensions,
        accessibility: info.accessibility,
      },
    });

    showTooltip(el, info);
  }

  function handleAddElementClick(el: HTMLElement) {
    const info = extractElementInfo(el);

    // Capture screenshot before sending
    captureScreenshot().then((screenshotDataUrl) => {
      postMessage({
        type: 'addElement:captured',
        payload: {
          html: truncate(info.html, 50000),
          tag: info.tag,
          classes: info.classes,
          dimensions: info.dimensions,
          accessibility: info.accessibility,
          parentHtml: truncate(info.parentHtml, 50000),
          ancestorPath: info.ancestorPath,
          sourceLocation: info.sourceLocation,
          screenshotDataUrl,
        },
      });

      // Exit mode after capture
      setMode('off');
    });
  }

  function showTooltip(el: HTMLElement, info: ReturnType<typeof extractElementInfo>) {
    tooltip?.remove();

    if (!iframeDoc) return;

    tooltip = iframeDoc.createElement('div');
    tooltip.id = '__bc-tooltip';
    tooltip.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      background: #1e1e1e;
      border: 1px solid #444;
      border-radius: 4px;
      padding: 8px 10px;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      min-width: 200px;
      color: #ccc;
    `;

    const rect = el.getBoundingClientRect();
    tooltip.style.top = `${rect.bottom + 8}px`;
    tooltip.style.left = `${rect.left}px`;

    const tagDisplay = info.tag + (info.classes.length ? '.' + info.classes.join('.') : '');

    tooltip.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">
        <span style="color:#007acc;font-family:monospace;font-weight:600;font-size:12px;">${tagDisplay}</span>
        <span style="color:#888;font-family:monospace;font-size:11px;">${info.dimensions.width} &times; ${info.dimensions.height}</span>
      </div>
      <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #333;padding-top:6px;margin-top:4px;margin-bottom:4px;">Accessibility</div>
      ${info.accessibility.name ? `<div style="display:flex;gap:12px;font-size:11px;line-height:1.6;"><span style="color:#888;min-width:50px;">Name</span><span style="color:#ccc;">${escapeHtml(info.accessibility.name)}</span></div>` : ''}
      ${info.accessibility.role ? `<div style="display:flex;gap:12px;font-size:11px;line-height:1.6;"><span style="color:#888;min-width:50px;">Role</span><span style="color:#ccc;">${info.accessibility.role}</span></div>` : ''}
      <button id="__bc-send-btn" style="display:flex;align-items:center;gap:4px;margin-top:8px;padding:4px 10px;background:#007acc;color:#fff;border:none;border-radius:3px;font-size:11px;cursor:pointer;width:100%;justify-content:center;font-family:system-ui,sans-serif;">
        Add to chat
      </button>
    `;

    iframeDoc.body.appendChild(tooltip);

    // Send button handler
    tooltip.querySelector('#__bc-send-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();

      captureScreenshot().then((screenshotDataUrl) => {
        postMessage({
          type: 'inspect:sendToChat',
          payload: {
            html: truncate(info.html, 50000),
            tag: info.tag,
            classes: info.classes,
            dimensions: info.dimensions,
            accessibility: info.accessibility,
            parentHtml: truncate(info.parentHtml, 50000),
            ancestorPath: info.ancestorPath,
            sourceLocation: info.sourceLocation,
            screenshotDataUrl,
          },
        });
      });
    });
  }

  function extractElementInfo(el: HTMLElement) {
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList);
    const rect = el.getBoundingClientRect();
    const html = el.outerHTML;

    // Parent HTML with siblings collapsed into a single comment
    let parentHtml = '';
    if (el.parentElement) {
      const parent = el.parentElement.cloneNode(true) as HTMLElement;
      const children = Array.from(parent.children);
      const siblingCount = children.length - 1;
      // Remove all sibling children, insert one summary comment
      let foundTarget = false;
      const toRemove: Element[] = [];
      children.forEach((child) => {
        if (child.outerHTML === el.outerHTML && !foundTarget) {
          foundTarget = true; // keep the first match (the target element)
        } else {
          toRemove.push(child);
        }
      });
      toRemove.forEach((child) => child.remove());
      if (siblingCount > 0) {
        parent.insertBefore(
          parent.ownerDocument.createComment(` ${siblingCount} sibling(s) omitted `),
          parent.firstChild
        );
      }
      parentHtml = parent.outerHTML;
    }

    // Ancestor path
    const ancestors: string[] = [];
    let current: HTMLElement | null = el;
    while (current && current !== iframeDoc?.body) {
      const name = current.tagName.toLowerCase();
      const cls = current.classList.length > 0 ? '.' + Array.from(current.classList).join('.') : '';
      const id = current.id ? `#${current.id}` : '';
      ancestors.unshift(`${name}${id}${cls}`);
      current = current.parentElement;
    }
    ancestors.unshift('body');
    const ancestorPath = ancestors.join(' > ');

    // Accessibility info
    const accessibility: AccessibilityInfo = {
      name: el.getAttribute('aria-label') ||
            el.getAttribute('alt') ||
            el.textContent?.trim().slice(0, 100) ||
            undefined,
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      focusable: el.tabIndex >= 0,
    };

    // Source location (React dev mode)
    const sourceLocation = detectSourceLocation(el);

    return {
      html,
      parentHtml,
      ancestorPath,
      tag,
      classes,
      id: el.id || undefined,
      dimensions: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      accessibility,
      sourceLocation,
    };
  }

  function detectSourceLocation(el: HTMLElement): SourceLocation | undefined {
    // React: look for __reactFiber$ property
    const fiberKey = Object.keys(el).find((key) => key.startsWith('__reactFiber$'));
    if (fiberKey) {
      let fiber = (el as any)[fiberKey];
      while (fiber) {
        if (fiber._debugSource) {
          return {
            filePath: fiber._debugSource.fileName,
            line: fiber._debugSource.lineNumber,
            column: fiber._debugSource.columnNumber,
          };
        }
        fiber = fiber.return;
      }
    }

    // MVP: React only. Vue/Svelte/Angular detection deferred to later iterations.
    return undefined;
  }

  async function captureScreenshot(): Promise<string> {
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(iframeDoc!.body, {
        useCORS: true,
        logging: false,
        width: iframe.clientWidth,
        height: iframe.clientHeight,
        windowWidth: iframe.clientWidth,
        windowHeight: iframe.clientHeight,
      });
      const dataUrl = canvas.toDataURL('image/png');

      // Cap at 2MB
      if (dataUrl.length > 2 * 1024 * 1024) {
        const scale = Math.sqrt((2 * 1024 * 1024) / dataUrl.length);
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

  function truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + '<!-- truncated -->';
  }

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { setMode, cleanup };
}
