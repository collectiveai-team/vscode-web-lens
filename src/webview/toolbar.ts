import type { WebviewMessage } from '../types';

type PostMessage = (msg: WebviewMessage) => void;

interface ToolbarState {
  inspectActive: boolean;
  addElementActive: boolean;
}

interface ToolbarElements {
  urlBar: HTMLInputElement;
  btnInspect: HTMLButtonElement;
  btnAddElement: HTMLButtonElement;
  banner: HTMLElement;
}

export interface ToolbarAPI {
  setUrl(url: string): void;
  setInspectActive(active: boolean): void;
  setAddElementActive(active: boolean): void;
  onStateChange(cb: (state: ToolbarState) => void): void;
}

export function createToolbar(
  container: HTMLElement,
  postMessage: PostMessage,
  callbacks?: {
    onLogsRequest?: () => void;
    onScreenshotRequest?: () => void;
  }
): ToolbarAPI {
  const state: ToolbarState = {
    inspectActive: false,
    addElementActive: false,
  };

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
      <div class="toolbar-divider"></div>
      <button class="toolbar-btn" id="btn-add-logs" title="Add Logs to Chat">
        <span class="material-symbols-outlined">terminal</span>
      </button>
      <button class="toolbar-btn" id="btn-screenshot" title="Screenshot">
        <span class="material-symbols-outlined">screenshot_monitor</span>
      </button>
      <div class="toolbar-divider"></div>
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
        </div>
      </div>
    </div>
  `;

  // Add instruction banner after toolbar
  const banner = document.createElement('div');
  banner.className = 'instruction-banner';
  banner.id = 'instruction-banner';
  banner.innerHTML = `Click any element to add it to chat &nbsp; <kbd>ESC</kbd> to cancel`;
  container.parentElement?.insertBefore(banner, container.nextSibling);

  // ── Get references ─────────────────────────────────────────
  const urlBar = container.querySelector('#url-bar') as HTMLInputElement;
  const btnBack = container.querySelector('#btn-back') as HTMLButtonElement;
  const btnForward = container.querySelector('#btn-forward') as HTMLButtonElement;
  const btnReload = container.querySelector('#btn-reload') as HTMLButtonElement;
  const btnInspect = container.querySelector('#btn-inspect') as HTMLButtonElement;
  const btnAddElement = container.querySelector('#btn-add-element') as HTMLButtonElement;
  const btnAddLogs = container.querySelector('#btn-add-logs') as HTMLButtonElement;
  const btnScreenshot = container.querySelector('#btn-screenshot') as HTMLButtonElement;
  const btnOverflow = container.querySelector('#btn-overflow') as HTMLButtonElement;
  const overflowMenu = container.querySelector('#overflow-menu') as HTMLElement;

  const elements: ToolbarElements = { urlBar, btnInspect, btnAddElement, banner };

  // ── Navigation ─────────────────────────────────────────────
  btnBack.addEventListener('click', () => {
    postMessage({ type: 'nav:back', payload: {} });
  });

  btnForward.addEventListener('click', () => {
    postMessage({ type: 'nav:forward', payload: {} });
  });

  btnReload.addEventListener('click', () => {
    postMessage({ type: 'nav:reload', payload: {} });
  });

  urlBar.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      const url = urlBar.value.trim();
      if (url) {
        postMessage({ type: 'navigate', payload: { url } });
      }
    }
  });

  // ── Mode toggles ──────────────────────────────────────────
  btnInspect.addEventListener('click', () => {
    state.inspectActive = !state.inspectActive;
    if (state.inspectActive) {
      state.addElementActive = false;
    }
    updateModeUI();
    stateChangeCallback?.({ ...state });
  });

  btnAddElement.addEventListener('click', () => {
    state.addElementActive = !state.addElementActive;
    if (state.addElementActive) {
      state.inspectActive = false;
    }
    updateModeUI();
    stateChangeCallback?.({ ...state });
  });

  // ── Action buttons ────────────────────────────────────────
  btnAddLogs.addEventListener('click', () => {
    callbacks?.onLogsRequest?.();
  });

  btnScreenshot.addEventListener('click', () => {
    callbacks?.onScreenshotRequest?.();
  });

  // ── Overflow menu ─────────────────────────────────────────
  btnOverflow.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    overflowMenu.classList.toggle('visible');
  });

  document.addEventListener('click', () => {
    overflowMenu.classList.remove('visible');
  });

  container.querySelector('#menu-settings')!.addEventListener('click', () => {
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
    postMessage({ type: 'menu:copyHtml', payload: { html } });
    overflowMenu.classList.remove('visible');
  });

  container.querySelector('#menu-clear')!.addEventListener('click', () => {
    postMessage({ type: 'menu:clearSelection', payload: {} });
    overflowMenu.classList.remove('visible');
  });

  // ── ESC key handler ───────────────────────────────────────
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      state.inspectActive = false;
      state.addElementActive = false;
      updateModeUI();
      stateChangeCallback?.({ ...state });
    }
  });

  // ── UI update helpers ─────────────────────────────────────
  function updateModeUI() {
    elements.btnInspect.classList.toggle('active', state.inspectActive);
    elements.btnAddElement.classList.toggle('active', state.addElementActive);
    elements.banner.classList.toggle('visible', state.addElementActive);
    container.classList.toggle('mode-active', state.inspectActive || state.addElementActive);
  }

  // ── Public API ────────────────────────────────────────────
  return {
    setUrl(url: string) {
      elements.urlBar.value = url;
    },

    setInspectActive(active: boolean) {
      state.inspectActive = active;
      if (active) state.addElementActive = false;
      updateModeUI();
    },

    setAddElementActive(active: boolean) {
      state.addElementActive = active;
      if (active) state.inspectActive = false;
      updateModeUI();
    },

    onStateChange(cb: (state: ToolbarState) => void) {
      stateChangeCallback = cb;
    },
  };
}
