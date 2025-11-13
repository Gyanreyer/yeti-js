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
    defaultBundleName: "global",
  },
  css: {
    minify: true,
    sourceMaps: false,
    outputDir: "/css",
    defaultBundleName: "global",
  },
  pageTemplateFileExtension: "page.js",
  quietMode: false,
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
  const merged = mergeConfigs(config, newConfig);
  return Object.assign(config, merged);
};

export const getConfig = () => config;