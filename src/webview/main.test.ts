// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationTool } from './annotation-overlay';
import { createAnnotationOverlay } from './annotation-overlay';

type ToolbarCallbacks = {
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
};

type ToolbarState = {
  inspectActive: boolean;
  addElementActive: boolean;
  annotateActive: boolean;
};

const postMessage = vi.fn();
const setState = vi.fn();
const toolbarApi = {
  setUrl: vi.fn(),
  setInspectActive: vi.fn(),
  setAddElementActive: vi.fn(),
  setAnnotateActive: vi.fn(),
  setBackendState: vi.fn(),
  setStorageDataState: vi.fn(),
  onStateChange: vi.fn<(cb: (state: ToolbarState) => void) => void>(),
};
const inspectOverlay = {
  setMode: vi.fn(),
  cleanup: vi.fn(),
  requestScreenshot: vi.fn<() => Promise<string>>(),
};
const annotationOverlay = {
  setActive: vi.fn(),
  setTool: vi.fn(),
  setColor: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  clear: vi.fn(),
  hasShapes: vi.fn(),
  composite: vi.fn<() => Promise<string>>(),
  destroy: vi.fn(),
};
const consoleReceiver = {
  getEntries: vi.fn(() => []),
};

let toolbarCallbacks: ToolbarCallbacks | undefined;
let stateChangeHandler: ((state: ToolbarState) => void) | undefined;

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
  createAnnotationOverlay: vi.fn(() => annotationOverlay),
}));

vi.mock('./console-capture', () => ({
  createConsoleReceiver: vi.fn(() => consoleReceiver),
}));

describe('webview main annotation wiring', () => {
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
    toolbarApi.setBackendState.mockClear();
    toolbarApi.setStorageDataState.mockClear();
    inspectOverlay.setMode.mockClear();
    inspectOverlay.cleanup.mockClear();
    inspectOverlay.requestScreenshot.mockReset();
    annotationOverlay.setActive.mockClear();
    annotationOverlay.setTool.mockClear();
    annotationOverlay.setColor.mockClear();
    annotationOverlay.undo.mockClear();
    annotationOverlay.redo.mockClear();
    annotationOverlay.clear.mockReset();
    annotationOverlay.hasShapes.mockReset();
    annotationOverlay.composite.mockReset();
    annotationOverlay.destroy.mockClear();
  });

  it('activates annotation overlay and disables inspect overlay in annotate mode', () => {
    expect(createAnnotationOverlay).toHaveBeenCalledWith(document.getElementById('browser-iframe'));

    stateChangeHandler?.({ inspectActive: true, addElementActive: false, annotateActive: false });
    stateChangeHandler?.({ inspectActive: false, addElementActive: false, annotateActive: true });

    expect(inspectOverlay.setMode).toHaveBeenNthCalledWith(1, 'inspect');
    expect(annotationOverlay.setActive).toHaveBeenNthCalledWith(1, false);
    expect(inspectOverlay.setMode).toHaveBeenNthCalledWith(2, 'off');
    expect(annotationOverlay.setActive).toHaveBeenNthCalledWith(2, true);
  });

  it('requests a screenshot, composites annotations, posts to chat, clears, and deactivates annotate mode', async () => {
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

  it('asks for confirmation before dismissing when annotations exist and keeps annotate mode active on reject', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    annotationOverlay.hasShapes.mockReturnValue(true);

    toolbarCallbacks?.onAnnotateDismiss?.();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(annotationOverlay.clear).not.toHaveBeenCalled();
    expect(toolbarApi.setAnnotateActive).not.toHaveBeenCalled();
  });

  it('clears and deactivates annotate mode when dismiss confirmation is accepted', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    annotationOverlay.hasShapes.mockReturnValue(true);

    toolbarCallbacks?.onAnnotateDismiss?.();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(annotationOverlay.clear).toHaveBeenCalledTimes(1);
    expect(toolbarApi.setAnnotateActive).toHaveBeenCalledWith(false);
  });
});
