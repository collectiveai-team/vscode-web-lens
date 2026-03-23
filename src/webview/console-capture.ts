import type { ConsoleEntry } from '../types';

const MAX_ENTRIES = 200;
const MAX_BUFFER_SIZE = 50000; // ~50KB

/**
 * Console capture receiver - listens for bc:console postMessages from the
 * inject script and buffers entries for the "Add Logs to Chat" flow.
 *
 * The actual console monkey-patching now lives in inject.ts (inside the iframe).
 * This module runs in the webview and receives forwarded entries.
 */
export function createConsoleReceiver(onEntry?: (entry: ConsoleEntry) => void) {
  const buffer: ConsoleEntry[] = [];
  let bufferSize = 0;

  function handleMessage(event: MessageEvent) {
    const data = event.data;
    if (!data || data.type !== 'bc:console' || !data.payload) return;

    const entry: ConsoleEntry = {
      level: data.payload.level === 'log' ? 'log' : data.payload.level === 'warn' ? 'warn' : 'error',
      message: data.payload.message || '',
      timestamp: data.payload.timestamp ?? Date.now(),
    };

    buffer.push(entry);
    bufferSize += entry.message.length;

    onEntry?.(entry);

    while (buffer.length > MAX_ENTRIES || bufferSize > MAX_BUFFER_SIZE) {
      const removed = buffer.shift();
      if (removed) {
        bufferSize -= removed.message.length;
      }
    }
  }

  window.addEventListener('message', handleMessage);

  return {
    getEntries(): ConsoleEntry[] {
      return [...buffer];
    },

    clear() {
      buffer.length = 0;
      bufferSize = 0;
    },

    detach() {
      window.removeEventListener('message', handleMessage);
    },
  };
}

/** @deprecated Use createConsoleReceiver instead. Temporary alias for backwards compatibility. */
export function createConsoleCapture(_legacyConsole?: unknown, onEntry?: (entry: ConsoleEntry) => void) {
  return createConsoleReceiver(onEntry);
}
