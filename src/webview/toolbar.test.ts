// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbar } from './toolbar';

describe('createToolbar', () => {
  let shell: HTMLDivElement;
  let toolbar: HTMLDivElement;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="shell">
        <div id="toolbar"></div>
        <div id="browser-frame"></div>
      </div>
      <div
        id="backend-icons"
        data-opencode-light="opencode-light"
        data-opencode-dark="opencode-dark"
        data-openchamber-light="openchamber-light"
        data-openchamber-dark="openchamber-dark"
        data-codex-light="codex-light"
        data-codex-dark="codex-dark"
        data-claudecode-light="claudecode-light"
        data-claudecode-dark="claudecode-dark"
      ></div>
    `;

    shell = document.querySelector('#shell') as HTMLDivElement;
    toolbar = document.querySelector('#toolbar') as HTMLDivElement;
    postMessage = vi.fn();
  });

  it('toggles annotate mode from the toolbar button', () => {
    const api = createToolbar(toolbar, postMessage);

    api.setAnnotateActive(false);
    const button = toolbar.querySelector('#btn-annotate') as HTMLButtonElement;
    button.click();

    expect(button.classList.contains('active')).toBe(true);
    expect(shell.querySelector('#annotation-strip')?.classList.contains('visible')).toBe(true);
  });

  it('turns off inspect and add-element when annotate mode is entered', () => {
    const api = createToolbar(toolbar, postMessage);

    api.setInspectActive(true);
    api.setAddElementActive(true);
    api.setAnnotateActive(true);

    expect(toolbar.querySelector('#btn-annotate')?.classList.contains('active')).toBe(true);
    expect(toolbar.querySelector('#btn-inspect')?.classList.contains('active')).toBe(false);
    expect(toolbar.querySelector('#btn-add-element')?.classList.contains('active')).toBe(false);
  });

  it('turns off annotate when inspect or add-element mode is entered', () => {
    const api = createToolbar(toolbar, postMessage);

    api.setAnnotateActive(true);
    api.setInspectActive(true);
    expect(toolbar.querySelector('#btn-annotate')?.classList.contains('active')).toBe(false);

    api.setAnnotateActive(true);
    api.setAddElementActive(true);
    expect(toolbar.querySelector('#btn-annotate')?.classList.contains('active')).toBe(false);
  });

  it('shows the annotation strip only while annotate mode is active', () => {
    const api = createToolbar(toolbar, postMessage);
    const strip = shell.querySelector('#annotation-strip') as HTMLElement;

    expect(strip.classList.contains('visible')).toBe(false);

    api.setAnnotateActive(true);
    expect(strip.classList.contains('visible')).toBe(true);

    api.setAnnotateActive(false);
    expect(strip.classList.contains('visible')).toBe(false);
  });

  it('fires annotate callbacks with expected values', () => {
    const callbacks = {
      onAnnotateTool: vi.fn(),
      onAnnotateColor: vi.fn(),
      onAnnotateUndo: vi.fn(),
      onAnnotateClear: vi.fn(),
      onAnnotateSend: vi.fn(),
      onAnnotateDismiss: vi.fn(),
    };

    const api = createToolbar(toolbar, postMessage, callbacks);
    api.setAnnotateActive(true);

    (shell.querySelector('[data-annotate-tool="arrow"]') as HTMLButtonElement).click();
    (shell.querySelector('[data-annotate-color="#ff4d4f"]') as HTMLButtonElement).click();
    (shell.querySelector('#annotation-undo') as HTMLButtonElement).click();
    (shell.querySelector('#annotation-clear') as HTMLButtonElement).click();

    const input = shell.querySelector('#annotation-prompt') as HTMLInputElement;
    input.value = 'Explain the visual bug';
    (shell.querySelector('#annotation-send') as HTMLButtonElement).click();
    (shell.querySelector('#annotation-dismiss') as HTMLButtonElement).click();

    expect(callbacks.onAnnotateTool).toHaveBeenCalledWith('arrow');
    expect(callbacks.onAnnotateColor).toHaveBeenCalledWith('#ff4d4f');
    expect(callbacks.onAnnotateUndo).toHaveBeenCalledTimes(1);
    expect(callbacks.onAnnotateClear).toHaveBeenCalledTimes(1);
    expect(callbacks.onAnnotateSend).toHaveBeenCalledWith('Explain the visual bug');
    expect(callbacks.onAnnotateDismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves annotate mode active until dismiss is confirmed by the caller', () => {
    const callbacks = {
      onAnnotateDismiss: vi.fn(),
    };

    const api = createToolbar(toolbar, postMessage, callbacks);
    api.setAnnotateActive(true);

    (shell.querySelector('#annotation-dismiss') as HTMLButtonElement).click();

    expect(callbacks.onAnnotateDismiss).toHaveBeenCalledTimes(1);
    expect(toolbar.querySelector('#btn-annotate')?.classList.contains('active')).toBe(true);
    expect(shell.querySelector('#annotation-strip')?.classList.contains('visible')).toBe(true);
  });

  it('routes annotate escape through dismiss instead of clearing toolbar state directly', () => {
    const callbacks = {
      onAnnotateDismiss: vi.fn(),
    };

    const api = createToolbar(toolbar, postMessage, callbacks);
    api.setAnnotateActive(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(callbacks.onAnnotateDismiss).toHaveBeenCalledTimes(1);
    expect(toolbar.querySelector('#btn-annotate')?.classList.contains('active')).toBe(true);
    expect(shell.querySelector('#annotation-strip')?.classList.contains('visible')).toBe(true);
  });
});
