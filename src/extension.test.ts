import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  panelManagerInstance: {
    onMessage: vi.fn(),
    postMessage: vi.fn(),
    open: vi.fn(),
    dispose: vi.fn(),
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
  ContextExtractor: vi.fn(() => ({
    fromCapturedElement: vi.fn(),
    fromLogs: vi.fn(),
    fromScreenshot: vi.fn(),
  })),
}));

vi.mock('./adapters/ClipboardAdapter', () => ({
  ClipboardAdapter: vi.fn(() => ({
    isAvailable: vi.fn().mockResolvedValue(true),
    deliver: vi.fn(),
    name: 'clipboard',
  })),
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
});
