import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createConsoleCapture } from './console-capture';

describe('createConsoleCapture', () => {
  let mockConsole: { log: any; warn: any; error: any };
  let capture: ReturnType<typeof createConsoleCapture>;

  beforeEach(() => {
    mockConsole = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    capture = createConsoleCapture(mockConsole as any);
  });

  it('captures log entries', () => {
    mockConsole.log('hello', 'world');
    const entries = capture.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('log');
    expect(entries[0].message).toBe('hello world');
  });

  it('captures warn and error entries', () => {
    mockConsole.warn('warning');
    mockConsole.error('error');
    const entries = capture.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].level).toBe('warn');
    expect(entries[1].level).toBe('error');
  });

  it('respects max entries limit', () => {
    for (let i = 0; i < 250; i++) {
      mockConsole.log(`msg ${i}`);
    }
    const entries = capture.getEntries();
    expect(entries.length).toBeLessThanOrEqual(200);
    // Oldest entries evicted
    expect(entries[0].message).toBe('msg 50');
  });

  it('clears buffer', () => {
    mockConsole.log('test');
    capture.clear();
    expect(capture.getEntries()).toHaveLength(0);
  });

  it('still calls original console methods', () => {
    // The original vi.fn() is stored before createConsoleCapture wraps it.
    // createConsoleCapture calls .bind() on the original, so calling the
    // wrapper invokes the bound copy which in turn calls the underlying mock.
    // We verify by checking the mock was called via the spy's mock.calls.
    const origLog = vi.fn();
    mockConsole = { log: origLog, warn: vi.fn(), error: vi.fn() };
    capture = createConsoleCapture(mockConsole as any);

    mockConsole.log('test');
    expect(origLog.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
