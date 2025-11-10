/**
 * @import { YetiConfig } from './types';
 */

/**
 * @type {YetiConfig}
 */
const config = {
  inputDir: "",
  outputDir: "",
  js: {
    minify: true,
    sourceMaps: false,
    outputDir: "/js",
  },
  css: {
    minify: true,
    sourceMaps: false,
    outputDir: "/css",
  },
  pageTemplateFileExtension: "page.js",
};

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isObject = (value) => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @template {Record<string, any>} T
 * @param {T} baseConfig
 * @param {Partial<T>} newConfig
 * @returns {T}
 */
const mergeConfigs = (baseConfig, newConfig) => {
  const mergedConfig = { ...baseConfig };
  for (const key in newConfig) {
    /**
     * @type {any}
     */
    const newValue = newConfig[key];
    const baseValue = baseConfig[key];
    if (isObject(newValue) && isObject(baseValue)) {
      mergedConfig[key] = mergeConfigs(baseValue, /** @type {any} */(newValue));
    } else {
      mergedConfig[key] = newValue;
    }
  }
  return mergedConfig;
};

/**
 * @param {Partial<YetiConfig>} newConfig
 */
export const updateConfig = (newConfig) => {
  return mergeConfigs(config, newConfig);
};

export const getConfig = () => config;