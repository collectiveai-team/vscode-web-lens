// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordOptions } from '../types';
import type { AnnotationTool } from './annotation-overlay';
import { createAnnotationOverlay } from './annotation-overlay';

type ToolbarCallbacks = {
  onLogsRequest?: () => void;
  onScreenshotRequest?: () => void;
  onBackendRequest?: () => void;
  onBackendSelect?: (backend: string) => void;
  onAnnotateTool?: (tool: AnnotationTool | 'select') => void;
  onAnnotateColor?: (color: string) => void;
  onAnnotateUndo?: () => void;
  onAnnotateRedo?: () => void;
  onAnnotateDelete?: () => void;
  onAnnotateClear?: () => void;
  onAnnotateSend?: (prompt: string) => void;
  onAnnotateDismiss?: () => void;
  onRecordStart?: (opts: RecordOptions) => void;
  onRecordStop?: () => void;
};

type ToolbarState = {
  inspectActive: boolean;
  addElementActive: boolean;
  annotateActive: boolean;
  recordPending?: boolean;
  recordActive?: boolean;
};

const postMessage = vi.fn();
const setState = vi.fn();
const toolbarApi = {
  setUrl: vi.fn(),
  setInspectActive: vi.fn(),
  setAddElementActive: vi.fn(),
  setAnnotateActive: vi.fn(),
  setAnnotateDeleteEnabled: vi.fn(),
  setBackendState: vi.fn(),
  setStorageDataState: vi.fn(),
  setRecordActive: vi.fn(),
  setRecordOptions: vi.fn(),
  updateRecordingStatus: vi.fn(),
  onStateChange: vi.fn<(cb: (state: ToolbarState) => void) => void>(),
};
const inspectOverlay = {
  setMode: vi.fn(),
  cleanup: vi.fn(),
  requestScreenshot: vi.fn<() => Promise<string>>(),
  startRecord: vi.fn(),
};
const annotationOverlay = {
  setActive: vi.fn(),
  setTool: vi.fn(),
  setColor: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  deleteSelection: vi.fn(() => false),
  clear: vi.fn(),
  hasShapes: vi.fn(),
  composite: vi.fn<() => Promise<string>>(),
  destroy: vi.fn(),
};
const consoleEntries: { level: 'log' | 'warn' | 'error'; message: string; timestamp: number }[] = [];
const consoleReceiver = {
  getEntries: vi.fn(() => [...consoleEntries]),
};

let toolbarCallbacks: ToolbarCallbacks | undefined;
let stateChangeHandler: ((state: ToolbarState) => void) | undefined;
let selectionChangeHandler: ((hasSelection: boolean) => void) | undefined;

vi.mock('./toolbar', () => ({
  createToolbar: vi.fn((_container: HTMLElement, _postMessage: unknown, callbacks?: ToolbarCallbacks) => {
    toolbarCallbacks = callbacks;
    toolbarApi.onStateChange.mockImplementation((cb) => {
      stateChangeHandler = cb;
    });
    return toolbarApi;
  }),
}));

vi.mock('./inspect-overlay', () => ({
  createInspectOverlay: vi.fn(() => inspectOverlay),
}));

vi.mock('./annotation-overlay', () => ({
  createAnnotationOverlay: vi.fn((_iframe: HTMLIFrameElement, options?: { onSelectionChange?: (hasSelection: boolean) => void }) => {
    selectionChangeHandler = options?.onSelectionChange;
    return annotationOverlay;
  }),
}));

vi.mock('./console-capture', () => ({
  createConsoleReceiver: vi.fn((onEntry: (entry: { level: 'log' | 'warn' | 'error'; message: string; timestamp: number }) => void) => {
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'bc:console' && event.data?.payload) {
        const entry = event.data.payload;
        consoleEntries.push(entry);
        onEntry(entry);
      }
    });
    return consoleReceiver;
  }),
}));

function postWindowMessage(data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

describe('webview main annotation + record wiring', () => {
  beforeAll(async () => {
    document.body.innerHTML = `
      <div id="toolbar"></div>
      <div id="browser-frame"><iframe id="browser-iframe"></iframe></div>
    `;
    document.body.dataset.targetOrigin = 'https://example.com';
    Object.assign(globalThis, {
      acquireVsCodeApi: () => ({ postMessage, getState: vi.fn(), setState }),
    });

    await import('./main');
  });

  beforeEach(() => {
    postMessage.mockClear();
    setState.mockClear();
    toolbarApi.setUrl.mockClear();
    toolbarApi.setInspectActive.mockClear();
    toolbarApi.setAddElementActive.mockClear();
    toolbarApi.setAnnotateActive.mockClear();
    toolbarApi.setAnnotateDeleteEnabled.mockClear();
    toolbarApi.setBackendState.mockClear();
    toolbarApi.setStorageDataState.mockClear();
    toolbarApi.setRecordActive.mockClear();
    toolbarApi.setRecordOptions.mockClear();
    toolbarApi.updateRecordingStatus.mockClear();
    inspectOverlay.setMode.mockClear();
    inspectOverlay.cleanup.mockClear();
    inspectOverlay.requestScreenshot.mockReset();
    inspectOverlay.startRecord.mockClear();
    annotationOverlay.setActive.mockClear();
    annotationOverlay.setTool.mockClear();
    annotationOverlay.setColor.mockClear();
    annotationOverlay.undo.mockClear();
    annotationOverlay.redo.mockClear();
    annotationOverlay.deleteSelection.mockClear();
    annotationOverlay.clear.mockReset();
    annotationOverlay.hasShapes.mockReset();
    annotationOverlay.composite.mockReset();
    annotationOverlay.destroy.mockClear();
    consoleEntries.length = 0;
  });

  it('activates annotation overlay and disables inspect overlay in annotate mode', () => {
    expect(createAnnotationOverlay).toHaveBeenCalledWith(
      document.getElementById('browser-iframe'),
      expect.objectContaining({ onSelectionChange: expect.any(Function) }),
    );

    stateChangeHandler?.({ inspectActive: true, addElementActive: false, annotateActive: false });
    stateChangeHandler?.({ inspectActive: false, addElementActive: false, annotateActive: true });

    expect(inspectOverlay.setMode).toHaveBeenNthCalledWith(1, 'inspect');
    expect(annotationOverlay.setActive).toHaveBeenNthCalledWith(1, false);
    expect(inspectOverlay.setMode).toHaveBeenNthCalledWith(2, 'off');
    expect(annotationOverlay.setActive).toHaveBeenNthCalledWith(2, true);
  });

  it('routes select tool callback to annotation overlay', () => {
    toolbarCallbacks?.onAnnotateTool?.('select');
    expect(annotationOverlay.setTool).toHaveBeenCalledWith('select');
  });

  it('updates toolbar delete enabled state when annotation selection changes', () => {
    expect(selectionChangeHandler).toBeTypeOf('function');

    selectionChangeHandler?.(true);
    selectionChangeHandler?.(false);

    expect(toolbarApi.setAnnotateDeleteEnabled).toHaveBeenNthCalledWith(1, true);
    expect(toolbarApi.setAnnotateDeleteEnabled).toHaveBeenNthCalledWith(2, false);
  });

  it('routes annotate redo and delete callbacks to annotation overlay', () => {
    toolbarCallbacks?.onAnnotateRedo?.();
    toolbarCallbacks?.onAnnotateDelete?.();

    expect(annotationOverlay.redo).toHaveBeenCalledTimes(1);
    expect(annotationOverlay.deleteSelection).toHaveBeenCalledTimes(1);
  });

  it('sends annotated screenshot to chat and deactivates annotate mode', async () => {
    inspectOverlay.requestScreenshot.mockResolvedValue('data:image/png;base64,raw-shot');
    annotationOverlay.composite.mockResolvedValue('data:image/png;base64,annotated-shot');

    await toolbarCallbacks?.onAnnotateSend?.('Explain the bug');
    await Promise.resolve();

    expect(inspectOverlay.requestScreenshot).toHaveBeenCalledTimes(1);
    expect(annotationOverlay.composite).toHaveBeenCalledWith('data:image/png;base64,raw-shot');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'annotate:sendToChat',
      payload: {
        imageDataUrl: 'data:image/png;base64,annotated-shot',
        prompt: 'Explain the bug',
      },
    });
    expect(annotationOverlay.clear).toHaveBeenCalledTimes(1);
    expect(toolbarApi.setAnnotateActive).toHaveBeenCalledWith(false);
  });

  it('uses recording:initOptions when mode:record starts', () => {
    const opts: RecordOptions = {
      captureConsole: true,
      captureScroll: true,
      captureHover: false,
    };

    postWindowMessage({ type: 'recording:initOptions', payload: opts });
    postWindowMessage({ type: 'mode:record', payload: { enabled: true } });

    expect(toolbarApi.setRecordOptions).toHaveBeenCalledWith(opts);
    expect(inspectOverlay.startRecord).toHaveBeenCalledWith(opts);
    expect(postMessage).toHaveBeenCalledWith({ type: 'recording:start', payload: opts });
  });

  it('stops record flow on mode:record disable when active by host', () => {
    postWindowMessage({ type: 'recording:started' });
    postWindowMessage({ type: 'mode:record', payload: { enabled: false } });

    expect(inspectOverlay.setMode).toHaveBeenCalledWith('off');
    expect(postMessage).toHaveBeenCalledWith({ type: 'recording:stop' });
  });

  it('re-arms record listeners after bc:navigated while recording is active', () => {
    const opts: RecordOptions = {
      captureConsole: false,
      captureScroll: true,
      captureHover: true,
    };

    postWindowMessage({ type: 'recording:initOptions', payload: opts });
    postWindowMessage({ type: 'recording:started' });
    inspectOverlay.startRecord.mockClear();

    postWindowMessage({ type: 'bc:navigated', payload: { url: 'https://example.com/next' } });

    expect(inspectOverlay.startRecord).toHaveBeenCalledWith(opts);
  });

  it('relays bc:recordEvent and updates recording status', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);

    postWindowMessage({ type: 'recording:started' });
    nowSpy.mockReturnValue(2500);

    const payload = {
      type: 'click',
      timestamp: 123,
      selector: '#save',
      selectorType: 'id',
      text: 'Save',
      position: { x: 1, y: 2 },
    };

    postWindowMessage({ type: 'bc:recordEvent', payload });

    expect(postMessage).toHaveBeenCalledWith({ type: 'recording:event', payload });
    expect(toolbarApi.updateRecordingStatus).toHaveBeenCalledWith(1, 1);
  });

  it('forwards bc:console to recording:event and keeps console diagnostics flow', () => {
    const opts: RecordOptions = {
      captureConsole: true,
      captureScroll: false,
      captureHover: false,
    };

    postWindowMessage({ type: 'recording:initOptions', payload: opts });
    postWindowMessage({ type: 'recording:started' });

    postWindowMessage({
      type: 'bc:console',
      payload: {
        level: 'warn',
        message: 'watch out',
        timestamp: 222,
      },
    });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'recording:event',
      payload: {
        type: 'console',
        timestamp: 222,
        level: 'warn',
        message: 'watch out',
      },
    });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'diagnostic:log',
      payload: {
        source: 'page.console',
        level: 'warn',
        message: 'watch out',
        details: undefined,
      },
    });
  });
});
