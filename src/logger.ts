export const logger = {
  step(message: string): void {
    console.log(`[step] ${message}`);
  },

  info(message: string): void {
    console.log(`[info] ${message}`);
  },

  warn(message: string): void {
    console.warn(`[warn] ${message}`);
  },

  error(message: string): void {
    console.error(`[error] ${message}`);
  },
};

