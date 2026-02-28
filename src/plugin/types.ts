import type { YetiChildNode, YetiRootNode } from "../html/types.ts";
import type { CSSTemplateResult } from "../css/css.ts";
import type { JSTemplateResult } from "../js/js.ts";

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

export type YetiComponentProps<TCustomProps extends Record<string, unknown>> = TCustomProps & {
  children: YetiChildNode[];
}

export type YetiComponentAssetMetadata = {
  css?: CSSTemplateResult;
  js?: JSTemplateResult;
}

export type YetiComponent<TProps extends Record<string, unknown> = {}> = ((props: YetiComponentProps<TProps>) => unknown | Promise<unknown>) & YetiComponentAssetMetadata;

export type YetiPageComponent<TCustomData extends Record<string, unknown> = {}> = ((props: EleventyPageData & TCustomData) => Promise<YetiRootNode>) & YetiComponentAssetMetadata