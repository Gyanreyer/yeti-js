/**
 * @import { CSSResult } from './css.js';
 * @import { JSResult } from './js.js';
 * @import { RenderResult } from './html.js';
 *
 * @typedef {((data: any) => RenderResult) & { css?: ()=>CSSResult; js?: ()=>JSResult; }} Component
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
  const {
    cssBundles,
    cssDependencies,
    jsBundles,
    jsDependencies,
    ...restRenderRestults
  } = await component(props);

  const componentCSS = component.css?.();
  if (componentCSS) {
    for (const bundleName in componentCSS.cssBundles) {
      cssBundles[bundleName] ??= new Set();
      cssBundles[bundleName].add(componentCSS.cssBundles[bundleName]);
    }
    for (const dependency of componentCSS.cssDependencies) {
      cssDependencies.add(dependency);
    }
  }

  const componentJS = component.js?.();
  if (componentJS) {
    for (const bundleName in componentJS.jsBundles) {
      jsBundles[bundleName] ??= new Set();
      jsBundles[bundleName].add(componentJS.jsBundles[bundleName]);
    }
    for (const dependency of componentJS.jsDependencies) {
      jsDependencies.add(dependency);
    }
  }

  return {
    cssBundles,
    cssDependencies,
    jsBundles,
    jsDependencies,
    ...restRenderRestults,
  };
}