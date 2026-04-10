import type { RecordOptions, WebviewMessage } from '../types';
import type { AnnotationTool } from './annotation-overlay';
import {
  createToolbarDiagnostic,
  getInstructionBannerHtml,
  getRecordActiveBannerHtml,
  getRecordConfigBannerHtml,
} from './toolbarDiagnostics';

declare const __EXTENSION_VERSION__: string;

const extensionVersion = typeof __EXTENSION_VERSION__ === 'string' ? __EXTENSION_VERSION__ : '0.0.0';

type PostMessage = (msg: WebviewMessage) => void;
type ToolbarAnnotationTool = AnnotationTool | 'select';

const ANNOTATION_TOOL_ICONS: Record<ToolbarAnnotationTool, string> = {
  select: 'arrow_selector_tool',
  pen: 'draw',
  arrow: 'trending_flat',
  rect: 'rectangle',
  ellipse: 'circle',
  text: 'text_fields',
  callout: 'chat_bubble',
};

const ANNOTATION_TOOL_SHORTCUTS: Record<ToolbarAnnotationTool, string> = {
  select: 'S',
  pen: 'P',
  arrow: 'A',
  rect: 'R',
  ellipse: 'E',
  text: 'T',
  callout: 'C',
};

interface ToolbarState {
  inspectActive: boolean;
  addElementActive: boolean;
  annotateActive: boolean;
  recordPending: boolean;
  recordActive: boolean;
}

interface ToolbarElements {
  urlBar: HTMLInputElement;
  btnInspect: HTMLButtonElement;
  btnAddElement: HTMLButtonElement;
  btnAnnotate: HTMLButtonElement;
  btnRecord: HTMLButtonElement;
  banner: HTMLElement;
  annotationStrip: HTMLElement;
}

interface ToolbarCallbacks {
  onLogsRequest?: () => void;
  onScreenshotRequest?: () => void;
  onBackendRequest?: () => void;
  onBackendSelect?: (backend: string) => void;
  onAnnotateTool?: (tool: ToolbarAnnotationTool) => void;
  onAnnotateColor?: (color: string) => void;
  onAnnotateUndo?: () => void;
  onAnnotateRedo?: () => void;
  onAnnotateDelete?: () => void;
  onAnnotateClear?: () => void;
  onAnnotateSend?: (prompt: string) => void;
  onAnnotateDismiss?: () => void;
  onAnnotateHasShapes?: () => boolean;
  onRecordStart?: (opts: RecordOptions) => void;
  onRecordStop?: () => void;
}

export interface ToolbarAPI {
  setUrl(url: string): void;
  setInspectActive(active: boolean): void;
  setAddElementActive(active: boolean): void;
  setAnnotateActive(active: boolean): void;
  setAnnotateDeleteEnabled(enabled: boolean): void;
  setBackendState(active: string, available: Record<string, boolean>): void;
  setStorageDataState(enabled: boolean, hasData: boolean): void;
  setRecordActive(active: boolean): void;
  setRecordOptions(opts: RecordOptions): void;
  updateRecordingStatus(eventCount: number, elapsedSeconds: number): void;
  onStateChange(cb: (state: ToolbarState) => void): void;
}

export function createToolbar(
  container: HTMLElement,
  postMessage: PostMessage,
  callbacks?: ToolbarCallbacks
): ToolbarAPI {
  const state: ToolbarState = {
    inspectActive: false,
    addElementActive: false,
    annotateActive: false,
    recordPending: false,
    recordActive: false,
  };

  let activeAnnotationTool: ToolbarAnnotationTool = 'pen';
  let activeAnnotationColor = '#ff3b30';
  let annotateDeleteEnabled = false;
  let confirmPending = false;
  const annotationTools: ToolbarAnnotationTool[] = ['select', 'pen', 'arrow', 'rect', 'ellipse', 'text', 'callout'];
  const annotationToolSet = new Set<string>(annotationTools);
  const isToolbarAnnotationTool = (value: string): value is ToolbarAnnotationTool => annotationToolSet.has(value);
  const annotationColors = ['#ff3b30', '#ff4d4f', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2'];

  let recordOpts: RecordOptions = {
    captureConsole: false,
    captureScroll: false,
    captureHover: false,
  };
  let recordEventCount = 0;
  let recordElapsedSeconds = 0;

  let stateChangeCallback: ((state: ToolbarState) => void) | undefined;

  // ── Build DOM ──────────────────────────────────────────────
  container.innerHTML = `
    <div class="toolbar-group left">
      <button class="toolbar-btn" id="btn-back" title="Back">
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <button class="toolbar-btn" id="btn-forward" title="Forward">
        <span class="material-symbols-outlined">arrow_forward</span>
      </button>
      <button class="toolbar-btn" id="btn-reload" title="Reload">
        <span class="material-symbols-outlined">refresh</span>
      </button>
    </div>
    <div class="toolbar-group center">
      <input class="url-bar" id="url-bar" type="text" placeholder="Enter URL..." spellcheck="false" />
    </div>
    <div class="toolbar-group right">
      <button class="toolbar-btn" id="btn-inspect" title="Inspect Element">
        <span class="material-symbols-outlined">select</span>
      </button>
      <button class="toolbar-btn" id="btn-add-element" title="Add Element to Chat">
        <span class="material-symbols-outlined">add_comment</span>
      </button>
      <button class="toolbar-btn" id="btn-record" title="Record interactions">
        <span class="material-symbols-outlined">radio_button_checked</span>
      </button>
      <button class="toolbar-btn" id="btn-annotate" title="Annotate Screenshot">
        <span class="material-symbols-outlined">draw</span>
      </button>
      <div class="toolbar-divider"></div>
      <button class="toolbar-btn" id="btn-add-logs" title="Add Logs to Chat">
        <span class="material-symbols-outlined">terminal</span>
      </button>
      <button class="toolbar-btn" id="btn-screenshot" title="Screenshot">
        <span class="material-symbols-outlined">screenshot_monitor</span>
      </button>
      <div class="toolbar-divider"></div>
      <div style="position: relative;">
        <button class="toolbar-btn" id="btn-backend" title="Select Backend">
          <img class="backend-btn-icon backend-icon-light" id="backend-icon-light" width="18" height="18" />
          <img class="backend-btn-icon backend-icon-dark" id="backend-icon-dark" width="18" height="18" />
          <span class="material-symbols-outlined backend-btn-icon-clipboard" id="backend-icon-clipboard">content_copy</span>
        </button>
        <div class="backend-menu" id="backend-menu"></div>
      </div>
      <div style="position: relative;">
        <button class="toolbar-btn" id="btn-overflow" title="More actions">
          <span class="material-symbols-outlined">more_vert</span>
        </button>
        <div class="overflow-menu" id="overflow-menu">
          <button class="overflow-menu-item" id="menu-settings">
            <span class="material-symbols-outlined">settings</span>
            Settings
          </button>
          <button class="overflow-menu-item" id="menu-copy-html">
            <span class="material-symbols-outlined">content_copy</span>
            Copy Page HTML
          </button>
          <button class="overflow-menu-item" id="menu-clear">
            <span class="material-symbols-outlined">deselect</span>
            Clear Selection
          </button>
          <div class="overflow-menu-separator"></div>
          <button class="overflow-menu-item" id="menu-storage-toggle">
            <span class="material-symbols-outlined">cookie</span>
            <span id="menu-storage-label">Storage Data</span>
            <span class="overflow-menu-check" id="menu-storage-check" style="display:none;">
              <span class="material-symbols-outlined" style="font-size:16px;margin-left:auto;">check</span>
            </span>
          </button>
          <button class="overflow-menu-item" id="menu-storage-view" style="display:none;">
            <span class="material-symbols-outlined">manage_search</span>
            View Storage Data
          </button>
          <div class="overflow-menu-separator"></div>
          <div class="overflow-menu-version">v${extensionVersion}</div>
        </div>
      </div>
    </div>
  `;

  // Add instruction banner after toolbar
  const banner = document.createElement('div');
  banner.className = 'instruction-banner';
  banner.id = 'instruction-banner';
  banner.innerHTML = getInstructionBannerHtml(state);
  container.parentElement?.insertBefore(banner, container.nextSibling);

  const annotationStrip = document.createElement('div');
  annotationStrip.className = 'annotation-strip';
  annotationStrip.id = 'annotation-strip';
  annotationStrip.innerHTML = `
    <div class="annotation-strip-section annotation-tools">
      ${annotationTools.map((tool) => {
        const label = tool.charAt(0).toUpperCase() + tool.slice(1);
        return `<button class="annotation-control annotation-tool" type="button" data-annotate-tool="${tool}" title="${label} (${ANNOTATION_TOOL_SHORTCUTS[tool as ToolbarAnnotationTool]})"><span class="material-symbols-outlined">${ANNOTATION_TOOL_ICONS[tool as ToolbarAnnotationTool]}</span></button>`;
      }).join('')}
    </div>
    <div class="annotation-strip-section annotation-colors">
      ${annotationColors.map((color) => `
        <button class="annotation-color" type="button" data-annotate-color="${color}" aria-label="Select color ${color}">
          <span class="annotation-color-swatch" style="background:${color};"></span>
        </button>
      `).join('')}
    </div>
    <div class="annotation-strip-section annotation-actions">
      <button class="annotation-control" id="annotation-undo" type="button" title="Undo (Ctrl+Z)"><span class="material-symbols-outlined">undo</span></button>
      <button class="annotation-control" id="annotation-redo" type="button" title="Redo (Ctrl+Shift+Z)"><span class="material-symbols-outlined">redo</span></button>
      <button class="annotation-control" id="annotation-delete" type="button" title="Delete (Del)"><span class="material-symbols-outlined">delete</span></button>
      <button class="annotation-control" id="annotation-clear" type="button" title="Clear All"><span class="material-symbols-outlined">clear_all</span></button>
    </div>
    <div class="annotation-strip-section annotation-compose">
      <input id="annotation-prompt" class="annotation-prompt" type="text" placeholder="Add a note for chat" spellcheck="false" />
      <button class="annotation-control annotation-send" id="annotation-send" type="button" title="Send (Ctrl+Enter)"><span class="material-symbols-outlined">send</span></button>
      <button class="annotation-control" id="annotation-dismiss" type="button" title="Dismiss"><span class="material-symbols-outlined">close</span></button>
    </div>
    <div class="annotation-strip-confirm" id="annotation-confirm">
      <span class="annotation-confirm-message">Discard annotations?</span>
      <button class="annotation-control" id="annotation-confirm-keep" type="button">Keep editing</button>
      <button class="annotation-control" id="annotation-confirm-discard" type="button">Discard</button>
    </div>
  `;
  container.parentElement?.insertBefore(annotationStrip, banner.nextSibling);

  // ── Get references ─────────────────────────────────────────
  const urlBar = container.querySelector('#url-bar') as HTMLInputElement;
  const btnBack = container.querySelector('#btn-back') as HTMLButtonElement;
  const btnForward = container.querySelector('#btn-forward') as HTMLButtonElement;
  const btnReload = container.querySelector('#btn-reload') as HTMLButtonElement;
  const btnInspect = container.querySelector('#btn-inspect') as HTMLButtonElement;
  const btnAddElement = container.querySelector('#btn-add-element') as HTMLButtonElement;
  const btnAnnotate = container.querySelector('#btn-annotate') as HTMLButtonElement;
  const btnRecord = container.querySelector('#btn-record') as HTMLButtonElement;
  const btnAddLogs = container.querySelector('#btn-add-logs') as HTMLButtonElement;
  const btnScreenshot = container.querySelector('#btn-screenshot') as HTMLButtonElement;
  const btnOverflow = container.querySelector('#btn-overflow') as HTMLButtonElement;
  const overflowMenu = container.querySelector('#overflow-menu') as HTMLElement;
  const menuStorageToggle = container.querySelector('#menu-storage-toggle') as HTMLButtonElement;
  const menuStorageCheck = container.querySelector('#menu-storage-check') as HTMLElement;
  const menuStorageView = container.querySelector('#menu-storage-view') as HTMLButtonElement;

  const btnBackend = container.querySelector('#btn-backend') as HTMLButtonElement;
  const backendMenu = container.querySelector('#backend-menu') as HTMLElement;
  const backendIconLight = container.querySelector('#backend-icon-light') as HTMLImageElement;
  const backendIconDark = container.querySelector('#backend-icon-dark') as HTMLImageElement;
  const backendIconClipboard = container.querySelector('#backend-icon-clipboard') as HTMLElement;
  const annotationPrompt = annotationStrip.querySelector('#annotation-prompt') as HTMLInputElement;
  const annotationDeleteButton = annotationStrip.querySelector('#annotation-delete') as HTMLButtonElement;
  const annotationConfirmKeep = annotationStrip.querySelector('#annotation-confirm-keep') as HTMLButtonElement;
  const annotationConfirmDiscard = annotationStrip.querySelector('#annotation-confirm-discard') as HTMLButtonElement;
  annotationDeleteButton.disabled = true;

  annotationConfirmKeep.addEventListener('click', () => {
    confirmPending = false;
    annotationStrip.removeAttribute('data-confirm');
  });

  annotationConfirmDiscard.addEventListener('click', () => {
    confirmPending = false;
    annotationStrip.removeAttribute('data-confirm');
    callbacks?.onAnnotateDismiss?.();
  });

  // Read icon URIs from the hidden data element
  const iconData = document.getElementById('backend-icons');
  const iconUris: Record<string, { light: string; dark: string }> = {
    opencode: {
      light: iconData?.dataset.opencodeLight || '',
      dark: iconData?.dataset.opencodeDark || '',
    },
    openchamber: {
      light: iconData?.dataset.openchamberLight || '',
      dark: iconData?.dataset.openchamberDark || '',
    },
    codex: {
      light: iconData?.dataset.codexLight || '',
      dark: iconData?.dataset.codexDark || '',
    },
    claudecode: {
      light: iconData?.dataset.claudecodeLight || '',
      dark: iconData?.dataset.claudecodeDark || '',
    },
  };

  const elements: ToolbarElements = { urlBar, btnInspect, btnAddElement, btnAnnotate, btnRecord, banner, annotationStrip };

  function clearOtherModes(nextMode: 'inspect' | 'addElement' | 'annotate' | 'record') {
    if (nextMode !== 'inspect') state.inspectActive = false;
    if (nextMode !== 'addElement') state.addElementActive = false;
    if (nextMode !== 'annotate') state.annotateActive = false;
    if (nextMode !== 'record') {
      state.recordPending = false;
      state.recordActive = false;
    }
  }

  function updateAnnotationControls() {
    annotationStrip.querySelectorAll<HTMLElement>('[data-annotate-tool]').forEach((item) => {
      item.classList.toggle('active', item.dataset.annotateTool === activeAnnotationTool);
    });
    annotationStrip.querySelectorAll<HTMLElement>('[data-annotate-color]').forEach((item) => {
      item.classList.toggle('active', item.dataset.annotateColor === activeAnnotationColor);
    });
    annotationDeleteButton.disabled = !annotateDeleteEnabled;
  }

  // ── Navigation ─────────────────────────────────────────────
  btnBack.addEventListener('click', () => {
    postMessage(createToolbarDiagnostic('Back pressed'));
    postMessage({ type: 'nav:back', payload: {} });
  });

  btnForward.addEventListener('click', () => {
    postMessage(createToolbarDiagnostic('Forward pressed'));
    postMessage({ type: 'nav:forward', payload: {} });
  });

  btnReload.addEventListener('click', () => {
    postMessage(createToolbarDiagnostic('Reload pressed'));
    postMessage({ type: 'nav:reload', payload: {} });
  });

  urlBar.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      const url = urlBar.value.trim();
      if (url) {
        postMessage(createToolbarDiagnostic('Navigate requested', url));
        postMessage({ type: 'navigate', payload: { url } });
      }
    }
  });

  // ── Mode toggles ──────────────────────────────────────────
  btnInspect.addEventListener('click', () => {
    state.inspectActive = !state.inspectActive;
    if (state.inspectActive) {
      clearOtherModes('inspect');
    }
    postMessage(createToolbarDiagnostic(`Inspect toggled ${state.inspectActive ? 'on' : 'off'}`));
    updateModeUI();
    stateChangeCallback?.({ ...state });
  });

  btnAddElement.addEventListener('click', () => {
    state.addElementActive = !state.addElementActive;
    if (state.addElementActive) {
      clearOtherModes('addElement');
    }
    postMessage(createToolbarDiagnostic(`Add-element toggled ${state.addElementActive ? 'on' : 'off'}`));
    updateModeUI();
    stateChangeCallback?.({ ...state });
  });

  btnRecord.addEventListener('click', () => {
    if (state.recordActive) return;
    if (!state.recordPending) {
      clearOtherModes('record');
    }
    state.recordPending = !state.recordPending;
    postMessage(createToolbarDiagnostic(`Record button toggled ${state.recordPending ? 'pending' : 'off'}`));
    updateRecordUI();
    stateChangeCallback?.({ ...state });
  });

  btnAnnotate.addEventListener('click', () => {
    state.annotateActive = !state.annotateActive;
    if (state.annotateActive) {
      clearOtherModes('annotate');
    }
    postMessage(createToolbarDiagnostic(`Annotate toggled ${state.annotateActive ? 'on' : 'off'}`));
    updateModeUI();
    stateChangeCallback?.({ ...state });
  });

  annotationStrip.querySelectorAll<HTMLButtonElement>('[data-annotate-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextTool = button.dataset.annotateTool;
      if (!nextTool || !isToolbarAnnotationTool(nextTool)) {
        return;
      }

      postMessage(createToolbarDiagnostic(`Annotation tool selected: ${nextTool}`));
      activeAnnotationTool = nextTool;
      updateAnnotationControls();
      callbacks?.onAnnotateTool?.(activeAnnotationTool);
    });
  });

  annotationStrip.querySelectorAll<HTMLButtonElement>('[data-annotate-color]').forEach((button) => {
    button.addEventListener('click', () => {
      activeAnnotationColor = button.dataset.annotateColor || activeAnnotationColor;
      updateAnnotationControls();
      callbacks?.onAnnotateColor?.(activeAnnotationColor);
    });
  });

  annotationStrip.querySelector('#annotation-undo')?.addEventListener('click', () => {
    callbacks?.onAnnotateUndo?.();
  });

  annotationStrip.querySelector('#annotation-redo')?.addEventListener('click', () => {
    callbacks?.onAnnotateRedo?.();
  });

  annotationStrip.querySelector('#annotation-delete')?.addEventListener('click', () => {
    callbacks?.onAnnotateDelete?.();
  });

  annotationStrip.querySelector('#annotation-clear')?.addEventListener('click', () => {
    callbacks?.onAnnotateClear?.();
  });

  annotationStrip.querySelector('#annotation-send')?.addEventListener('click', () => {
    callbacks?.onAnnotateSend?.(annotationPrompt.value.trim());
  });

  annotationPrompt.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      callbacks?.onAnnotateSend?.(annotationPrompt.value.trim());
    }
  });

  annotationStrip.querySelector('#annotation-dismiss')?.addEventListener('click', () => {
    if (callbacks?.onAnnotateHasShapes?.()) {
      confirmPending = true;
      annotationStrip.setAttribute('data-confirm', '');
    } else {
      callbacks?.onAnnotateDismiss?.();
    }
  });

  // ── Action buttons ────────────────────────────────────────
  btnAddLogs.addEventListener('click', () => {
    postMessage(createToolbarDiagnostic('Add logs pressed'));
    callbacks?.onLogsRequest?.();
  });

  btnScreenshot.addEventListener('click', () => {
    postMessage(createToolbarDiagnostic('Screenshot pressed'));
    callbacks?.onScreenshotRequest?.();
  });

  // ── Backend menu ──────────────────────────────────────────
  btnBackend.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    postMessage(createToolbarDiagnostic('Backend selector pressed'));
    // Close overflow menu if open
    overflowMenu.classList.remove('visible');
    // Toggle backend menu
    if (backendMenu.classList.contains('visible')) {
      backendMenu.classList.remove('visible');
    } else {
      renderBackendMenu();
      backendMenu.classList.add('visible');
      callbacks?.onBackendRequest?.();
    }
  });

  // ── Overflow menu ─────────────────────────────────────────
  btnOverflow.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    postMessage(createToolbarDiagnostic('Overflow menu pressed'));
    backendMenu.classList.remove('visible');
    overflowMenu.classList.toggle('visible');
  });

  document.addEventListener('click', () => {
    overflowMenu.classList.remove('visible');
    backendMenu.classList.remove('visible');
  });

  container.querySelector('#menu-settings')!.addEventListener('click', () => {
    postMessage(createToolbarDiagnostic('Settings menu pressed'));
    postMessage({ type: 'menu:openSettings', payload: {} });
    overflowMenu.classList.remove('visible');
  });

  container.querySelector('#menu-copy-html')!.addEventListener('click', () => {
    // Try to get the iframe's HTML — will be limited for cross-origin
    const iframe = document.querySelector('#browser-iframe') as HTMLIFrameElement | null;
    let html = '';
    try {
      html = iframe?.contentDocument?.documentElement?.outerHTML || '';
    } catch {
      html = '<!-- Cross-origin: cannot access page HTML -->';
    }
    postMessage(createToolbarDiagnostic('Copy page HTML pressed'));
    postMessage({ type: 'menu:copyHtml', payload: { html } });
    overflowMenu.classList.remove('visible');
  });

  container.querySelector('#menu-clear')!.addEventListener('click', () => {
    postMessage(createToolbarDiagnostic('Clear selection pressed'));
    postMessage({ type: 'menu:clearSelection', payload: {} });
    overflowMenu.classList.remove('visible');
  });

  menuStorageToggle.addEventListener('click', () => {
    // Read current state from the check visibility and invert
    const currentlyEnabled = menuStorageCheck.style.display !== 'none';
    postMessage({ type: 'storage:setEnabled', payload: { enabled: !currentlyEnabled } });
    overflowMenu.classList.remove('visible');
  });

  menuStorageView.addEventListener('click', () => {
    postMessage({ type: 'storage:openView', payload: {} });
    overflowMenu.classList.remove('visible');
  });

  // ── Keyboard handler ──────────────────────────────────────
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (state.annotateActive) {
      postMessage(createToolbarDiagnostic(`Keydown: ${e.key} annotateActive=${state.annotateActive}`));
    }

    // Non-annotate Escape handling
    if (e.key === 'Escape' && !state.annotateActive) {
      if (state.recordActive || state.recordPending) return;
      state.inspectActive = false;
      state.addElementActive = false;
      postMessage(createToolbarDiagnostic('Escape pressed - modes cleared'));
      updateModeUI();
      stateChangeCallback?.({ ...state });
      return;
    }

    if (!state.annotateActive) return;

    const inPrompt = document.activeElement === annotationPrompt;

    // ── Escape: two-step confirm ──────────────────────────────
    if (e.key === 'Escape') {
      if (state.recordActive || state.recordPending) return;
      if (confirmPending) {
        // Second Escape — discard
        confirmPending = false;
        annotationStrip.removeAttribute('data-confirm');
        postMessage(createToolbarDiagnostic('Escape (2nd) pressed - annotate dismissed'));
        callbacks?.onAnnotateDismiss?.();
      } else if (callbacks?.onAnnotateHasShapes?.()) {
        // First Escape with annotations — show confirm
        confirmPending = true;
        annotationStrip.setAttribute('data-confirm', '');
        postMessage(createToolbarDiagnostic('Escape pressed - confirm shown'));
      } else {
        // No annotations — dismiss immediately
        postMessage(createToolbarDiagnostic('Escape pressed - annotate dismiss (no shapes)'));
        callbacks?.onAnnotateDismiss?.();
      }
      return;
    }

    // ── Modifier-key shortcuts (fire regardless of focus) ────
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        callbacks?.onAnnotateUndo?.();
        return;
      }
      if (e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault();
        callbacks?.onAnnotateRedo?.();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const prompt = annotationPrompt.value.trim();
        callbacks?.onAnnotateSend?.(prompt);
        return;
      }
      if (e.key === 'Backspace' && e.shiftKey) {
        e.preventDefault();
        callbacks?.onAnnotateClear?.();
        return;
      }
      return;
    }

    // ── Single-key shortcuts (blocked when typing in prompt) ─
    if (inPrompt) return;

    const toolKeys: Record<string, ToolbarAnnotationTool> = {
      s: 'select', p: 'pen', a: 'arrow', r: 'rect', e: 'ellipse', t: 'text', c: 'callout',
    };
    if (toolKeys[e.key]) {
      e.preventDefault();
      const tool = toolKeys[e.key];
      activeAnnotationTool = tool;
      updateAnnotationControls();
      callbacks?.onAnnotateTool?.(tool);
      return;
    }

    const colorIndex = parseInt(e.key, 10);
    if (colorIndex >= 1 && colorIndex <= annotationColors.length) {
      e.preventDefault();
      const color = annotationColors[colorIndex - 1];
      activeAnnotationColor = color;
      updateAnnotationControls();
      callbacks?.onAnnotateColor?.(color);
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      callbacks?.onAnnotateDelete?.();
      return;
    }
  });

  // ── UI update helpers ─────────────────────────────────────
  function updateModeUI() {
    elements.btnInspect.classList.toggle('active', state.inspectActive);
    elements.btnAddElement.classList.toggle('active', state.addElementActive);
    elements.btnAnnotate.classList.toggle('active', state.annotateActive);
    elements.btnRecord.classList.toggle('active', state.recordPending || state.recordActive);
    elements.btnRecord.classList.toggle('record-active', state.recordActive);
    elements.btnInspect.disabled = state.recordActive;
    elements.btnAddElement.disabled = state.recordActive;
    elements.btnAnnotate.disabled = state.recordActive;
    elements.banner.innerHTML = getInstructionBannerHtml(state);
    elements.banner.classList.toggle('visible', state.inspectActive || state.addElementActive || state.annotateActive);
    elements.annotationStrip.classList.toggle('visible', state.annotateActive);
    container.classList.toggle('mode-active', state.inspectActive || state.addElementActive || state.annotateActive);
    updateAnnotationControls();
  }

  function updateRecordUI() {
    elements.btnRecord.classList.toggle('active', state.recordPending || state.recordActive);
    elements.btnRecord.classList.toggle('record-active', state.recordActive);
    elements.btnInspect.disabled = state.recordActive;
    elements.btnAddElement.disabled = state.recordActive;
    elements.btnAnnotate.disabled = state.recordActive;
    elements.annotationStrip.classList.remove('visible');

    if (state.recordPending) {
      elements.banner.innerHTML = getRecordConfigBannerHtml(recordOpts);
      elements.banner.classList.add('visible');
      attachConfigHandlers();
    } else if (state.recordActive) {
      elements.banner.innerHTML = getRecordActiveBannerHtml(recordEventCount, recordElapsedSeconds);
      elements.banner.classList.add('visible');
      attachStopHandler();
    } else {
      updateModeUI();
    }
  }

  function attachConfigHandlers() {
    const bannerEl = elements.banner;

    bannerEl.querySelectorAll<HTMLInputElement>('[data-record-opt]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.recordOpt as keyof RecordOptions;
        if (key in recordOpts) {
          recordOpts[key] = cb.checked;
        }
      });
    });

    const startBtn = bannerEl.querySelector('[data-record-start]') as HTMLButtonElement | null;
    startBtn?.addEventListener('click', () => {
      state.recordPending = false;
      state.recordActive = true;
      recordEventCount = 0;
      recordElapsedSeconds = 0;
      postMessage(createToolbarDiagnostic('Recording started'));
      callbacks?.onRecordStart?.({ ...recordOpts });
      updateRecordUI();
    });

    const cancelBtn = bannerEl.querySelector('[data-record-cancel]') as HTMLButtonElement | null;
    cancelBtn?.addEventListener('click', () => {
      state.recordPending = false;
      postMessage(createToolbarDiagnostic('Record config cancelled'));
      updateRecordUI();
    });
  }

  function attachStopHandler() {
    const stopBtn = elements.banner.querySelector('[data-record-stop]') as HTMLButtonElement | null;
    stopBtn?.addEventListener('click', () => {
      postMessage(createToolbarDiagnostic('Recording stopped'));
      callbacks?.onRecordStop?.();
    });
  }

  // Backend state
  let backendState: { active: string; available: Record<string, boolean> } = {
    active: 'clipboard',
    available: { clipboard: true, opencode: false, openchamber: false, codex: false, claudecode: false },
  };

  function updateBackendIcon() {
    const active = backendState.active;
    const uris = iconUris[active];

    backendIconLight.style.display = 'none';
    backendIconDark.style.display = 'none';
    backendIconClipboard.style.display = 'none';

    if (active === 'clipboard') {
      backendIconClipboard.style.display = 'inline';
    } else if (uris) {
      backendIconLight.src = uris.light;
      backendIconDark.src = uris.dark;
      backendIconLight.style.display = '';
      backendIconDark.style.display = '';
      // CSS [data-theme] rules handle which one is actually visible
    }
  }

  function renderBackendMenu() {
    const backends = [
      { key: 'opencode', label: 'OpenCode' },
      { key: 'openchamber', label: 'OpenChamber' },
      { key: 'codex', label: 'Codex' },
      { key: 'claudecode', label: 'Claude Code' },
      { key: 'clipboard', label: 'Clipboard' },
    ];

    backendMenu.innerHTML = backends.map((b) => {
      const isActive = b.key === backendState.active;
      const isAvailable = backendState.available[b.key] !== false;
      const disabledClass = isAvailable ? '' : ' disabled';
      const activeClass = isActive ? ' active' : '';
      const icon = b.key === 'clipboard'
        ? `<span class="material-symbols-outlined" style="font-size:16px;">content_copy</span>`
        : `<img class="backend-menu-icon backend-icon-light" src="${iconUris[b.key]?.light || ''}" width="16" height="16" /><img class="backend-menu-icon backend-icon-dark" src="${iconUris[b.key]?.dark || ''}" width="16" height="16" />`;
      const check = isActive ? '<span class="material-symbols-outlined" style="font-size:16px;margin-left:auto;">check</span>' : '';

      return `<button class="backend-menu-item${activeClass}${disabledClass}" data-backend="${b.key}">
        ${icon}
        <span>${b.label}</span>
        ${check}
      </button>`;
    }).join('');

    // Attach click handlers
    backendMenu.querySelectorAll('.backend-menu-item:not(.disabled)').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const backend = (item as HTMLElement).dataset.backend!;
        postMessage(createToolbarDiagnostic('Backend selected', backend));
        callbacks?.onBackendSelect?.(backend);
        backendMenu.classList.remove('visible');
      });
    });
  }

  // Set initial default icon
  updateBackendIcon();

  // ── Public API ────────────────────────────────────────────
  return {
    setUrl(url: string) {
      elements.urlBar.value = url;
    },

    setInspectActive(active: boolean) {
      state.inspectActive = active;
      if (active) clearOtherModes('inspect');
      updateModeUI();
    },

    setAddElementActive(active: boolean) {
      state.addElementActive = active;
      if (active) clearOtherModes('addElement');
      updateModeUI();
    },

    setAnnotateActive(active: boolean) {
      state.annotateActive = active;
      if (active) clearOtherModes('annotate');
      if (!active) {
        confirmPending = false;
        annotationStrip.removeAttribute('data-confirm');
      }
      updateModeUI();
    },

    setAnnotateDeleteEnabled(enabled: boolean) {
      annotateDeleteEnabled = enabled;
      updateAnnotationControls();
    },

    setBackendState(active: string, available: Record<string, boolean>) {
      backendState = { active, available };
      updateBackendIcon();
      // If menu is open, re-render with new state
      if (backendMenu.classList.contains('visible')) {
        renderBackendMenu();
      }
    },

    setStorageDataState(enabled: boolean, hasData: boolean) {
      menuStorageCheck.style.display = enabled ? 'inline' : 'none';
      menuStorageView.style.display = (enabled && hasData) ? '' : 'none';
    },

    setRecordActive(active: boolean) {
      state.recordActive = active;
      state.recordPending = false;
      if (!active) {
        recordEventCount = 0;
        recordElapsedSeconds = 0;
      }
      updateRecordUI();
    },

    setRecordOptions(opts: RecordOptions) {
      recordOpts = { ...opts };
    },

    updateRecordingStatus(eventCount: number, elapsedSeconds: number) {
      recordEventCount = eventCount;
      recordElapsedSeconds = elapsedSeconds;
      if (state.recordActive) {
        elements.banner.innerHTML = getRecordActiveBannerHtml(recordEventCount, recordElapsedSeconds);
        attachStopHandler();
      }
    },

    onStateChange(cb: (state: ToolbarState) => void) {
      stateChangeCallback = cb;
    },
  };
}
