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
  const legacyConsole = arguments[0];
  const legacyOnEntry = arguments[1];

  if (
    legacyConsole &&
    typeof legacyConsole === 'object' &&
    typeof legacyConsole.log === 'function' &&
    typeof legacyConsole.warn === 'function' &&
    typeof legacyConsole.error === 'function'
  ) {
    const buffer: ConsoleEntry[] = [];
    let bufferSize = 0;
    const consoleLike = legacyConsole as Console;
    const handleEntry = typeof legacyOnEntry === 'function' ? legacyOnEntry : undefined;

    const originalLog = consoleLike.log.bind(consoleLike);
    const originalWarn = consoleLike.warn.bind(consoleLike);
    const originalError = consoleLike.error.bind(consoleLike);

    function addEntry(level: ConsoleEntry['level'], args: unknown[]) {
      const message = args
        .map((arg) => {
          if (typeof arg === 'string') return arg;
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' ');

      const entry: ConsoleEntry = {
        level,
        message,
        timestamp: Date.now(),
      };

      buffer.push(entry);
      bufferSize += message.length;

      handleEntry?.(entry);

      while (buffer.length > MAX_ENTRIES || bufferSize > MAX_BUFFER_SIZE) {
        const removed = buffer.shift();
        if (removed) {
          bufferSize -= removed.message.length;
        }
      }
    }

    consoleLike.log = (...args: unknown[]) => {
      addEntry('log', args);
      originalLog(...args);
    };

    consoleLike.warn = (...args: unknown[]) => {
      addEntry('warn', args);
      originalWarn(...args);
    };

    consoleLike.error = (...args: unknown[]) => {
      addEntry('error', args);
      originalError(...args);
    };

    return {
      getEntries(): ConsoleEntry[] {
        return [...buffer];
      },

      clear() {
        buffer.length = 0;
        bufferSize = 0;
      },

      detach() {
        consoleLike.log = originalLog;
        consoleLike.warn = originalWarn;
        consoleLike.error = originalError;
      },
    };
  }

  const handleEntry = typeof onEntry === 'function' ? onEntry : undefined;
  const buffer: ConsoleEntry[] = [];
  let bufferSize = 0;

  function handleMessage(event: MessageEvent) {
    const data = event.data;
    if (!data || data.type !== 'bc:console' || !data.payload) return;

    const entry: ConsoleEntry = {
      level: data.payload.level === 'log' ? 'log' : data.payload.level === 'warn' ? 'warn' : 'error',
      message: data.payload.message || '',
      timestamp: data.payload.timestamp || Date.now(),
    };

    buffer.push(entry);
    bufferSize += entry.message.length;

    handleEntry?.(entry);

    while (buffer.length > MAX_ENTRIES || bufferSize > MAX_BUFFER_SIZE) {
      const removed = buffer.shift();
      if (removed) {
        bufferSize -= removed.message.length;
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('message', handleMessage);
  }

  return {
    getEntries(): ConsoleEntry[] {
      return [...buffer];
    },

    clear() {
      buffer.length = 0;
      bufferSize = 0;
    },

    detach() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('message', handleMessage);
      }
    },
  };
}

/** @deprecated Use createConsoleReceiver instead. Temporary alias for backwards compatibility. */
export const createConsoleCapture = createConsoleReceiver as any;
