// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbar } from './toolbar';

function setup(callbacks?: Parameters<typeof createToolbar>[2]) {
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

  const shell = document.querySelector('#shell') as HTMLDivElement;
  const container = document.querySelector('#toolbar') as HTMLDivElement;
  const postMessage = vi.fn();
  const toolbar = createToolbar(container, postMessage, callbacks);
  return { toolbar, container, shell, postMessage };
}

describe('createToolbar annotate mode', () => {
  it('toggles annotate mode from the toolbar button', () => {
    const { toolbar, container, shell } = setup();

    toolbar.setAnnotateActive(false);
    const button = container.querySelector('#btn-annotate') as HTMLButtonElement;
    button.click();

    expect(button.classList.contains('active')).toBe(true);
    expect(shell.querySelector('#annotation-strip')?.classList.contains('visible')).toBe(true);
  });

  it('turns off inspect and add-element when annotate mode is entered', () => {
    const { toolbar, container } = setup();

    toolbar.setInspectActive(true);
    toolbar.setAddElementActive(true);
    toolbar.setAnnotateActive(true);

    expect(container.querySelector('#btn-annotate')?.classList.contains('active')).toBe(true);
    expect(container.querySelector('#btn-inspect')?.classList.contains('active')).toBe(false);
    expect(container.querySelector('#btn-add-element')?.classList.contains('active')).toBe(false);
  });

  it('turns off annotate when inspect or add-element mode is entered', () => {
    const { toolbar, container } = setup();

    toolbar.setAnnotateActive(true);
    toolbar.setInspectActive(true);
    expect(container.querySelector('#btn-annotate')?.classList.contains('active')).toBe(false);

    toolbar.setAnnotateActive(true);
    toolbar.setAddElementActive(true);
    expect(container.querySelector('#btn-annotate')?.classList.contains('active')).toBe(false);
  });

  it('shows the annotation strip only while annotate mode is active', () => {
    const { toolbar, shell } = setup();
    const strip = shell.querySelector('#annotation-strip') as HTMLElement;

    expect(strip.classList.contains('visible')).toBe(false);

    toolbar.setAnnotateActive(true);
    expect(strip.classList.contains('visible')).toBe(true);

    toolbar.setAnnotateActive(false);
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

    const { toolbar, shell } = setup(callbacks);
    toolbar.setAnnotateActive(true);

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
    const callbacks = { onAnnotateDismiss: vi.fn() };
    const { toolbar, container, shell } = setup(callbacks);

    toolbar.setAnnotateActive(true);
    (shell.querySelector('#annotation-dismiss') as HTMLButtonElement).click();

    expect(callbacks.onAnnotateDismiss).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#btn-annotate')?.classList.contains('active')).toBe(true);
    expect(shell.querySelector('#annotation-strip')?.classList.contains('visible')).toBe(true);
  });

  it('routes annotate escape through dismiss instead of clearing toolbar state directly', () => {
    const callbacks = { onAnnotateDismiss: vi.fn() };
    const { toolbar, container, shell } = setup(callbacks);

    toolbar.setAnnotateActive(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(callbacks.onAnnotateDismiss).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#btn-annotate')?.classList.contains('active')).toBe(true);
    expect(shell.querySelector('#annotation-strip')?.classList.contains('visible')).toBe(true);
  });
});

describe('createToolbar record mode', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders a record button in the toolbar', () => {
    const { container } = setup();
    expect(container.querySelector('#btn-record')).not.toBeNull();
  });

  it('clicking record button shows the config bar banner', () => {
    const { container } = setup();
    (container.querySelector('#btn-record') as HTMLButtonElement).click();
    const banner = document.getElementById('instruction-banner');
    expect(banner?.classList.contains('visible')).toBe(true);
    expect(banner?.innerHTML).toContain('data-record-start');
  });

  it('clicking cancel in config bar hides the banner', () => {
    const { container } = setup();
    (container.querySelector('#btn-record') as HTMLButtonElement).click();
    const banner = document.getElementById('instruction-banner') as HTMLElement;
    (banner.querySelector('[data-record-cancel]') as HTMLButtonElement).click();
    expect(banner.classList.contains('visible')).toBe(false);
  });

  it('clicking Start fires onRecordStart with selected options', () => {
    const onRecordStart = vi.fn();
    const { container } = setup({ onRecordStart });
    (container.querySelector('#btn-record') as HTMLButtonElement).click();
    const banner = document.getElementById('instruction-banner') as HTMLElement;
    (banner.querySelector('[data-record-start]') as HTMLButtonElement).click();
    expect(onRecordStart).toHaveBeenCalledTimes(1);
    expect(onRecordStart).toHaveBeenCalledWith(
      expect.objectContaining({
        captureConsole: expect.any(Boolean),
        captureScroll: expect.any(Boolean),
        captureHover: expect.any(Boolean),
      }),
    );
  });

  it('setRecordActive(true) shows status bar and disables inspect/addElement', () => {
    const { container, toolbar } = setup();
    toolbar.setRecordActive(true);
    const banner = document.getElementById('instruction-banner') as HTMLElement;
    expect(banner.classList.contains('visible')).toBe(true);
    expect(banner.innerHTML).toContain('data-record-stop');
    expect((container.querySelector('#btn-inspect') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('#btn-add-element') as HTMLButtonElement).disabled).toBe(true);
  });

  it('setRecordActive(false) returns toolbar to idle and re-enables inspect/addElement', () => {
    const { container, toolbar } = setup();
    toolbar.setRecordActive(true);
    toolbar.setRecordActive(false);
    const banner = document.getElementById('instruction-banner') as HTMLElement;
    expect(banner.classList.contains('visible')).toBe(false);
    expect((container.querySelector('#btn-inspect') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('#btn-add-element') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ESC key does NOT fire onRecordStop when recording is active', () => {
    const onRecordStop = vi.fn();
    const { toolbar } = setup({ onRecordStop });
    toolbar.setRecordActive(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onRecordStop).not.toHaveBeenCalled();
  });

  it('clicking stop button fires onRecordStop', () => {
    const onRecordStop = vi.fn();
    const { toolbar } = setup({ onRecordStop });
    toolbar.setRecordActive(true);
    const banner = document.getElementById('instruction-banner') as HTMLElement;
    (banner.querySelector('[data-record-stop]') as HTMLButtonElement).click();
    expect(onRecordStop).toHaveBeenCalledTimes(1);
  });

  it('updateRecordingStatus updates banner event count', () => {
    const { toolbar } = setup();
    toolbar.setRecordActive(true);
    toolbar.updateRecordingStatus(7, 15);
    const banner = document.getElementById('instruction-banner') as HTMLElement;
    expect(banner.textContent).toContain('7 events');
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});
