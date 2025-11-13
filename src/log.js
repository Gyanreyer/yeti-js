
import { styleText } from 'node:util';
import { getConfig } from "./config.js";

/**
 * @param  {...string} logStrings
 */
export const log = (...logStrings) => {
  const { quietMode } = getConfig();
  if (quietMode) { return; }

  console.log(styleText("gray", "[Yeti]"), ...logStrings);
};