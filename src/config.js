/**
 * @typedef {Object} YetiConfig
 * @property {string} inputDir - The directory where the source files are located. Defaults to "./src".
 * @property {string} outputDir - The directory where the built files will be output. Defaults to "./_site".
 * @property {boolean} minify - Whether to minify the output CSS and JS. Defaults to true.
 * @property {string} pageTemplateFileExtension - The file extension used for page templates. Defaults to "page.js".
 */

/**
 * @type {YetiConfig}
 */
const config = {
  inputDir: "",
  outputDir: "",
  minify: true,
  pageTemplateFileExtension: "page.js",
};

/**
 * @param {Partial<YetiConfig>} newConfig
 */
export const updateConfig = (newConfig) => {
  return Object.assign(config, newConfig);
};

export const getConfig = () => config;