/**
 * @import { CSSResult } from './css.js';
 * @import { JSResult } from './js.js';
 * @import { RenderResult, Children } from './html.js';
 *
 * @template {{
 *  [prop: string]: unknown;
 * }} [Props={ [prop: string]: any; }]
 * @typedef {((data: Props & {
 *  children?: Children;
 * }) => RenderResult | RenderResult[]) & { css?: ()=>CSSResult; js?: ()=>JSResult; }} Component
 */

/**
 * Takes a component and its props, and returns the rendered HTML string along with its CSS and JS dependencies and bundles.
 * You should use this instead of directly calling the component function to ensure that
 * the component's bundled CSS and JS get merged into the render result correctly.
 *
 * @param {Component} component
 * @param {*} props
 *
 * @returns {Promise<RenderResult>}
 */
export async function renderComponent(component, props = {}) {
  const result = await component(props);

  const resultArray = Array.isArray(result) ? result : [result];

  /**
   * @type {RenderResult}
   */
  const mergedResult = {
    cssBundles: {},
    cssDependencies: new Set(),
    jsBundles: {},
    jsDependencies: new Set(),
    html: "",
    htmlDependencies: new Set(),
  }

  // Merge all results into a single RenderResult
  for (const result of resultArray) {
    mergedResult.html += result.html;

    for (const bundleName in result.cssBundles) {
      const {
        cssBundles: mergedCSSBundles,
        jsBundles: mergedJSBundles,
      } = mergedResult;
      const {
        cssBundles: resultCSSBundles,
        jsBundles: resultJSBundles,
        cssDependencies: resultCSSDependencies,
        jsDependencies: resultJSDependencies,
        html: resultHTML,
        htmlDependencies: resultHTMLDependencies,
      } = result;

      mergedCSSBundles[bundleName] = (mergedCSSBundles[bundleName] ?? new Set()).union(resultCSSBundles[bundleName]);
      mergedJSBundles[bundleName] = (mergedJSBundles[bundleName] ?? new Set()).union(resultJSBundles[bundleName]);

      mergedResult.cssDependencies = mergedResult.cssDependencies.union(resultCSSDependencies);
      mergedResult.jsDependencies = mergedResult.jsDependencies.union(resultJSDependencies);

      mergedResult.html += resultHTML;
      mergedResult.htmlDependencies = mergedResult.htmlDependencies.union(resultHTMLDependencies);
    }
  }

  // Merge in any component-level CSS/JS; the render result returned by the component only has CSS/JS from its children
  const componentCSS = component.css?.();
  if (componentCSS) {
    for (const bundleName in componentCSS.cssBundles) {
      mergedResult.cssBundles[bundleName] ??= new Set();
      mergedResult.cssBundles[bundleName].add(componentCSS.cssBundles[bundleName]);
    }
    for (const dependency of componentCSS.cssDependencies) {
      mergedResult.cssDependencies.add(dependency);
    }
  }

  const componentJS = component.js?.();
  if (componentJS) {
    for (const bundleName in componentJS.jsBundles) {
      mergedResult.jsBundles[bundleName] ??= new Set();
      mergedResult.jsBundles[bundleName].add(componentJS.jsBundles[bundleName]);
    }
    for (const dependency of componentJS.jsDependencies) {
      mergedResult.jsDependencies.add(dependency);
    }
  }

  return mergedResult;
}