import type { WebviewMessage } from '../types';
import type { AnnotationTool } from './annotation-overlay';
import { createToolbarDiagnostic, getInstructionBannerHtml } from './toolbarDiagnostics';

type PostMessage = (msg: WebviewMessage) => void;

interface ToolbarState {
  inspectActive: boolean;
  addElementActive: boolean;
  annotateActive: boolean;
}

interface ToolbarElements {
  urlBar: HTMLInputElement;
  btnInspect: HTMLButtonElement;
  btnAddElement: HTMLButtonElement;
  btnAnnotate: HTMLButtonElement;
  banner: HTMLElement;
  annotationStrip: HTMLElement;
}

interface ToolbarCallbacks {
  onLogsRequest?: () => void;
  onScreenshotRequest?: () => void;
  onBackendRequest?: () => void;
  onBackendSelect?: (backend: string) => void;
  onAnnotateTool?: (tool: AnnotationTool) => void;
  onAnnotateColor?: (color: string) => void;
  onAnnotateUndo?: () => void;
  onAnnotateClear?: () => void;
  onAnnotateSend?: (prompt: string) => void;
  onAnnotateDismiss?: () => void;
}

export interface ToolbarAPI {
  setUrl(url: string): void;
  setInspectActive(active: boolean): void;
  setAddElementActive(active: boolean): void;
  setAnnotateActive(active: boolean): void;
  setBackendState(active: string, available: Record<string, boolean>): void;
  setStorageDataState(enabled: boolean, hasData: boolean): void;
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
  };

  let activeAnnotationTool: AnnotationTool = 'pen';
  let activeAnnotationColor = '#ff3b30';
  const annotationTools: AnnotationTool[] = ['pen', 'arrow', 'rect', 'ellipse', 'text', 'callout'];
  const annotationColors = ['#ff3b30', '#ff4d4f', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2'];

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
      ${annotationTools.map((tool) => `
        <button class="annotation-control annotation-tool" type="button" data-annotate-tool="${tool}">${tool}</button>
      `).join('')}
    </div>
    <div class="annotation-strip-section annotation-colors">
      ${annotationColors.map((color) => `
        <button class="annotation-color" type="button" data-annotate-color="${color}" aria-label="Select color ${color}">
          <span class="annotation-color-swatch" style="background:${color};"></span>
        </button>
      `).join('')}
    </div>
    <div class="annotation-strip-section annotation-actions">
      <button class="annotation-control" id="annotation-undo" type="button">Undo</button>
      <button class="annotation-control" id="annotation-clear" type="button">Clear</button>
    </div>
    <div class="annotation-strip-section annotation-compose">
      <input id="annotation-prompt" class="annotation-prompt" type="text" placeholder="Add a note for chat" spellcheck="false" />
      <button class="annotation-control annotation-send" id="annotation-send" type="button">Send</button>
      <button class="annotation-control" id="annotation-dismiss" type="button">Dismiss</button>
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

  const elements: ToolbarElements = { urlBar, btnInspect, btnAddElement, btnAnnotate, banner, annotationStrip };

  function clearOtherModes(nextMode: 'inspect' | 'addElement' | 'annotate') {
    if (nextMode !== 'inspect') state.inspectActive = false;
    if (nextMode !== 'addElement') state.addElementActive = false;
    if (nextMode !== 'annotate') state.annotateActive = false;
  }

  function updateAnnotationControls() {
    annotationStrip.querySelectorAll<HTMLElement>('[data-annotate-tool]').forEach((item) => {
      item.classList.toggle('active', item.dataset.annotateTool === activeAnnotationTool);
    });
    annotationStrip.querySelectorAll<HTMLElement>('[data-annotate-color]').forEach((item) => {
      item.classList.toggle('active', item.dataset.annotateColor === activeAnnotationColor);
    });
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
      activeAnnotationTool = button.dataset.annotateTool as AnnotationTool;
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
    callbacks?.onAnnotateDismiss?.();
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

  // ── ESC key handler ───────────────────────────────────────
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (state.annotateActive) {
        postMessage(createToolbarDiagnostic('Escape pressed - annotate dismiss requested'));
        callbacks?.onAnnotateDismiss?.();
        return;
      }

      state.inspectActive = false;
      state.addElementActive = false;
      state.annotateActive = false;
      postMessage(createToolbarDiagnostic('Escape pressed - modes cleared'));
      updateModeUI();
      stateChangeCallback?.({ ...state });
    }
  });

  // ── UI update helpers ─────────────────────────────────────
  function updateModeUI() {
    elements.btnInspect.classList.toggle('active', state.inspectActive);
    elements.btnAddElement.classList.toggle('active', state.addElementActive);
    elements.btnAnnotate.classList.toggle('active', state.annotateActive);
    elements.banner.innerHTML = getInstructionBannerHtml(state);
    elements.banner.classList.toggle('visible', state.inspectActive || state.addElementActive || state.annotateActive);
    elements.annotationStrip.classList.toggle('visible', state.annotateActive);
    container.classList.toggle('mode-active', state.inspectActive || state.addElementActive || state.annotateActive);
    updateAnnotationControls();
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
      updateModeUI();
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

    onStateChange(cb: (state: ToolbarState) => void) {
      stateChangeCallback = cb;
    },
  };
}
