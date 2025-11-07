/**
 * @import { RenderResult,  EleventyPageData, YetiPageComponent } from './types';
 */

/**
 * Takes a component and its props, and returns the rendered HTML string along with its CSS and JS dependencies and bundles.
 * You should use this instead of directly calling the component function to ensure that
 * the component's bundled CSS and JS get merged into the render result correctly.
 *
 * @template {Record<string, any>} TProps
 * @param {YetiPageComponent<TProps>} component
 * @param {EleventyPageData & TProps} props
 *
 * @returns {Promise<RenderResult>}
 */
export async function renderPageComponent(component, props) {
  // Merge in any component-level CSS/JS; the render result returned by the component only has CSS/JS from its children
  const componentCSS = component.css?.();
  const componentJS = component.js?.();

  /**
   * @type {RenderResult}
   */
  const mergedResult = {
    cssBundles: {},
    cssDependencies: componentCSS?.cssDependencies ?? new Set(),
    jsBundles: {},
    jsDependencies: componentJS?.jsDependencies ?? new Set(),
    html: "",
    htmlDependencies: new Set(),
  }

  if (componentCSS) {
    for (const bundleName in componentCSS.cssBundles) {
      mergedResult.cssBundles[bundleName] ??= new Set();
      mergedResult.cssBundles[bundleName].add(componentCSS.cssBundles[bundleName]);
    }
  }
  if (componentJS) {
    for (const bundleName in componentJS.jsBundles) {
      mergedResult.jsBundles[bundleName] ??= new Set();
      mergedResult.jsBundles[bundleName].add(componentJS.jsBundles[bundleName]);
    }
  }

  const result = await component(props);
  const resultArray = Array.isArray(result) ? result : [result];

  // Merge all results into a single RenderResult
  for (const {
    cssBundles: resultCSSBundles,
    jsBundles: resultJSBundles,
    cssDependencies: resultCSSDependencies,
    jsDependencies: resultJSDependencies,
    html: resultHTML,
    htmlDependencies: resultHTMLDependencies,
  } of resultArray) {
    for (const bundleName in resultCSSBundles) {
      mergedResult.cssBundles[bundleName] ??= new Set();
      for (const bundleChunk of resultCSSBundles[bundleName]) {
        mergedResult.cssBundles[bundleName].add(bundleChunk);
      }
    }
    for (const bundleName in resultJSBundles) {
      mergedResult.jsBundles[bundleName] ??= new Set();
      for (const bundleChunk of resultJSBundles[bundleName]) {
        mergedResult.jsBundles[bundleName].add(bundleChunk);
      }
    }

    for (const dep of resultCSSDependencies) {
      mergedResult.cssDependencies.add(dep);
    }
    for (const dep of resultJSDependencies) {
      mergedResult.jsDependencies.add(dep);
    }
    for (const dep of resultHTMLDependencies) {
      mergedResult.htmlDependencies.add(dep);
    }

    mergedResult.html += resultHTML;
  }

  return mergedResult;
}