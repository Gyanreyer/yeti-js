/**
 * @typedef {Object} YetiConfig
 * @property {string} inputDir - The directory where the source files are located. Defaults to "./src".
 * @property {string} outputDir - The directory where the built files will be output. Defaults to "./_site".
 * @property {boolean} [minify=true] - Whether to minify the output HTML, CSS, and JS. Defaults to false.
 */

/**
 * @type {YetiConfig}
 */
const config = {
  inputDir: "",
  outputDir: "",
  minify: false,
};

/**
 * @param {Partial<YetiConfig>} newConfig
 */
export const updateConfig = (newConfig) => {
  Object.assign(config, newConfig);
};

export const getConfig = () => config;