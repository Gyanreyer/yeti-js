/**
 * @import { RenderResult } from "../types";
 * @param {RenderResult | RenderResult[]} results
 */
export const flattenRenderResults = (results) => {
  if (!Array.isArray(results)) {
    return results;
  }

  /**
   * @type {RenderResult}
   */
  const flattenedResult = {
    cssBundles: {},
    cssDependencies: new Set(),
    jsBundles: {},
    jsDependencies: new Set(),
    htmlBundles: {},
    htmlDependencies: new Set(),
    html: "",
  };

  for (const result of results) {
    for (const bundleName in result.cssBundles) {
      flattenedResult.cssBundles[bundleName] ??= new Set();
      for (const bundleChunk of result.cssBundles[bundleName]) {
        flattenedResult.cssBundles[bundleName].add(bundleChunk);
      }
    }
    for (const bundleName in result.jsBundles) {
      flattenedResult.jsBundles[bundleName] ??= new Set();
      for (const bundleChunk of result.jsBundles[bundleName]) {
        flattenedResult.jsBundles[bundleName].add(bundleChunk);
      }
    }
    for (const bundleName in result.htmlBundles) {
      flattenedResult.htmlBundles[bundleName] ??= new Set();
      for (const bundleChunk of result.htmlBundles[bundleName]) {
        flattenedResult.htmlBundles[bundleName].add(bundleChunk);
      }
    }

    for (const dep of result.cssDependencies) {
      flattenedResult.cssDependencies.add(dep);
    }
    for (const dep of result.jsDependencies) {
      flattenedResult.jsDependencies.add(dep);
    }
    for (const dep of result.htmlDependencies) {
      flattenedResult.htmlDependencies.add(dep);
    }

    flattenedResult.html += result.html;
  }

  return flattenedResult;
};