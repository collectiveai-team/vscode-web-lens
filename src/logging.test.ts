import { beforeEach, describe, expect, it, vi } from 'vitest';

const appendLine = vi.fn();
const show = vi.fn();
const dispose = vi.fn();
const createOutputChannel = vi.fn(() => ({
  appendLine,
  show,
  dispose,
}));

vi.mock('vscode', () => ({
  window: {
    createOutputChannel,
  },
}));

describe('webLensLogger', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('creates the output channel lazily and reuses it', async () => {
    const { webLensLogger } = await import('./logging');

    webLensLogger.info('first message');
    webLensLogger.info('second message');

    expect(createOutputChannel).toHaveBeenCalledTimes(1);
    expect(createOutputChannel).toHaveBeenCalledWith('Web Lens Debug');
    expect(appendLine).toHaveBeenCalledTimes(2);
  });

  it('formats structured metadata in log output', async () => {
    const { webLensLogger } = await import('./logging');

    webLensLogger.warn('proxy request failed', {
      url: 'http://localhost:3000',
      statusCode: 502,
    });

    expect(appendLine).toHaveBeenCalledTimes(1);
    expect(appendLine.mock.calls[0][0]).toContain('[warn] proxy request failed');
    expect(appendLine.mock.calls[0][0]).toContain('"url":"http://localhost:3000"');
    expect(appendLine.mock.calls[0][0]).toContain('"statusCode":502');
  });

  it('shows the output channel on demand', async () => {
    const { webLensLogger } = await import('./logging');

    webLensLogger.show();

    expect(show).toHaveBeenCalledTimes(1);
  });
});
