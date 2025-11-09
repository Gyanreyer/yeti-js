export type YetiConfig = {
  /**
   * The directory where the site's source files are located.
   * You should not need to set this directly as we will infer it from your 11ty project.
   */
  inputDir: string;
  /**
   * The directory where the built site will be output.
   * You should not need to set this directly as we will infer it from your 11ty project.
   */
  outputDir: string;
  /**
   * Config for JavaScript bundling and output.
   */
  js: {
    /**
     * Whether to minify processed JavaScript bundles.
     * @default true
     */
    minify: boolean;
    /**
     * Whether to generate source maps for processed JavaScript bundles.
     * @default false
     */
    sourceMaps: boolean;
    /**
     * The directory relative to the site's outputDir where JavaScript bundles will be written.
     * For example, if the site's outputDir is "dist" and `js.outputDir` is "assets/js", JavaScript bundles will be written to "dist/assets/js".
     * @default "js"
     */
    outputDir: string;
  };
  css: {
    /**
     * Whether to minify processed CSS bundles.
     * @default true
     */
    minify: boolean;
    /**
     * Whether to generate source maps for processed CSS bundles.
     * @default false
     */
    sourceMaps: boolean;
    /**
     * The directory relative to the site's outputDir where CSS bundles will be written.
     * For example, if the site's outputDir is "dist" and `css.outputDir` is "assets/css", CSS bundles will be written to "dist/assets/css".
     * @default "css"
     */
    outputDir: string;
  }
  /**
   * The file extension used for Yeti page template files.
   * @default ".page.js"
   */
  pageTemplateFileExtension: string;
}

export type RenderResult = {
  html: string;
  cssBundles: {
    [bundleName: string]: Set<string>;
  };
  cssDependencies: Set<string>;
  jsBundles: {
    [bundleName: string]: Set<string>;
  };
  jsDependencies: Set<string>;
  htmlDependencies: Set<string>;
};

export type CSSResult = {
  cssBundles: {
    [bundleName: string]: string;
  };
  cssDependencies: Set<string>;
};

export type JSResult = {
  jsBundles: {
    [bundleName: string]: string;
  };
  jsDependencies: Set<string>;
};

export type Children = unknown[];

type YetiComponentMetadata = {
  css?: () => CSSResult;
  js?: () => JSResult;
}

export type YetiComponentProps = {
  [key: string]: typeof key extends "children" ? never : unknown;
}

type YetiComponentFunction<TProps extends YetiComponentMetadata> = (data: TProps & {
  children: Children | undefined;
}) => RenderResult | RenderResult[];

export type YetiComponent<TProps extends YetiComponentProps> = YetiComponentFunction<TProps> & YetiComponentMetadata;

export type EleventyPageData = {
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

type YetiPageComponentFunction<TData extends Record<string, any>> = (data: TData & EleventyPageData) => RenderResult | RenderResult[];

export type YetiPageComponent<TData extends Record<string, any> = {}> = YetiPageComponentFunction<TData & EleventyPageData> & YetiComponentMetadata;