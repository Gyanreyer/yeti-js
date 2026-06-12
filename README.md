# Yeti

An HTML templating plugin for [11ty](11ty.dev) which allows flexible authoring of components with convenient auto-bundling for CSS and JS.

## Syntax

```ts
const IndexPage: YetiPageComponent = () => {
  return html`<${BaseLayout} title="Home">
    <h1>Hello, world!</h1>
  <//>`;
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

See [Plugin Config](#plugin-config) for more details on available options for configuring the Yeti plugin's behavior.

## Authoring a Yeti Component

Yeti uses a custom HTML parser to allow you to write components with a JSX-like syntax in an `html` tagged template string.

```ts
// index.page.js
import { YetiComponent, YetiPageComponent } from 'yeti-js';

const SayHello: YetiComponent<{ name: string; }> = ({
  name,
}) => {
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

### Template syntax

- You can render a component in your html by inserting the component function into your
html like an html tag name like `<${MyComponent}>`.
  - Any child tags wrapped in a component will be passed to the component in a `children` prop. To close a component tag, you can use the component reference `</${MyComponent}>` or a shorthand `</>` closing tag.
    - Example: `<${MyComponent}>I am child text content!</>`
- Component tags can be self-closed if they don't have children.
- Any attributes set on the component tag will be passed to the component as props.
  - Boolean attributes are supported, so `<${MyComponent} active />` will
    render `MyComponent` with `{ active: true }` props.
- You can spread props with the following syntax: `<div ...${props}>`
- `<!DOCTYPE>` declarations, HTML comments, and self-closing tags are all supported.
- Multiple root-level elements are supported without requiring a fragment wrapper.
- Raw `undefined`, `null`, or `""` empty string values in HTML child content will be ignored. This provides some options for conditionally rendering content.
  - ``` html`${shouldRender ? "Conditional content" : null}` ```

## Page components

The Yeti plugin uses 11ty's file-based routing. Every page file must have the [page file extension defined in your plugin config](#pagetemplatefileextension).
By default, the supported extensions are `.page.js` and `.page.ts`.

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

### Module state and watch-mode rebuilds

> [!IMPORTANT]
> Do not rely on module-level (in-memory) state persisting across rebuilds in watch mode.

In watch mode, incremental rebuilds may cache-bust and re-import your page and component modules as fresh
modules so that changes to source files (and the assets they
attach via `` css`...` ``, `` js`...` ``, etc.) are always picked up. A side effect is that **any module-level state may be reset to its initial value at the start of every build**. Top-level
variables are re-initialized, and module initialization code runs again from scratch.

This means a pattern like an in-memory cache declared at module scope will _not_ carry over
between builds; you'll get a cache miss on every rebuild:

```ts
// This cache is wiped on every watch rebuild — it never gets a hit across builds.
const expensiveResultCache = new Map();

const MyPage = async () => {
  if (!expensiveResultCache.has("key")) {
    expensiveResultCache.set("key", await computeExpensiveThing());
  }
  return html`<div>${expensiveResultCache.get("key")}</div>`;
};
```

This is intentional — it's what keeps incremental builds correct when your source changes. If you really
need state to survive across builds, it is recommended that you either persist
it to the disk, or you may attach it to `globalThis` since it is process-global and therefore isn't affected by module reloads:

```ts
const cache = ((globalThis as any).__myCache ??= new Map());
```

## Head Component

Yeti provides a built-in `Head` component that allows you to declare `<head>` content from any component in the tree, similar to libraries like React Helmet. Content placed inside `Head` is automatically hoisted and merged into the document's `<head>` element.

```ts
import { html, Head } from 'yeti-js';

const MyPage = () => {
  return html`<${Layout}>
    <${Head}>
      <title>My Page!</title>
      <meta name="description" content="A description of my page" />
    </${Head}>
    <main>Hello!</main>
  </${Layout}>`;
};
export default MyPage;
```

This is useful when a layout component defines default `<head>` content (like a fallback `<title>` or common `<meta>` tags), but individual pages or deeply nested components need to customize it.

### How it works

- `Head` can be used anywhere in the component tree, at any nesting depth.
- Nothing is rendered in place — all `Head` content is collected and merged into the document's primary `<head>` element.
- If no `<head>` element exists in the page, one will be created automatically.
- Multiple `Head` components are supported; their content is merged in document order.

### Merging rules

When the page's existing `<head>` and `Head` component content overlap, the following deduplication rules apply:

| Element | Dedupe key | Behavior |
|---------|-----------|----------|
| `<title>` | Tag name | Last one wins |
| `<meta>` | `name`, `property`, or `http-equiv` attribute | Last one wins |
| `<link>` | `rel` + `href` attributes | Last one wins |
| `<script>` (with `src`) | `src` attribute | Last one wins |
| `<script>` (inline), `<style>`, others | — | Always appended |

"Last one wins" means that content appearing later in document order takes priority. Since a layout component's `<head>` renders before `Head` component content is merged in, page-level `Head` content will naturally override layout defaults:

```ts
// Layout.component.ts
const Layout = ({ children }) => html`<html>
  <head>
    <title>My Site</title>
    <meta name="description" content="Default description" />
  </head>
  <body>${children}</body>
</html>`;

// MyPage.page.ts — title and description override the layout's defaults
const MyPage = () => html`<${Layout}>
  <${Head}>
    <title>About Us</title>
    <meta name="description" content="Learn about us" />
  </${Head}>
  <main>About page content</main>
</${Layout}>`;
export default MyPage;
```

## Asset Bundling

Yeti provides helpful bundling capabilities which allow you to attach JavaScript and CSS to
components. The Yeti plugin will automatically collect all JavaScript and CSS content from any
components that are used on each page and output them into optimized bundles.

This makes it easy to make sure that each page only loads the CSS and JS that it uses,
or do things like define a separate bundle for critical CSS which should be loaded before the
rest of the page.

By default, any CSS or JS authored in a component is placed into a **page-scoped bundle** named
`"@page"` — a reserved bundle name that resolves to a unique bundle per page. This prevents CSS
or JS authored for one page from accidentally being applied to another. To opt into a shared
cross-page bundle, explicitly name it via [`css.bundle()`](#cssbundle) / [`js.bundle()`](#jsbundle)
or pass a name to [`css.import()`](#cssimport) / [`js.import()`](#jsimport).

```js
const MyComponent = () => html`<div class="my-component">Hi!</div>`;

MyComponent.css = css`
  ${css.bundle("critical")}
  /* Load height in critical bundle to avoid content jump */
  .my-component {
    height: 400px;
  }

  ${css.bundle("@page")}
  /* This will go into the page-scoped bundle for every page which uses MyComponent */
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
        <!-- Deferring all other non-critical CSS after page content;
             the wildcard automatically picks up the page-scoped bundle -->
        <link rel="stylesheet" href="${css.src("*")}" />
      </body>
    </html>
  `;
};
export default HomePage;
```

### Page-scoped vs shared bundles

`"@page"` is a reserved sentinel bundle name. Each page gets its own `@page` bundle file; bundles
with any other name (e.g. `"global"`, `"vendor"`, `"critical"`) are shared across every page that
contributes to them.

| You want… | Use |
|-----------|-----|
| Per-page CSS/JS that won't leak to other pages | The default behavior, or `css.bundle("@page")` / `js.bundle("@page")` to be explicit |
| A shared bundle across all pages that include this component | `css.bundle("global")` (or any name you choose) |
| Reference the current page's bundle | `css.src("@page")`, `css.inline("@page")` |
| Pull every unreferenced bundle (including `@page`) into one place | `css.src("*")` or `css.inline("*")` |

Paginated variants of the same template (multiple pages produced by a single
`*.page.ts` file via `pagination`) share a single `@page` bundle — the merge key is the page
template's `inputPath`.

Because `@page` is the default bundle, it's common to reference it from a shared layout (e.g.
`<link rel="stylesheet" href="${css.src("@page")}" />`) even on pages that contribute no CSS or
JS. When a referenced `@page` bundle turns out to be empty for a given page, the reference is
**silently dropped** (the `href`/`src` attribute is removed and no bundle file is written) — no
warning, since this is an expected, benign case. Referencing an empty *named* bundle (anything
other than `"@page"`) still logs a warning, since that usually indicates a mistake.

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

Unless otherwise specified, all CSS contents in a `css` template string will be placed into the
page-scoped `"@page"` bundle, which is unique per page. To include this bundle on the page, use
[`css.inline("@page")`](#cssinline), [`css.src("@page")`](#csssrc), or the `"*"` wildcard, which
picks it up automatically.

If you want CSS to be shared across multiple pages (e.g. a `"global"` reset stylesheet, or a
`"vendor"` bundle), opt into it explicitly via [`css.bundle()`](#cssbundle) or by passing an
explicit bundle name to [`css.import()`](#cssimport). Bundles with any name other than `"@page"`
are shared across every page that contributes to them.

#### `css.bundle()`

At any point in a `css` template string, you can mark the beginning of a new bundle by calling `css.bundle()` with a bundle name string.

All CSS content following a `css.bundle()` call will be placed into the specified bundle,
until we encounter another `css.bundle()` call or reach the end of the template string.

```js
import { html, css } from 'yeti-js';

const MyComponent = () => html`<div>Hello</div>`;

MyComponent.css = css`
  /* When no bundle is specified, styles go into the page-scoped "@page" bundle */
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

#### `css.import()`

At any point in a `css` template string, you can import the source from an external file into the
CSS bundle by calling `css.import()` with a file path and optional bundle name.

If a bundle name is not specified, the imported contents will be placed in whatever the current active bundle is at that point in the template. Note that passing a bundle name to `css.import()` will not
change the active bundle for any following CSS contents, only `css.bundle()` can do that.

```js
import { html, css } from 'yeti-js';

const MyComponent = () => html`<div>Hello</div>`;

MyComponent.css = css`
  /* Import MyComponent.css into the page-scoped "@page" bundle (the default) */
  ${css.import("./MyComponent.css")}
  /* Import reset.css into the "critical" bundle */
  ${css.import("./reset.css", "critical")}
`;
```

#### `css.src()`

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
used on the page and has not been loaded by any other tags. The page-scoped `"@page"` bundle is
included in the wildcard expansion when present. In this case, the `<link>` tag will be repeated
for each bundle.

```js
import { html, css } from 'yeti-js';

// HomePage's components contribute styles to a shared "global" bundle and to the
// page-scoped "@page" bundle (the default for unspecified styles).
const HomePage = () => html`<html>
  <head>
    <link rel="stylesheet" href="${css.src("*")}" />
  </head>
</html>`;

/**
 * Expected output:
 * <html>
 *  <head>
 *    <link rel="stylesheet" href="/css/global.css">
 *    <link rel="stylesheet" href="/css/_pages/index.css">
 *  </head>
 * </html>
 */
```

#### `css.inline()`

To inline CSS content directly into a `<style>` tag instead of loading it from an external file,
you can place `css.inline(bundleName)` inside a `<style>` tag.

In the plugin processing step, the `css.inline()` call will be replaced with the actual CSS
content from the specified bundle.

```js
import { html, css } from 'yeti-js';

const HomePage = () => html`<html>
  <head>
    <style>
      ${css.inline("critical")}
    </style>
  </head>
  <body>
    <style>
      ${css.inline("global")}
    </style>
  </body>
</html>`;

/**
 * Expected output:
 * <html>
 *  <head>
 *    <style>
 *      // Inlined CSS from the "critical" bundle
 *    </style>
 *  </head>
 *  <body>
 *    <style>
 *      // Inlined CSS from the "global" bundle
 *    </style>
 *  </body>
 * </html>
 */
```

You can also pass in a `"*"` wildcard to `css.inline()` to inline every bundle that was
used on the page and has not been loaded by any other tags.

```js
import { html, css } from 'yeti-js';

// HomePage's components have CSS in the "global" and "interactions" bundles.
const HomePage = () => html`<html>
  <body>
    <style>
      ${css.inline("*")}
    </style>
  </body>
</html>`;

/**
 * Expected output:
 * <html>
 *  <body>
 *    <style>
 *      // Inlined CSS from the "global" bundle
 *      // Inlined CSS from the "interactions" bundle
 *    </style>
 *  </body>
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

Unless otherwise specified, all JavaScript contents in a `js` template string will be placed into
the page-scoped `"@page"` bundle, which is unique per page. To include this bundle on the page,
use [`js.inline("@page")`](#jsinline), [`js.src("@page")`](#jssrc), or the `"*"` wildcard, which
picks it up automatically.

If you want JavaScript to be shared across multiple pages (e.g. a `"global"` script bundle, or a
`"vendor"` bundle), opt into it explicitly via [`js.bundle()`](#jsbundle) or by passing an
explicit bundle name to [`js.import()`](#jsimport). Bundles with any name other than `"@page"`
are shared across every page that contributes to them.

#### `js.bundle()`

At any point in a `js` template string, you can mark the beginning of a new bundle by calling `js.bundle()` with a bundle name string.

All JavaScript content following a `js.bundle()` call will be placed into the specified bundle,
until we encounter another `js.bundle()` call or reach the end of the template string.

```js
import { html, js } from 'yeti-js';

const MyComponent = () => html`<div>Hello</div>`;

MyComponent.js = js`
  /* When no bundle is specified, JavaScript goes into the page-scoped "@page" bundle */
  console.log('This is in the page bundle');

  ${js.bundle("vendor")}
  // Third-party library code
  console.log('This is in the vendor bundle');

  ${js.bundle("interactions")}
  // User interaction code
  document.addEventListener('click', handleClick);
`;
```

#### `js.import()`

At any point in a `js` template string, you can import the source from an external file into the
JavaScript bundle by calling `js.import()` with a file path and optional bundle name.

If a bundle name is not specified, the imported contents will be placed in whatever the current active bundle is at that point in the template. Note that passing a bundle name to `js.import()` will not
change the active bundle for any following JavaScript contents, only `js.bundle()` can do that.

```js
import { html, js } from 'yeti-js';

const MyComponent = () => html`<div>Hello</div>`;

MyComponent.js = js`
  /* Import utils.js into the page-scoped "@page" bundle (the default) */
  ${js.import("./utils.js")}
  /* Import jquery.js into the "vendor" bundle */
  ${js.import("./vendor/jquery.js", "vendor")}
`;
```

#### `js.src()`

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

#### `js.inline()`

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

By default, imported HTML files are included as-is and will be parsed as raw HTML. If you want to import text content that should be escaped for safe display, you can set the `shouldEscape` option to `true`:

```js
import { html } from 'yeti-js';

const CodeExample = () => html`
  <pre><code>${html.import('./examples/code-snippet.txt', { shouldEscape: true })}</code></pre>
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

#### `html.inline()`

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

You can also pass a `shouldEscape` option to `html.inline()` to escape the bundled HTML content as plain text instead of inserting it as raw HTML:

```js
import { html } from 'yeti-js';

const Layout = ({ children }) => html`
  <html>
    <body>
      <pre><code>${html.inline('code-examples', { shouldEscape: true })}</code></pre>
    </body>
  </html>
`;
```

#### `html.src()`

To output an HTML bundle into an external file and get a path to it, you can use `html.src()` with the bundle name. In the plugin processing step, the bundle will be written to a file and the call will be replaced with a path that points to it.
This is mainly useful for generating SVG spritesheets.

```js
import { html } from 'yeti-js';

const MenuIcon = ({ children }) => html`
  <svg>
    <use href="${html.src('svg-sprites')}#menu-icon"></use>
  </svg>
`;

/**
 * Expected output:
 * <svg>
 *   <use href="/assets/svg-sprites.svg#menu-icon"></use>
 * </svg>
 */
```

## Markdown

Yeti exports a `parseMarkdown` utility function which parses a Markdown string into a Yeti node tree. This is useful for rendering Markdown content within your components.

```ts
import { html, parseMarkdown } from 'yeti-js';
import { readFileSync } from 'node:fs';

const BlogPost = async ({ postPath }) => {
  const markdown = readFileSync(postPath, 'utf-8');
  const content = await parseMarkdown(markdown);

  return html`<article>
    ${content}
  </article>`;
};
```

`parseMarkdown` supports standard Markdown features including headings, paragraphs, blockquotes, code blocks (with language annotations), lists (ordered, unordered, and task lists), tables, emphasis, links, images, and inline HTML.

You can also use `parseMarkdown` in combination with the `html.processImport` plugin config option to automatically parse Markdown files that are included via `html.import()`. See [`html.processImport`](#htmlprocessimport) for more details.

## Plugin Config

The Yeti plugin supports some optional config options for customization of the build output:

### `pageTemplateFileExtension`

This allows you to configure the file extension(s) to use to identify any Yeti page files which should be processed by the plugin and output as pages in the built site.
By default, the supported extensions are `page.js` and `page.ts`.

For example, if our input directory is `src` and our output is `dist`, the plugin will process `src/index.page.js` and write the output to `dist/index.html`.

You can pass a single string or an array of strings. **Values must not include a leading dot** — Eleventy's template-format registration APIs silently fail to pick up extensions that start with `.`, which will leave your page files unprocessed.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  pageTemplateFileExtension: "yeti.js",
});
eleventyConfig.addPlugin(yetiPlugin, {
  pageTemplateFileExtension: ["yeti.js", "yeti.ts"],
});
```

### `browserslist`

A [browserslist](https://github.com/browserslist/browserslist) query describing which browsers your site needs to support. Yeti translates it **once** into both esbuild's `target` (for JS) and lightningcss's `targets` (for CSS), so you express browser support a single way and it's applied consistently across every JS and CSS bundle.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  browserslist: "> 0.5%, last 2 versions, not dead",
});
// An array of queries is also accepted:
eleventyConfig.addPlugin(yetiPlugin, {
  browserslist: ["chrome 90", "firefox 88", "safari 15"],
});
```

If you don't set `browserslist`, Yeti **auto-detects** a project browserslist config (a `.browserslistrc` file, a `browserslist` key in `package.json`, etc.). If there's neither an explicit query nor a project config, Yeti injects no targets and the bundlers keep their own defaults — so this option is opt-in and never silently changes existing output.

An explicit [`js.defaultBundleTransformConfig.target`](#jsdefaultbundletransformconfig) or [`css.defaultBundleTransformConfig.targets`](#cssdefaultbundletransformconfig) always overrides the value computed from this query.

### `js`

The plugin offers some options for customizing how bundled JavaScript assets are processed and output.

#### `js.deriveBundleFilePath`

Function to derive custom file paths that external JavaScript bundle files should be written to.
This function will be called for each bundle with the bundle name, and should return a string representing
the path relative to the site's root where the bundle should be written.
Defaults to `` `/js/${bundleName}.js` ``.

Leading slashes are optional.
Note that this does not run for the special page-scoped `"@page"` bundle; see [`js.derivePageBundleFilePath`](#jsderivepagebundlefilepath).

```js
eleventyConfig.addPlugin(yetiPlugin, {
  js: {
    // Bundle files should go in the "assets/js" directory with a `.bundle.js` suffix
    deriveBundleFilePath: (bundleName) => `assets/js/${bundleName}.bundle.js`,
  },
});
```

#### `js.derivePageBundleFilePath`

Function to derive the file path where each page's `@page` JS bundle should be written. The function
receives the page's `EleventyPageData["page"]` object (with `inputPath`, `fileSlug`, `url`, etc.) and
should return a string representing the path relative to the site's root.

By default, the path is derived from the page template's `inputPath`, stripping the input dir prefix
and the page template extension, then prepending `/js/_pages/` and appending `.js`. For example,
with input dir `src` and template extension `page.ts`, `src/blog/post.page.ts` becomes
`/js/_pages/blog/post.js`.

This deriver is called once per page template (pagination variants of the same template share a
bundle file). The path returned must be unique per template — otherwise pages with the same derived
path will overwrite each other.

> [!IMPORTANT]
> Derive the path only from **template-constant** fields (`inputPath`, `fileSlug`, `filePathStem`).
> Pagination variants of one template share a single `@page` bundle file, so a deriver that keys off
> a **per-page** field (`url`, `outputPath`, `date`) makes each variant reference a different path
> while only one file is written — the other variants then 404. Yeti logs a warning if it detects
> this, but it's safest to never key off per-page fields here. (`fileSlug` is the *template's* slug,
> which is constant across pagination variants, so the example below is safe.)

```js
eleventyConfig.addPlugin(yetiPlugin, {
  js: {
    // Flatten bundles into one dir keyed by the template's file slug (constant across pagination)
    derivePageBundleFilePath: (page) => `/js/pages/${page.fileSlug}.js`,
  },
});
```

#### `js.defaultBundleTransformConfig`

Default [esbuild transform options](https://esbuild.github.io/api/#transform) to use when processing JavaScript bundles. This allows you to specify custom esbuild options like minification, target environments, and more.

By default, bundles are minified:

```js
eleventyConfig.addPlugin(yetiPlugin, {
  js: {
    defaultBundleTransformConfig: {
      minify: false,
    },
  },
});
```

#### `js.deriveBundleTransformConfig`

Function to derive custom esbuild transform options on a per-bundle basis. This function is called with the bundle name and the default transform config, and should return the config to use for that bundle.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  js: {
    deriveBundleTransformConfig: (bundleName, defaultConfig) => {
      if (bundleName === "vendor") {
        return { ...defaultConfig, minify: false };
      }
      return defaultConfig;
    },
  },
});
```

#### `js.externalDependencies`

Configure dependencies that should be bundled separately from your application code.
Instead of duplicating dependency code in every bundle that uses it, each external dependency
is bundled once into its own file, and imports are rewritten to reference that file.

Keys are glob patterns matched against import specifiers. Values determine where the bundled output is written:
- **File path** (no trailing `/`): The dependency is bundled into a single file at that path.
  If the pattern matches more than one specifier, an error is thrown.
- **Directory path** (trailing `/`): All matched specifiers are built together with esbuild
  code splitting. Each specifier gets its own entry file in the directory, with shared code
  extracted into chunk files.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  js: {
    externalDependencies: {
      // Single specifier -> single file
      "alpinejs": "/js/ext/alpine.js",
      // Multiple specifiers -> code-split output directory
      "{lit,lit/**}": "/js/ext/",
    },
  },
});
```

### `css`

The plugin offers some options for customizing how bundled CSS assets are processed and output.

#### `css.deriveBundleFilePath`

Function to derive custom file paths that external CSS bundle files should be written to.
This function will be called for each bundle with the bundle name, and should return a string representing
the path relative to the site's root where the bundle should be written.
Defaults to `` `/css/${bundleName}.css` ``.

Leading slashes are optional.
Note that this does not run for the special page-scoped `"@page"` bundle; see [`css.derivePageBundleFilePath`](#cssderivepagebundlefilepath).

```js
eleventyConfig.addPlugin(yetiPlugin, {
  css: {
    // Bundle files should go in the "assets/css" directory with a `.bundle.css` suffix
    deriveBundleFilePath: (bundleName) => `assets/css/${bundleName}.bundle.css`,
  },
});
```

#### `css.derivePageBundleFilePath`

Function to derive the file path where each page's `@page` CSS bundle should be written. The function
receives the page's `EleventyPageData["page"]` object (with `inputPath`, `fileSlug`, `url`, etc.) and
should return a string representing the path relative to the site's root.

By default, the path is derived from the page template's `inputPath`, stripping the input dir prefix
and the page template extension, then prepending `/css/_pages/` and appending `.css`. For example,
with input dir `src` and template extension `page.ts`, `src/blog/post.page.ts` becomes
`/css/_pages/blog/post.css`.

This deriver is called once per page template (pagination variants of the same template share a
bundle file). The path returned must be unique per template — otherwise pages with the same derived
path will overwrite each other.

> [!IMPORTANT]
> Derive the path only from **template-constant** fields (`inputPath`, `fileSlug`, `filePathStem`).
> Pagination variants of one template share a single `@page` bundle file, so a deriver that keys off
> a **per-page** field (`url`, `outputPath`, `date`) makes each variant reference a different path
> while only one file is written — the other variants then 404. Yeti logs a warning if it detects
> this, but it's safest to never key off per-page fields here. (`fileSlug` is the *template's* slug,
> which is constant across pagination variants, so the example below is safe.)

```js
eleventyConfig.addPlugin(yetiPlugin, {
  css: {
    // Flatten bundles into one dir keyed by the template's file slug (constant across pagination)
    derivePageBundleFilePath: (page) => `/css/pages/${page.fileSlug}.css`,
  },
});
```

#### `css.defaultBundleTransformConfig`

Default [lightningcss transform options](https://lightningcss.dev/docs.html) to use when processing CSS bundles. This allows you to specify custom lightningcss options like minification, browser targets, and more.

By default, bundles are minified:

```js
eleventyConfig.addPlugin(yetiPlugin, {
  css: {
    defaultBundleTransformConfig: {
      minify: false,
    },
  },
});
```

#### `css.deriveBundleTransformConfig`

Function to derive custom lightningcss transform options on a per-bundle basis. This function is called with the bundle name and the default transform config, and should return the config to use for that bundle.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  css: {
    deriveBundleTransformConfig: (bundleName, defaultConfig) => {
      if (bundleName === "critical") {
        return { ...defaultConfig, minify: true };
      }
      return defaultConfig;
    },
  },
});
```

### `html`

The plugin offers some options for customizing how page HTML output and bundled HTML assets are processed.

#### `html.minify`

Boolean indicating whether the page HTML output should be minified.
`true` by default.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  html: {
    minify: false,
  },
});
```

#### `html.deriveBundleFilePath`

Function to derive custom file paths for where external HTML bundle files should be written.
This function will be called for each bundle with the bundle name, and should return a string representing
the path relative to the site's root where the bundle should be written.
Defaults to `` `/html/${bundleName}.html` ``.

Leading slashes are optional.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  html: {
    // "spritesheet" bundle should get a `.svg` extension instead of the default `.html`
    deriveBundleFilePath: (bundleName) =>
      bundleName === "spritesheet" ? `/icons/spritesheet.svg` : `/html/${bundleName}.html`,
  },
});
```

#### `html.derivePageBundleFilePath`

Function to derive the file path where each page's `@page` HTML bundle should be written. The function
receives the page's `EleventyPageData["page"]` object and should return a string representing the
path relative to the site's root.

By default, the path is derived from the page template's `inputPath`, stripping the input dir prefix
and the page template extension, then prepending `/html/_pages/` and appending `.html`. For example,
`src/blog/post.page.ts` becomes `/html/_pages/blog/post.html`.

> [!IMPORTANT]
> Derive the path only from **template-constant** fields (`inputPath`, `fileSlug`, `filePathStem`),
> never **per-page** fields (`url`, `outputPath`, `date`) — pagination variants share one `@page`
> bundle file, so a per-page-keyed deriver leaves some variants referencing a path that 404s. Yeti
> warns if it detects this.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  html: {
    derivePageBundleFilePath: (page) => `/html/pages/${page.fileSlug}.html`,
  },
});
```

#### `html.defaultBundleTransformConfig`

Default transform config to use when processing HTML bundles. This includes a `minify` boolean and an optional `processNodeTree` function.

The `processNodeTree` function receives the parsed Yeti node tree for a bundle and can transform it before the bundle is inserted into the final output. This is useful for transformations like converting `<svg>` elements into `<symbol>` elements for SVG sprite generation.

```ts
import { YETI_NODE_TYPE, yetiPlugin } from 'yeti-js';

eleventyConfig.addPlugin(yetiPlugin, {
  html: {
    defaultBundleTransformConfig: {
      minify: true,
      processNodeTree: (rootNode) => {
        // Transform each <svg> element into a <symbol> for sprite usage
        for (const child of rootNode.children) {
          if (child.type === YETI_NODE_TYPE.ELEMENT && child.tagName === 'svg') {
            child.tagName = 'symbol';
          }
        }
        return rootNode;
      },
    },
  },
});
```

#### `html.deriveBundleTransformConfig`

Function to derive custom HTML transform config on a per-bundle basis. This function is called with the bundle name and the default transform config, and should return the config to use for that bundle.

This is particularly useful when you only want to apply `processNodeTree` transformations to specific bundles:

```ts
import { YETI_NODE_TYPE, yetiPlugin } from 'yeti-js';

eleventyConfig.addPlugin(yetiPlugin, {
  html: {
    deriveBundleTransformConfig: (bundleName, defaultConfig) => {
      if (bundleName === "svg-sprites") {
        return {
          ...defaultConfig,
          processNodeTree: (rootNode) => {
            for (const child of rootNode.children) {
              if (child.type === YETI_NODE_TYPE.ELEMENT && child.tagName === 'svg') {
                child.tagName = 'symbol';
                if (child.attributes?.xmlns) {
                  delete child.attributes.xmlns;
                }
              }
            }
            return rootNode;
          },
        };
      }
      return defaultConfig;
    },
  },
});
```

#### `html.processImport`

Hook to apply custom processing to the raw content of directly imported files (i.e. `html.import()` calls without a `bundleName`). Called with the resolved file path and raw file content string before the content is parsed as HTML.

This is useful for pre-processing files in formats other than HTML, such as Markdown:

```ts
import { parseMarkdown, yetiPlugin } from 'yeti-js';

eleventyConfig.addPlugin(yetiPlugin, {
  html: {
    processImport: async (importPath, content) => {
      if (importPath.endsWith('.md')) {
        return parseMarkdown(content);
      }
      return content;
    },
  },
});
```
