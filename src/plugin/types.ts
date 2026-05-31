import type { YetiChildNode, YetiRootNode } from "../html/types.ts";
import type { CSSTemplateResult } from "../css/css.ts";
import type { JSTemplateResult } from "../js/js.ts";

/**
 * Per-page metadata supplied by Eleventy: the `page` subobject of `EleventyPageData`.
 * This is what user-supplied page-bundle path derivers receive; surrounding context
 * (`pagination`, `collections`, etc.) is intentionally excluded both because those fields
 * contain circular references that don't survive build-cache JSON serialization, and
 * because the values we need to derive paths from (`inputPath`, `url`, `fileSlug`, etc.)
 * all live on the `page` subobject.
 */
export type PageContext = {
  inputPath: string;
  fileSlug: string;
  filePathStem: string;
  templateSyntax: string;
  date: Date;
  url: string;
  outputPath: string;
};

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
  page: PageContext;
  collections: Record<string, any>;
};

export type YetiComponentProps<TCustomProps extends Record<string, unknown>> = TCustomProps & {
  children: YetiChildNode[];
}

export type YetiComponentAssetMetadata = {
  css?: CSSTemplateResult;
  js?: JSTemplateResult;
}

export type YetiComponent<TProps extends Record<string, unknown> = {}> = ((props: YetiComponentProps<TProps>) => unknown | Promise<unknown>) & YetiComponentAssetMetadata;

export type YetiPageComponent<TCustomData extends Record<string, unknown> = {}> = ((props: EleventyPageData & TCustomData) => Promise<YetiRootNode>) & YetiComponentAssetMetadata