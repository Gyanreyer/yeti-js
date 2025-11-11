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

### Plugin Config

The plugin supports some optional config options for customization of the build output:

#### `pageTemplateFileExtension`

This allows you to configure the file extension to use to identify any Yeti page files which should be processed by the plugin and output as pages in the built site.
By default, this extension will be `.page.js`.

For example, if our input directory is `src` and our output is `dist`, the plugin will process `src/index.page.js` and write the output to `dist/index.html`.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  pageTemplateFileExtension: ".yeti.js",
});
```

### `js`

The plugin offers some options for customizing how bundled JavaScript assets are processed and output.

#### `js.minify`

Boolean indicating whether bundled JavaScript assets should be minified.
`true` by default.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  js: {
    minify: false,
  }
});
```

#### `js.sourceMaps`

Boolean indicating whether we should also generate a sourcemap for all bundled minified JavaScript assets.
This setting will be ignored and sourcemaps will not be emitted if `js.minify` is set to `false`.
`false` by default.


```js
eleventyConfig.addPlugin(yetiPlugin, {
  js: {
    sourceMaps: true,
  },
})
```

#### `js.outputDir`

String indicating the directory that bundled JavaScript assets should be written to relative to the site's root.
Defaults to `"/js"`.

For example, setting `"/scripts"` as the JS output directory means that the `default` JavaScript bundle will be served from `https://my-url.com/scripts/default.js`.

Note that leading and trailing slashes are optional.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  js: {
    outputDir: "/scripts",
  },
});
```

#### `js.defaultBundleName`

String indicating the default bundle name to gather JS assets into unless another bundle name is specified.
Defaults to `"scripts"`.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  js: {
    defaultBundleName: "default",
  },
});
```

### `css`

The plugin offers some options for customizing how bundled CSS assets are processed and output.

#### `css.minify`

Boolean indicating whether bundled CSS assets should be minified.
`true` by default.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  css: {
    minify: false,
  },
});
```

#### `css.sourceMaps`

Boolean indicating whether we should also generate a sourcemap for all bundled minified CSS assets.
This setting will be ignored and sourcemaps will not be emitted if `css.minify` is set to `false`.
`false` by default.


```js
eleventyConfig.addPlugin(yetiPlugin, {
  css: {
    sourceMaps: true,
  },
})
```

#### `css.outputDir`

String indicating the directory that bundled CSS assets should be written to relative to the site's root.
Defaults to `"/css"`.

For example, setting `"/styles"` as the CSS output directory means that the `home` CSS bundle will be served from `https://my-url.com/styles/home.css`.

Note that leading and trailing slashes are optional.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  css: {
    outputDir: "/styles",
  },
});
```

#### `css.defaultBundleName`

String indicating the default bundle name to gather CSS assets into unless another bundle name is specified.
Defaults to `"styles"`.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  css: {
    defaultBundleName: "default",
  },
});
```

## Authoring a Yeti Component

Yeti uses [HTM](https://github.com/developit/htm) to allow you to write components with a JSX-like syntax in an `html` tagged template string.

```ts
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

Unfortunately, at this time `<!DOCTYPE>` tags will cause things to break in weird ways due to
a choice by HTM to not support them. I am considering forking HTM to fix that, but
it is just a known quirk for now. A `<!DOCTYPE>` tag will be automatically inserted at the top
of every page built with this plugin regardless.

### Page components

Every page file must expose the page component as a default export.
Each page component will automatically receive props with some 11ty data:

```ts
type EleventyPageData = {
  eleventy: {
    version: string;
    generator: string;
    env: {
      source: string;
      runMode: string;
      config: string;
      root: string;
    };
    directories: {
      input: string;
      data: string;
      includes: string;
      layouts: string;
      output: string;
    }
  };
  page: {
    inputPath: string;
    fileSlug: string;
    filePathStem: string;
    templateSyntax: string;
    date: Date;
    url: string;
    outputPath: string;
  };
  collections: Record<string, any>;
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

  ${css.bundle("default")}
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
