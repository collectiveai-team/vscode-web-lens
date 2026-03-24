import { describe, expect, it } from 'vitest';
import { decideInjectInitialization } from './injectGuard';

describe('decideInjectInitialization', () => {
  it('initializes in the main proxied page when no frameElement is accessible', () => {
    expect(decideInjectInitialization({ alreadyInjected: false, frameElementPresent: false })).toEqual({
      shouldInitialize: true,
    });
  });

  it('skips initialization when already injected', () => {
    expect(decideInjectInitialization({ alreadyInjected: true, frameElementPresent: false })).toEqual({
      shouldInitialize: false,
      reason: 'already-injected',
    });
  });

  it('skips initialization inside nested iframes with an accessible frameElement', () => {
    expect(decideInjectInitialization({ alreadyInjected: false, frameElementPresent: true })).toEqual({
      shouldInitialize: false,
      reason: 'nested-frame',
    });
  });
});
