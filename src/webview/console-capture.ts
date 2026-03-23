import type { ConsoleEntry } from '../types';

const MAX_ENTRIES = 200;
const MAX_BUFFER_SIZE = 50000; // ~50KB

export function createConsoleCapture(console: Console, onEntry?: (entry: ConsoleEntry) => void) {
  const buffer: ConsoleEntry[] = [];
  let bufferSize = 0;

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  function addEntry(level: ConsoleEntry['level'], args: any[]) {
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

    onEntry?.(entry);

    // Evict oldest entries if over limits
    while (buffer.length > MAX_ENTRIES || bufferSize > MAX_BUFFER_SIZE) {
      const removed = buffer.shift();
      if (removed) {
        bufferSize -= removed.message.length;
      }
    }
  }

  // Proxy console methods
  console.log = (...args: any[]) => {
    addEntry('log', args);
    originalLog(...args);
  };

  console.warn = (...args: any[]) => {
    addEntry('warn', args);
    originalWarn(...args);
  };

  console.error = (...args: any[]) => {
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
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}
