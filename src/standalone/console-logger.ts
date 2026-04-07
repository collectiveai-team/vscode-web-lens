export const webLensLogger = {
  info(message: string, metadata?: unknown): void {
    if (metadata !== undefined) {
      console.log(`[info] ${message}`, metadata);
    } else {
      console.log(`[info] ${message}`);
    }
  },

  warn(message: string, metadata?: unknown): void {
    if (metadata !== undefined) {
      console.warn(`[warn] ${message}`, metadata);
    } else {
      console.warn(`[warn] ${message}`);
    }
  },

  error(message: string, metadata?: unknown): void {
    if (metadata !== undefined) {
      console.error(`[error] ${message}`, metadata);
    } else {
      console.error(`[error] ${message}`);
    }
  },

  show(): void {},

  dispose(): void {},
};
