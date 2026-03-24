export function decideInjectInitialization(input: {
  alreadyInjected: boolean;
  frameElementPresent: boolean;
}): {
  shouldInitialize: boolean;
  reason?: 'already-injected' | 'nested-frame';
} {
  if (input.alreadyInjected) {
    return { shouldInitialize: false, reason: 'already-injected' };
  }

  if (input.frameElementPresent) {
    return { shouldInitialize: false, reason: 'nested-frame' };
  }

  return { shouldInitialize: true };
}
