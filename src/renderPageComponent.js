import { flattenRenderResults } from './utils/flattenRenderResults.js';

/**
 * @import { RenderResult,  EleventyPageData, YetiPageComponent } from './types.js';
 */

/**
 * Takes a component and its props, and returns the rendered HTML string along with its CSS and JS dependencies and bundles.
 * You should use this instead of directly calling the component function to ensure that
 * the component's bundled CSS and JS get merged into the render result correctly.
 *
 * @template {Record<string, any>} TProps
 * @param {YetiPageComponent<TProps>} pageComponent
 * @param {EleventyPageData & TProps} props
 *
 * @returns {RenderResult}
 */
export function renderPageComponent(pageComponent, props) {
  // Merge in any component-level CSS/JS; the render result returned by the component only has CSS/JS from its children
  const componentCSS = pageComponent.css?.();
  const componentJS = pageComponent.js?.();

  /**
   * @type {RenderResult}
   */
  const componentBundleAssetsResult = {
    cssBundles: {},
    cssDependencies: componentCSS?.cssDependencies ?? new Set(),
    jsBundles: {},
    jsDependencies: componentJS?.jsDependencies ?? new Set(),
    htmlBundles: {},
    htmlDependencies: new Set(),
    html: "",
  }

  if (componentCSS) {
    for (const bundleName in componentCSS.cssBundles) {
      componentBundleAssetsResult.cssBundles[bundleName] ??= new Set();
      componentBundleAssetsResult.cssBundles[bundleName].add(componentCSS.cssBundles[bundleName]);
    }
  }
  if (componentJS) {
    for (const bundleName in componentJS.jsBundles) {
      componentBundleAssetsResult.jsBundles[bundleName] ??= new Set();
      componentBundleAssetsResult.jsBundles[bundleName].add(componentJS.jsBundles[bundleName]);
    }
  }

  const componentRenderResults = pageComponent(props);

  return flattenRenderResults([componentBundleAssetsResult].concat(componentRenderResults));
}