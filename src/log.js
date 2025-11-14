
import { styleText } from 'node:util';
import { getConfig } from "./config.js";

/**
 * @param  {...any} logValues
 */
export const log = (...logValues) => {
  const { quietMode } = getConfig();
  if (quietMode) { return; }

  console.log(styleText("gray", "[Yeti]"), ...logValues);
};

/**
 * @param  {...any} logValues
 */
export const logWarning = (...logValues) => {
  const { quietMode } = getConfig();
  if (quietMode) { return; }

  logWarning(styleText("gray", "[Yeti]"), ...logValues);
};

/**
 * @param  {...any} logValues
 */
export const logError = (...logValues) => {
  // Errors should always be shown, even in quiet mode
  console.error(styleText("gray", "[Yeti]"), ...logValues);
};