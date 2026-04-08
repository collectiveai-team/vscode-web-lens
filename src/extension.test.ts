import { beforeEach, describe, expect, it, vi } from 'vitest';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushAsyncDelivery() {
  await Promise.resolve();
  await Promise.resolve();
}

const mockState = vi.hoisted(() => ({
  messageHandler: undefined as ((message: any) => void) | undefined,
  panelManagerInstance: {
    onMessage: vi.fn((handler: (message: any) => void) => {
      mockState.messageHandler = handler;
    }),
    postMessage: vi.fn(),
    open: vi.fn(),
    dispose: vi.fn(),
  },
  clipboardAdapter: {
    isAvailable: vi.fn().mockResolvedValue(true),
    deliver: vi.fn().mockResolvedValue({ success: true, message: 'Delivered context' }),
    name: 'clipboard',
  },
  contextExtractor: {
    fromCapturedElement: vi.fn(),
    fromLogs: vi.fn(),
    fromScreenshot: vi.fn(),
    fromAnnotation: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock('./panel/BrowserPanelManager', () => ({
  BrowserPanelManager: vi.fn(() => mockState.panelManagerInstance),
}));

vi.mock('./context/ContextExtractor', () => ({
  ContextExtractor: vi.fn(() => mockState.contextExtractor),
}));

vi.mock('./adapters/ClipboardAdapter', () => ({
  ClipboardAdapter: vi.fn(() => mockState.clipboardAdapter),
}));

vi.mock('./adapters/OpenCodeAdapter', () => ({
  OpenCodeAdapter: vi.fn(() => ({
    isAvailable: vi.fn().mockResolvedValue(false),
    deliver: vi.fn(),
    name: 'opencode',
  })),
}));

vi.mock('./adapters/OpenChamberAdapter', () => ({
  OpenChamberAdapter: vi.fn(() => ({
    isAvailable: vi.fn().mockResolvedValue(false),
    deliver: vi.fn(),
    name: 'openchamber',
  })),
}));

vi.mock('./adapters/CodexAdapter', () => ({
  CodexAdapter: vi.fn(() => ({
    isAvailable: vi.fn().mockResolvedValue(false),
    deliver: vi.fn(),
    name: 'codex',
  })),
}));

vi.mock('./adapters/ClaudeCodeAdapter', () => ({
  ClaudeCodeAdapter: vi.fn(() => ({
    isAvailable: vi.fn().mockResolvedValue(false),
    deliver: vi.fn(),
    name: 'claudecode',
  })),
}));

vi.mock('./logging', () => ({
  webLensLogger: mockState.logger,
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(() => 'clipboard'),
      update: vi.fn().mockResolvedValue(undefined),
    }),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },
  window: {
    onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: vi.fn() })),
    showInputBox: vi.fn(),
    registerWebviewPanelSerializer: vi.fn(() => ({ dispose: vi.fn() })),
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  },
  ConfigurationTarget: { Global: 1 },
  ColorThemeKind: {
    Light: 1,
    HighContrastLight: 4,
  },
}));

describe('activate', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockState.messageHandler = undefined;
    mockState.clipboardAdapter.deliver.mockResolvedValue({ success: true, message: 'Delivered context' });
  });

  it('logs the running extension version on activation', async () => {
    const { activate } = await import('./extension');

    activate({
      subscriptions: [],
      extensionUri: { fsPath: '/fake/extension' },
      extension: {
        id: 'collectiveai-team.web-lens',
        packageJSON: {
          displayName: 'Web Lens Debug',
          version: '0.2.1',
        },
      },
    } as any);

    expect(mockState.logger.info).toHaveBeenCalledWith('Extension activated', {
      displayName: 'Web Lens Debug',
      extensionId: 'collectiveai-team.web-lens',
      version: '0.2.1',
    });
  });

  it('delivers annotate:sendToChat messages through the annotation context path', async () => {
    const annotationBundle = {
      url: 'http://localhost:3000/annotated',
      timestamp: Date.now(),
      screenshot: { dataUrl: 'data:image/png;base64,abc', width: 10, height: 20 },
      annotation: 'Explain the highlighted issue.',
    };
    const delivery = deferred<{ success: boolean; message: string }>();
    mockState.contextExtractor.fromAnnotation.mockReturnValue(annotationBundle);
    mockState.clipboardAdapter.deliver.mockReturnValue(delivery.promise);

    const { activate } = await import('./extension');

    activate({
      subscriptions: [],
      extensionUri: { fsPath: '/fake/extension' },
      extension: {
        id: 'collectiveai-team.web-lens',
        packageJSON: {
          displayName: 'Web Lens Debug',
          version: '0.2.1',
        },
      },
      secrets: {},
    } as any);

    mockState.messageHandler?.({
      type: 'iframe:loaded',
      payload: { url: 'http://localhost:3000/annotated', title: 'Page', canInject: true },
    });
    mockState.messageHandler?.({
      type: 'annotate:sendToChat',
      payload: {
        imageDataUrl: 'data:image/png;base64,abc',
        prompt: 'Explain the highlighted issue.',
      },
    });

    expect(mockState.panelManagerInstance.postMessage).not.toHaveBeenCalledWith({
      type: 'toast',
      payload: {
        message: 'Delivered context',
        toastType: 'success',
      },
    });

    delivery.resolve({ success: true, message: 'Delivered context' });
    await flushAsyncDelivery();

    expect(mockState.contextExtractor.fromAnnotation).toHaveBeenCalledWith(
      'data:image/png;base64,abc',
      'Explain the highlighted issue.',
      'http://localhost:3000/annotated'
    );
    expect(mockState.clipboardAdapter.deliver).toHaveBeenCalledWith(annotationBundle);
    expect(mockState.panelManagerInstance.postMessage).toHaveBeenCalledWith({
      type: 'toast',
      payload: {
        message: 'Delivered context',
        toastType: 'success',
      },
    });
  });

  it('keeps the existing delivery routes for inspect, addElement, logs, and screenshot', async () => {
    const capturedBundle = { timestamp: Date.now(), url: 'http://localhost:3000/current' };
    const logsBundle = { timestamp: Date.now(), url: 'http://localhost:3000/current' };
    const screenshotBundle = { timestamp: Date.now(), url: 'http://localhost:3000/current' };
    mockState.contextExtractor.fromCapturedElement.mockReturnValue(capturedBundle);
    mockState.contextExtractor.fromLogs.mockReturnValue(logsBundle);
    mockState.contextExtractor.fromScreenshot.mockReturnValue(screenshotBundle);

    const { activate } = await import('./extension');

    activate({
      subscriptions: [],
      extensionUri: { fsPath: '/fake/extension' },
      extension: {
        id: 'collectiveai-team.web-lens',
        packageJSON: {
          displayName: 'Web Lens Debug',
          version: '0.2.1',
        },
      },
      secrets: {},
    } as any);

    const capturedPayload = {
      html: '<button>Click</button>',
      tag: 'button',
      classes: [],
      dimensions: { top: 0, left: 0, width: 10, height: 20 },
      accessibility: {},
      parentHtml: '<div><button>Click</button></div>',
      ancestorPath: 'body > div > button',
      screenshotDataUrl: '',
    };
    const logs = [{ level: 'error', message: 'boom', timestamp: 1 }];

    mockState.messageHandler?.({
      type: 'iframe:loaded',
      payload: { url: 'http://localhost:3000/current', title: 'Page', canInject: true },
    });
    mockState.messageHandler?.({ type: 'inspect:sendToChat', payload: capturedPayload });
    mockState.messageHandler?.({ type: 'addElement:captured', payload: capturedPayload });
    mockState.messageHandler?.({ type: 'action:addLogs', payload: { logs } });
    mockState.messageHandler?.({
      type: 'action:screenshot',
      payload: { dataUrl: 'data:image/png;base64,xyz' },
    });
    await flushAsyncDelivery();

    expect(mockState.contextExtractor.fromCapturedElement).toHaveBeenNthCalledWith(
      1,
      capturedPayload,
      'http://localhost:3000/current'
    );
    expect(mockState.contextExtractor.fromCapturedElement).toHaveBeenNthCalledWith(
      2,
      capturedPayload,
      'http://localhost:3000/current'
    );
    expect(mockState.contextExtractor.fromLogs).toHaveBeenCalledWith(logs, 'http://localhost:3000/current');
    expect(mockState.contextExtractor.fromScreenshot).toHaveBeenCalledWith(
      'data:image/png;base64,xyz',
      'http://localhost:3000/current'
    );
  });
});
