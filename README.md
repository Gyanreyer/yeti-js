# Yeti

An HTML templating plugin for [11ty](11ty.dev) which allows flexible authoring of components with convenient auto-bundling for CSS and JS.

## Syntax

```ts
const IndexPage: YetiPageComponent = () => {
  return html`<${BaseLayout} title="Home">
    <h1>Hello, world!</h1>
  </>`;
};

IndexPage.js = js`
  console.log("Honey, I'm home!");
`;

IndexPage.css = css`
  h1 {
    color: red;
  }
`;

export default IndexPage;
```

## Plugin Setup

```js
// 11ty.config.js
import { yetiPlugin } from 'yeti-js';

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(yetiPlugin);
}
```

See [Plugin Config docs](/docs/plugin_config.md) for more details on available options for configuring the Yeti plugin further.

## Authoring a Yeti Component

Yeti uses [HTM](https://github.com/developit/htm) and a forked and heavily modified version of [VHTML](https://github.com/developit/vhtml) to allow you to write components with a JSX-like syntax in an `html` tagged template string.

```ts
// index.page.js
import { YetiComponent, YetiPageComponent } from 'yeti-js';

const SayHello: YetiComponent<{ name: string; }> = () => {
  return html`<h1>Hello, ${name}!`;
}

const IndexPage: YetiPageComponent = () => {
  return html`<html>
    <body>
      <${SayHello} name="Bob" />
    </body>
  </html>`;
};
export default IndexPage;
```

### HTM syntax

- You can render a component in your html by by inserting the component function into your
html like an html tag name like `<${MyComponent}>`.
  - Any child tags wrapped in a component will be passed to the component in a `children` prop. To close a component tag, you must use a special `<//>` component end tag.
    - Example: `<${MyComponent}>I am child text content!<//>`
- Component tags can be self-closed if they don't have children.
- Any attributes set on the component tag will be passed to the component as props.
  - Boolean attributes are supported, so `<${MyComponent} active />` will
    render `MyComponent` with `{ active: true }` props.
- You can spread props with the following syntax: `<div ...${props}>`
- HTML comments are supported.
- You can use self-closing tags for any element.

#### Known HTM Caveats

##### `<!DOCTYPE>` declaration tags

Unfortunately, at this time `<!DOCTYPE>` tags will cause HTM to silently produce weird broken output. This is a deliberate choice
by the HTM maintainer to align closer to JSX, which also does not support `<!DOCTYPE>`, but frankly I disagree with that philosophy, especially when there are no safeguards
to tell you something is wrong if you do include a `<!DOCTYPE>` tag in your html.
I am considering making a custom forked version of HTM to fix that, but for now I will just flag this as a known issue.
Note that a `<!DOCTYPE>` tag will be automatically inserted at the top of every page in the built output from this plugin.

##### Issues with injecting non-string content at the root level of an HTML template

HTM includes a nice improvement over JSX in that it supports having multiple root-level elements in your HTML without needing to wrap them
in a fragment. However, things break down if you do this with non-element content like a Yeti asset import or some other non-string content
that you are hoping will be stringified in the final output.

For example, the following will cause builds to break with errors that are difficult to track the source of:

```js
/**
 * @type {import("yeti-js").YetiComponent}
 */
const MyComponent = () => {
  return html`
    <div>Hello!</div>
    ${html.import("./imported-html.html")}
  `;
};
```

To solve this, you can wrap the contents with `<>...</>` fragment tags:

```js
/**
 * @type {import("yeti-js").YetiComponent}
 */
const MyComponent = () => {
  return html`<>
    <div>Hello!</div>
    ${html.import("./imported-html.html")}
  </>`;
};
```

Again, this is a bug that I would like to fix, but it will require forking HTM and rolling a new custom implementation.

## Page components

The Yeti plugin uses 11ty's file-based routing. Every page file must have the [page file extension defined in your plugin config](/docs/plugin_config.md#pagetemplatefileextension).
By default, this extension is `.page.js`.

A page file must expose the page component as a default export.
Each page component will automatically receive `eleventy`, `page`, and `collections` props which
can be used to access data from 11ty for your build.

This allows you to do things like automatically populate a `<meta name="generator">` tag with your current version of 11ty
or render content based on 11ty collections data.

```js
const IndexPage = ({
  eleventy,
}) => {
  return html`
    <html>
      <head>
        <meta name="generator" content="${eleventy.generator}" />
      </head>
    </html>
  `;
};
```

You can also export a `config` object from your page file to set up custom data and pagination.

```ts
export const config = {
  // We want to make an individual page for each entry in this names array
  names: ["Bob", "Mary", "Yeti"],
  pagination: {
    data: "names",
    size: 1,
    // This is the name of the prop that the page component will receive with each name
    alias: "name",
  },
  // Use the name as the URL slug; otherwise, pagination will default to numbered pages,
  // ie `/1/`, `/2/`, `/3/` instead of `/bob/`, `/mary/`, `/yeti/`
  permalink: (data) => data.name.toLowerCase();
};

const NamePage: YetiPageComponent<{ name: string; }> = ({
  name
}) => {
  return html`<html>
    <head>
      <title>${name}'s Page</title>
    </head>
    <body>
      <h1>${name}</h1>
    </body>
  </html>`;
}
```

See [11ty's data configuration docs](https://www.11ty.dev/docs/data-configuration/) for more
details on ways to configure your page's output.

## Asset Bundling

Yeti provides helpful bundling capabilities which allow you to attach JavaScript and CSS to
components. The Yeti plugin will automatically collect all JavaScript and CSS content from any
components that are used on each page and output them into optimized bundles.

This makes it easy to make sure that each page only loads the CSS and JS that it uses,
or do things like define a separate bundle for critical CSS which should be loaded before the
rest of the page.

```js
const MyComponent = () => html`<div class="my-component">Hi!</div>`;

MyComponent.css = css`
  ${css.bundle("critical")}
  /* Load height in critical bundle to avoid content jump */
  .my-component {
    height: 400px;
  }

  ${css.bundle("global")}
  .my-component {
    color: red;
  }
`;

const HomePage = () => {
  return html`
    <html>
      <head>
        <!-- Inlining critical CSS in the head -->
        <style>${css.inline("critical")}</style>
      </head>
      <body>
        <${MyComponent} />
        <!-- Deferring all other non-critical CSS after page content -->
        <link rel="stylesheet" href="${css.src("*")}" />
      </body>
    </html>
  `;
};
export default HomePage;
```

### CSS Bundling

You can attach CSS to any Yeti Component by setting its `css` property to a `css` tagged template string.

```js
import { html, css } from 'yeti-js';

const MyComponent = () => html`<div>Hello</div>`;

MyComponent.css = css`
  div {
    font-weight: bold;
  }
`;
```

Unless otherwise specified, all CSS contents in a `css` template string will be placed in a
default global CSS bundle which will need to be included on the page somewhere via [`css.inline()`](#cssinline)
or [`css.src()`](#csssrc).

The default CSS bundle is named `"global"`, but you can [configure the plugin to use a different default CSS bundle name](/docs/plugin_config.md#cssdefaultbundlename) instead.

#### `css.bundle()`

At any point in a `css` template string, you can mark the beginning of a new bundle by calling `css.bundle()` with a bundle name string.

All CSS content following a `css.bundle()` call will be placed into the specified bundle,
until we encounter another `css.bundle()` call or reach the end of the template string.

```js
import { html, css } from 'yeti-js';

const MyComponent = () => html`<div>Hello</div>`;

MyComponent.css = css`
  /* When not specified, all styles go into the "styles" bucket by default */
  div {
    font-weight: bold;
  }

  ${css.bundle("critical")}
  div {
    height: 40px;
  }

  ${css.bundle("other-bundle")}
  div {
    color: red;
  }
`;
```

#### `css.import`

At any point in a `css` template string, you can import the source from an external file into the
CSS bundle by calling `css.import()` with a file path and optional bundle name.

If a bundle name is not specified, the imported contents will be placed in whatever the current active bundle is at that point in the template. Note that passing a bundle name to `css.import()` will not
change the active bundle for any following CSS contents, only `css.bundle()` can do that.

```js
import { html, css } from 'yeti-js';

const MyComponent = () => html`<div>Hello</div>`;

MyComponent.css = css`
  /* Import MyComponent.css into the default "styles" bundle */
  ${css.import("./MyComponent.css")}
  /* Import reset.css into the "critical" bundle */
  ${css.import("./reset.css", "critical")}
`;
```

#### `css.src`

To output a CSS bundle into an external file that is loaded with a `<link rel="stylesheet">` tag,
you can create a `<link rel="stylesheet">` tag and pass `css.src(bundleName)` as the `href` attribute.

In the plugin processing step, the bundle will be written to a file and the `href` will be set
to a path that points to it.

```js
import { html, css } from 'yeti-js';

const HomePage = () => html`<html>
  <head>
    <link rel="stylesheet" href="${css.src("styles")}" />
  </head>
</html>`;

/**
 * Expected output:
 * <html>
 *  <head>
 *    <link rel="stylesheet" href="/css/styles.css">
 *  </head>
 * </html>
 */
```

You can also pass in a `"*"` wildcard to `css.src()` to automatically include every bundle that was
used on the page and has not been loaded by any other tags tags. In this case, the `<link>` tag
will be repeated for each bundle.

```js
import { html, css } from 'yeti-js';

// HomePage's components have styles in the "styles" and "home" bundles.
const HomePage = () => html`<html>
  <head>
    <link rel="stylesheet" href="${css.src("*")}" />
  </head>
</html>`;

/**
 * Expected output:
 * <html>
 *  <head>
 *    <link rel="stylesheet" href="/css/styles.css">
 *    <link rel="stylesheet" href="/css/home.css">
 *  </head>
 * </html>
 */
```

### JS bundling

You can attach JavaScript to any Yeti Component by setting its `js` property to a `js` tagged template string.

```js
import { html, js } from 'yeti-js';

const MyComponent = () => html`<div>Hello</div>`;

MyComponent.js = js`
  console.log('Component loaded!');
`;
```

Unless otherwise specified, all JavaScript contents in a `js` template string will be placed in a
default global JavaScript bundle which will need to be included on the page somewhere via [`js.inline()`](#jsinline)
or [`js.src()`](#jssrc).

The default JavaScript bundle is named `"global"`, but you can [configure the plugin to use a different default JavaScript bundle name](/docs/plugin_config.md#jsdefaultbundlename) instead.

#### `js.bundle()`

At any point in a `js` template string, you can mark the beginning of a new bundle by calling `js.bundle()` with a bundle name string.

All JavaScript content following a `js.bundle()` call will be placed into the specified bundle,
until we encounter another `js.bundle()` call or reach the end of the template string.

```js
import { html, js } from 'yeti-js';

const MyComponent = () => html`<div>Hello</div>`;

MyComponent.js = js`
  /* When not specified, all JavaScript goes into the "global" bundle by default */
  console.log('This is in the default bundle');

  ${js.bundle("vendor")}
  // Third-party library code
  console.log('This is in the vendor bundle');

  ${js.bundle("interactions")}
  // User interaction code
  document.addEventListener('click', handleClick);
`;
```

#### `js.import`

At any point in a `js` template string, you can import the source from an external file into the
JavaScript bundle by calling `js.import()` with a file path and optional bundle name.

If a bundle name is not specified, the imported contents will be placed in whatever the current active bundle is at that point in the template. Note that passing a bundle name to `js.import()` will not
change the active bundle for any following JavaScript contents, only `js.bundle()` can do that.

```js
import { html, js } from 'yeti-js';

const MyComponent = () => html`<div>Hello</div>`;

MyComponent.js = js`
  /* Import utils.js into the default "global" bundle */
  ${js.import("./utils.js")}
  /* Import jquery.js into the "vendor" bundle */
  ${js.import("./vendor/jquery.js", "vendor")}
`;
```

#### `js.src`

To output a JavaScript bundle into an external file that is loaded with a `<script src="">` tag,
you can create a `<script>` tag and pass `js.src(bundleName)` as the `src` attribute.

In the plugin processing step, the bundle will be written to a file and the `src` will be set
to a path that points to it.

```js
import { html, js } from 'yeti-js';

const HomePage = () => html`<html>
  <head>
    <script src="${js.src("vendor")}" defer></script>
  </head>
  <body>
    <script src="${js.src("global")}" defer></script>
  </body>
</html>`;

/**
 * Expected output:
 * <html>
 *  <head>
 *    <script src="/js/vendor.js" defer></script>
 *  </head>
 *  <body>
 *    <script src="/js/global.js" defer></script>
 *  </body>
 * </html>
 */
```

You can also pass in a `"*"` wildcard to `js.src()` to automatically include every bundle that was
used on the page and has not been loaded by any other script tags. In this case, the `<script>` tag
will be repeated for each bundle.

```js
import { html, js } from 'yeti-js';

// HomePage's components have JavaScript in the "global" and "interactions" bundles.
const HomePage = () => html`<html>
  <body>
    <script src="${js.src("*")}" defer></script>
  </body>
</html>`;

/**
 * Expected output:
 * <html>
 *  <body>
 *    <script src="/js/global.js" defer></script>
 *    <script src="/js/interactions.js" defer></script>
 *  </body>
 * </html>
 */
```

#### `js.inline`

To inline JavaScript content directly into a `<script>` tag instead of loading it from an external file,
you can place `js.inline(bundleName)` inside a `<script>` tag.

In the plugin processing step, the `js.inline()` call will be replaced with the actual JavaScript
content from the specified bundle.

```js
import { html, js } from 'yeti-js';

const HomePage = () => html`<html>
  <head>
    <script>
      ${js.inline("critical")}
    </script>
  </head>
  <body>
    <script>
      ${js.inline("global")}
    </script>
  </body>
</html>`;

/**
 * Expected output:
 * <html>
 *  <head>
 *    <script>
 *      // Inlined JavaScript from the "critical" bundle
 *    </script>
 *  </head>
 *  <body>
 *    <script>
 *      // Inlined JavaScript from the "global" bundle
 *    </script>
 *  </body>
 * </html>
 */
```

You can also pass in a `"*"` wildcard to `js.inline()` to inline every bundle that was
used on the page and has not been loaded by any other tags.

```js
import { html, js } from 'yeti-js';

// HomePage's components have JavaScript in the "global" and "interactions" bundles.
const HomePage = () => html`<html>
  <body>
    <script>
      ${js.inline("*")}
    </script>
  </body>
</html>`;

/**
 * Expected output:
 * <html>
 *  <body>
 *    <script>
 *      // Inlined JavaScript from the "global" bundle
 *      // Inlined JavaScript from the "interactions" bundle
 *    </script>
 *  </body>
 * </html>
 */
```

### HTML imports

You can include partial content from external files into your component's HTML using `html.import()`.

```js
import { html } from 'yeti-js';

const MyComponent = () => html`
  <div>
    ${html.import('./partials/header.html')}
    <main>Page content here</main>
    ${html.import('./partials/footer.html')}
  </div>
`;
```

#### Importing text content

By default, imported HTML files are included as-is and will be parsed as raw HTML. If you want to import text content that should be escaped for safe display, you can set the `escape` option to `true`:

```js
import { html } from 'yeti-js';

const CodeExample = () => html`
  <pre><code>${html.import('./examples/code-snippet.txt', { escape: true })}</code></pre>
`;
```

#### HTML bundling

Similar to CSS and JavaScript, you can bundle HTML content by specifying a bundle name. This is particularly useful for things like SVG sprites where you want to collect multiple SVG icons used across components and include them in a single location.

Note that unlike with CSS and JS bundling, there is no default global bundle; if a bundle name is not specified,
the imported HTML content will just be injected into the output HTML in-place instead of being bundled.

```js
import { html } from 'yeti-js';

const IconComponent = ({ iconName }) => html`
  <div class="icon-wrapper">
    ${html.import(`./icons/${iconName}.svg`, { bundleName: 'svg-sprites' })}
    <svg class="icon">
      <use href="#${iconName}"></use>
    </svg>
  </div>
`;
```

#### `html.inline`

To output bundled HTML content directly into your markup, you can use `html.inline()` with the bundle name:

```js
import { html } from 'yeti-js';

const Layout = ({ children }) => html`
  <html>
    <body>
      <!-- Include all collected SVG sprites -->
      <svg xmlns="http://www.w3.org/2000/svg" style="display: none;">
        <defs>
          ${html.inline('svg-sprites')}
        </defs>
      </svg>
      
      <main>${children}</main>
    </body>
  </html>
`;

/**
 * Expected output:
 * <html>
 *   <body>
 *     <svg xmlns="http://www.w3.org/2000/svg" style="display: none;">
 *       <defs>
 *         <symbol id="icon-1" viewBox="0 0 24 24">...</symbol>
 *         <symbol id="icon-2" viewBox="0 0 24 24">...</symbol>
 *       </defs>
 *     </svg>
 *     
 *     <main>Page content here</main>
 *   </body>
 * </html>
 */
```

You can also use the `"*"` wildcard to inline all HTML bundles that were used on the page and have not been explicitly referenced elsewhere:

```js
import { html } from 'yeti-js';

const Layout = ({ children }) => html`
  <html>
    <body>
      ${children}
      
      <!-- Include all unreferenced HTML bundles at the end -->
      ${html.inline('*')}
    </body>
  </html>
`;
```
