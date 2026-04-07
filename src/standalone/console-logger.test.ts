import { afterEach, describe, expect, it, vi } from 'vitest';
import { webLensLogger } from './console-logger';

describe('console-logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('info() delegates to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const metadata = { x: 1 };

    webLensLogger.info('hello', metadata);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('[info] hello', metadata);
  });

  it('warn() delegates to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    webLensLogger.warn('oops');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('[warn] oops');
  });

  it('error() delegates to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const metadata = new Error('test');

    webLensLogger.error('boom', metadata);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('[error] boom', metadata);
  });

  it('show() does not throw', () => {
    expect(() => webLensLogger.show()).not.toThrow();
  });

  it('dispose() does not throw', () => {
    expect(() => webLensLogger.dispose()).not.toThrow();
  });
});
