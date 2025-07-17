/**
 * Logger utility for development and production environments
 */
export class Logger {
  private static isDevelopment(): boolean {
    // Check if we're in development mode
    // In production build, this will be optimized away
    return process.env.NODE_ENV !== 'production';
  }

  static log(message: string, ...args: any[]): void {
    if (this.isDevelopment()) {
      console.log(`[Korean Grammar Assistant] ${message}`, ...args);
    }
  }

  static error(message: string, ...args: any[]): void {
    if (this.isDevelopment()) {
      console.error(`[Korean Grammar Assistant ERROR] ${message}`, ...args);
    }
  }

  static warn(message: string, ...args: any[]): void {
    if (this.isDevelopment()) {
      console.warn(`[Korean Grammar Assistant WARN] ${message}`, ...args);
    }
  }

  static debug(message: string, ...args: any[]): void {
    if (this.isDevelopment()) {
      console.debug(`[Korean Grammar Assistant DEBUG] ${message}`, ...args);
    }
  }
}