import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConsoleCapture, createConsoleReceiver } from './console-capture';

type MockWindow = EventTarget & {
  addEventListener: typeof globalThis.addEventListener;
  removeEventListener: typeof globalThis.removeEventListener;
  dispatchEvent: typeof globalThis.dispatchEvent;
};

let mockWindow: MockWindow;

function postConsoleMessage(level: 'log' | 'warn' | 'error', message: string, timestamp = 123) {
  mockWindow.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'bc:console',
        payload: { level, message, timestamp },
      },
    })
  );
}

describe('createConsoleReceiver', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockWindow = new EventTarget() as MockWindow;
    vi.stubGlobal('window', mockWindow);
  });

  it('captures console entries from bc:console messages', () => {
    const receiver = createConsoleReceiver();

    postConsoleMessage('log', 'hello world');

    expect(receiver.getEntries()).toEqual([
      { level: 'log', message: 'hello world', timestamp: 123 },
    ]);

    receiver.detach();
  });

  it('captures warn and error entries', () => {
    const receiver = createConsoleReceiver();

    postConsoleMessage('warn', 'warning', 1);
    postConsoleMessage('error', 'boom', 2);

    expect(receiver.getEntries()).toEqual([
      { level: 'warn', message: 'warning', timestamp: 1 },
      { level: 'error', message: 'boom', timestamp: 2 },
    ]);

    receiver.detach();
  });

  it('ignores non-console messages', () => {
    const receiver = createConsoleReceiver();

    mockWindow.dispatchEvent(new MessageEvent('message', { data: { type: 'bc:navigated' } }));

    expect(receiver.getEntries()).toHaveLength(0);

    receiver.detach();
  });

  it('respects max entries limit', () => {
    const receiver = createConsoleReceiver();

    for (let i = 0; i < 250; i++) {
      postConsoleMessage('log', `msg ${i}`, i);
    }

    const entries = receiver.getEntries();
    expect(entries.length).toBeLessThanOrEqual(200);
    expect(entries[0].message).toBe('msg 50');

    receiver.detach();
  });

  it('clears buffer', () => {
    const receiver = createConsoleReceiver();

    postConsoleMessage('log', 'test');
    receiver.clear();

    expect(receiver.getEntries()).toHaveLength(0);

    receiver.detach();
  });

  it('notifies listeners when a new entry is received', () => {
    const onEntry = vi.fn();
    const receiver = createConsoleReceiver(onEntry);

    postConsoleMessage('error', 'boom', 456);

    expect(onEntry).toHaveBeenCalledTimes(1);
    expect(onEntry).toHaveBeenCalledWith({
      level: 'error',
      message: 'boom',
      timestamp: 456,
    });

    receiver.detach();
  });

  it('detaches the message listener', () => {
    const receiver = createConsoleReceiver();

    receiver.detach();
    postConsoleMessage('log', 'after detach');

    expect(receiver.getEntries()).toHaveLength(0);
  });

  it('keeps temporary createConsoleCapture compatibility wrapper working', () => {
    const legacyConsole = { log() {}, warn() {}, error() {} };
    const onEntry = vi.fn();
    const receiver = createConsoleCapture(legacyConsole, onEntry);

    postConsoleMessage('warn', 'legacy path', 999);

    expect(receiver.getEntries()).toEqual([
      { level: 'warn', message: 'legacy path', timestamp: 999 },
    ]);
    expect(onEntry).toHaveBeenCalledWith({
      level: 'warn',
      message: 'legacy path',
      timestamp: 999,
    });

    receiver.detach();
  });
});
