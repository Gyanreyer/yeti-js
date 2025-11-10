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
Defaults to `/js`.

For example, setting `/scripts` as the JS output directory means that the `default` JavaScript bundle will be served from `https://my-url.com/scripts/default.js`.


```js
eleventyConfig.addPlugin(yetiPlugin, {
  js: {
    outputDir: "/scripts",
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
Defaults to `/css`.

For example, setting `/styles` as the CSS output directory means that the `default` CSS bundle will be served from `https://my-url.com/styles/default.css`.

```js
eleventyConfig.addPlugin(yetiPlugin, {
  css: {
    outputDir: "/styles",
  },
});
```
