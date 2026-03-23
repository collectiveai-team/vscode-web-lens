/**
 * Inject script — runs INSIDE the target page iframe.
 *
 * Injected by the ProxyServer. Has full DOM access to the target page.
 * Communicates with the parent webview via window.parent.postMessage().
 */

import html2canvas from 'html2canvas';

// Only initialize in the top-level proxied frame (direct child of the webview).
// Nested iframes within the target app should NOT get instrumentation.
if (window.__webLensInjected) {
  // Already initialized in this frame - skip
} else if (window.parent !== window && window.parent !== window.top) {
  // This frame's parent is NOT the top frame (webview) - it's a nested iframe
  // Skip initialization in nested iframes
} else {
  (window as any).__webLensInjected = true;
  initWebLens();
}

declare global {
  interface Window {
    __webLensInjected?: boolean;
  }
}

// ── Types ──────────────────────────────────────────────────

type Mode = 'inspect' | 'addElement' | 'off';

interface AccessibilityInfo {
  name?: string;
  role?: string;
  focusable?: boolean;
}

interface SourceLocation {
  filePath: string;
  line: number;
  column?: number;
}

interface ElementInfo {
  html: string;
  parentHtml: string;
  ancestorPath: string;
  tag: string;
  classes: string[];
  dimensions: { top: number; left: number; width: number; height: number };
  accessibility: AccessibilityInfo;
  sourceLocation?: SourceLocation;
  attributes?: Record<string, string>;
  innerText?: string;
  computedStyles?: Record<string, string>;
}

const MAX_SCREENSHOT_SIZE = 2 * 1024 * 1024; // 2MB

function initWebLens() {

// ── State ──────────────────────────────────────────────────

let currentMode: Mode = 'off';
let highlightEl: HTMLElement | null = null;
let tooltipEl: HTMLElement | null = null;
let selectedElement: HTMLElement | null = null;

window.addEventListener('error', (event: ErrorEvent) => {
  postToParent({
    type: 'bc:diagnostic',
    payload: {
      source: 'page',
      level: 'error',
      message: event.message || 'Unhandled page error',
      details: formatDiagnosticDetails(event.error || event.filename || window.location.href),
    },
  });
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  postToParent({
    type: 'bc:diagnostic',
    payload: {
      source: 'page',
      level: 'error',
      message: 'Unhandled promise rejection',
      details: formatDiagnosticDetails(event.reason),
    },
  });
});

// Console capture
// Monkey-patch console.log/warn/error to forward entries to the webview.
// No local buffer needed - the receiver in console-capture.ts buffers entries.
(function captureConsole() {
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  function formatArgs(args: any[]): string {
    return args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
  }

  function forward(level: 'log' | 'warn' | 'error', args: any[]) {
    postToParent({
      type: 'bc:console',
      payload: { level, message: formatArgs(args), timestamp: Date.now() },
    });
  }

  console.log = (...args: any[]) => {
    forward('log', args);
    originalLog(...args);
  };
  console.warn = (...args: any[]) => {
    forward('warn', args);
    originalWarn(...args);
  };
  console.error = (...args: any[]) => {
    forward('error', args);
    originalError(...args);
  };
})();

postToParent({
  type: 'bc:diagnostic',
  payload: {
    source: 'page',
    level: 'info',
    message: 'Inject script attached',
    details: window.location.href,
  },
});

// ── Message listener (from parent webview) ──────────────────

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data;
  if (!data || typeof data.type !== 'string') return;

  switch (data.type) {
    case 'bc:setMode':
      setMode(data.mode as Mode);
      break;
    case 'bc:captureScreenshot':
      captureAndSendScreenshot();
      break;
  }
});

// ── Mode management ────────────────────────────────────────

function setMode(mode: Mode) {
  currentMode = mode;
  selectedElement = null;

  cleanup();

  if (mode !== 'off') {
    attach();
  }
}

function attach() {
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  // Create highlight overlay
  highlightEl = document.createElement('div');
  highlightEl.id = '__bc-highlight';
  highlightEl.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483647;
    border: 2px solid #007acc;
    background: rgba(0, 122, 204, 0.18);
    border-radius: 4px;
    display: none;
    transition: all 0.05s ease;
  `;
  document.body.appendChild(highlightEl);
}

function cleanup() {
  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKeyDown, true);

  highlightEl?.remove();
  highlightEl = null;
  tooltipEl?.remove();
  tooltipEl = null;
}

// ── Event handlers ─────────────────────────────────────────

function onMouseMove(e: MouseEvent) {
  if (currentMode === 'off' || !highlightEl) return;

  const target = e.target as HTMLElement;
  if (
    target === highlightEl ||
    target === tooltipEl ||
    target.closest('#__bc-tooltip')
  ) {
    return;
  }

  const rect = target.getBoundingClientRect();
  highlightEl.style.display = 'block';
  highlightEl.style.top = `${rect.top}px`;
  highlightEl.style.left = `${rect.left}px`;
  highlightEl.style.width = `${rect.width}px`;
  highlightEl.style.height = `${rect.height}px`;

  // Dashed border for add-element mode
  highlightEl.style.borderStyle = currentMode === 'addElement' ? 'dashed' : 'solid';
}

function onClick(e: MouseEvent) {
  if (currentMode === 'off') return;

  e.preventDefault();
  e.stopPropagation();

  const target = e.target as HTMLElement;
  if (
    target === highlightEl ||
    target === tooltipEl ||
    target.closest('#__bc-tooltip')
  ) {
    return;
  }

  selectedElement = target;

  if (currentMode === 'inspect') {
    handleInspectClick(target);
  } else if (currentMode === 'addElement') {
    handleAddElementClick(target);
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    setMode('off');
    postToParent({ type: 'bc:modeExited' });
  }
}

// ── Inspect mode handler ───────────────────────────────────

function handleInspectClick(el: HTMLElement) {
  const info = extractElementInfo(el);

  postToParent({
    type: 'bc:elementSelected',
    payload: {
      html: info.html,
      tag: info.tag,
      classes: info.classes,
      dimensions: info.dimensions,
      accessibility: info.accessibility,
      parentHtml: info.parentHtml,
      ancestorPath: info.ancestorPath,
      sourceLocation: info.sourceLocation,
      attributes: info.attributes,
      innerText: info.innerText,
      computedStyles: info.computedStyles,
    },
  });

  showTooltip(el, info);
}

// ── Add-element mode handler ───────────────────────────────

function handleAddElementClick(el: HTMLElement) {
  const info = extractElementInfo(el);

  postToParent({
    type: 'bc:addElementCaptured',
    payload: {
      html: truncate(info.html, 50000),
      tag: info.tag,
      classes: info.classes,
      dimensions: info.dimensions,
      accessibility: info.accessibility,
      parentHtml: truncate(info.parentHtml, 50000),
      ancestorPath: info.ancestorPath,
      sourceLocation: info.sourceLocation,
      attributes: info.attributes,
      innerText: info.innerText,
      computedStyles: info.computedStyles,
    },
  });

  // Exit mode after capture
  setMode('off');
}

// ── Tooltip ────────────────────────────────────────────────

function showTooltip(el: HTMLElement, info: ElementInfo) {
  tooltipEl?.remove();

  tooltipEl = document.createElement('div');
  tooltipEl.id = '__bc-tooltip';
  tooltipEl.style.cssText = `
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
  tooltipEl.style.top = `${rect.bottom + 8}px`;
  tooltipEl.style.left = `${rect.left}px`;

  const tagDisplay = info.tag + (info.classes.length ? '.' + info.classes.join('.') : '');

  tooltipEl.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">
      <span style="color:#007acc;font-family:monospace;font-weight:600;font-size:12px;">${escapeHtml(tagDisplay)}</span>
      <span style="color:#888;font-family:monospace;font-size:11px;">${info.dimensions.width} &times; ${info.dimensions.height}</span>
    </div>
    <div style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #333;padding-top:6px;margin-top:4px;margin-bottom:4px;">Accessibility</div>
    ${info.accessibility.name ? `<div style="display:flex;gap:12px;font-size:11px;line-height:1.6;"><span style="color:#888;min-width:50px;">Name</span><span style="color:#ccc;">${escapeHtml(info.accessibility.name)}</span></div>` : ''}
    ${info.accessibility.role ? `<div style="display:flex;gap:12px;font-size:11px;line-height:1.6;"><span style="color:#888;min-width:50px;">Role</span><span style="color:#ccc;">${escapeHtml(info.accessibility.role)}</span></div>` : ''}
    <button id="__bc-send-btn" style="display:flex;align-items:center;gap:4px;margin-top:8px;padding:4px 10px;background:#007acc;color:#fff;border:none;border-radius:3px;font-size:11px;cursor:pointer;width:100%;justify-content:center;font-family:system-ui,sans-serif;">
      Add to chat
    </button>
  `;

  document.body.appendChild(tooltipEl);

  // "Add to chat" button handler
  const sendBtn = tooltipEl.querySelector('#__bc-send-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      postToParent({
        type: 'bc:sendToChat',
        payload: {
          html: truncate(info.html, 50000),
          tag: info.tag,
          classes: info.classes,
          dimensions: info.dimensions,
          accessibility: info.accessibility,
          parentHtml: truncate(info.parentHtml, 50000),
          ancestorPath: info.ancestorPath,
          sourceLocation: info.sourceLocation,
          attributes: info.attributes,
          innerText: info.innerText,
          computedStyles: info.computedStyles,
        },
      });
    });
  }
}

// ── Element info extraction ────────────────────────────────

function extractElementInfo(el: HTMLElement): ElementInfo {
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList);
  const rect = el.getBoundingClientRect();
  const html = el.outerHTML;

  // Parent HTML with siblings collapsed
  let parentHtml = '';
  if (el.parentElement) {
    const parent = el.parentElement.cloneNode(true) as HTMLElement;
    const children = Array.from(parent.children);
    const siblingCount = children.length - 1;

    // Find and keep only the target element
    let foundTarget = false;
    const toRemove: Element[] = [];
    children.forEach((child) => {
      if (child.outerHTML === el.outerHTML && !foundTarget) {
        foundTarget = true;
      } else {
        toRemove.push(child);
      }
    });
    toRemove.forEach((child) => child.remove());

    // Clean up orphan text nodes and comments left behind
    const nodesToRemove: Node[] = [];
    parent.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && (!node.textContent || !node.textContent.trim())) {
        nodesToRemove.push(node);
      } else if (node.nodeType === Node.COMMENT_NODE) {
        nodesToRemove.push(node);
      }
    });
    nodesToRemove.forEach((node) => parent.removeChild(node));

    // Add our summary comment at the top
    if (siblingCount > 0) {
      parent.insertBefore(
        parent.ownerDocument.createComment(` ${siblingCount} sibling(s) omitted `),
        parent.firstChild,
      );
    }
    parentHtml = parent.outerHTML;
  }

  // Ancestor path
  const ancestors: string[] = [];
  let current: HTMLElement | null = el;
  while (current && current !== document.body) {
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
    name:
      el.getAttribute('aria-label') ||
      el.getAttribute('alt') ||
      el.textContent?.trim().slice(0, 100) ||
      undefined,
    role: el.getAttribute('role') || el.tagName.toLowerCase(),
    focusable: el.tabIndex >= 0,
  };

  // Source location (React dev mode)
  const sourceLocation = detectSourceLocation(el);

  // Collect all attributes
  const attributes: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    attributes[attr.name] = attr.value;
  }

  // Collect all computed styles
  const computedStyle = window.getComputedStyle(el);
  const computedStyles: Record<string, string> = {};
  for (let i = 0; i < computedStyle.length; i++) {
    const prop = computedStyle[i];
    computedStyles[prop] = computedStyle.getPropertyValue(prop);
  }

  // Inner text
  const innerText = el.innerText;

  return {
    html,
    parentHtml,
    ancestorPath,
    tag,
    classes,
    dimensions: {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    accessibility,
    sourceLocation,
    attributes,
    innerText,
    computedStyles,
  };
}

function detectSourceLocation(el: HTMLElement): SourceLocation | undefined {
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
  return undefined;
}

// ── Screenshot capture ─────────────────────────────────────

async function captureAndSendScreenshot() {
  try {
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      logging: false,
      width: window.innerWidth,
      height: window.innerHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    });

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

    postToParent({ type: 'bc:screenshot', dataUrl });
  } catch {
    postToParent({ type: 'bc:screenshot', dataUrl: '' });
  }
}

}

// ── Helpers ────────────────────────────────────────────────

function postToParent(msg: Record<string, unknown>) {
  window.parent.postMessage(msg, '*');
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '<!-- truncated -->';
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDiagnosticDetails(value: unknown): string {
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
