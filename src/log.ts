
import { styleText } from 'node:util';
import { getConfig } from "./config.ts";

/**
 * Log a message to the console, prefixed with a gray "[Yeti]" tag. Respects quiet mode.
 */
export const log = (...logValues: any[]) => {
  if (getConfig().quietMode) {
    return;
  }

  console.log(styleText("gray", "[Yeti]"), ...logValues);
};

/**
 * Log a warning message to the console, prefixed with a gray "[Yeti]" tag. Respects quiet mode.
 */
export const logWarning = (...logValues: any[]) => {
  if (getConfig().quietMode) {
    return;
  }

  console.warn(styleText("gray", "[Yeti]"), ...logValues);
};

/**
 * Log an error message to the console, prefixed with a gray "[Yeti]" tag. Errors are always shown, even in quiet mode.
 */
export const logError = (...logValues: any[]) => {
  // Errors should always be shown, even in quiet mode
  console.error(styleText("gray", "[Yeti]"), ...logValues);
};