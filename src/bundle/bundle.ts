import { YETI_NODE_TYPE, type YetiElementNode } from "../html/types.ts";
import { BundleError } from "../error.ts";
import { getConfig } from "../config.ts";

// Reserved Wildcard bundle name that can be used to indicate a spot where all used bundles on a page
// which are not referenced anywhere else should be placed.
export const WILDCARD_BUNDLE_NAME = "*";

export const BUNDLE_TYPE = Symbol("YETI_BUNDLE_TYPE");

export type AssetType = "html" | "css" | "js";
export type BundleType = "start" | "import" | "inline" | "src";

export interface BaseBundleObject<TAssetType extends AssetType, TBundleType extends BundleType> {
  /**
   * The type of this bundle, indicating whether it is marking the
   * start of a new bundle or importing an external file into a bundle.
   */
  [BUNDLE_TYPE]: TBundleType;
  assetType: TAssetType;
}

// Bundle start objects can only be used in css and js templates
export type BundleStartAssetType = "css" | "js";

interface BundleStartObject<TAssetType extends BundleStartAssetType, TBundleName extends string = string> extends BaseBundleObject<TAssetType, "start"> {
  /**
   * The name of the bundle being started. All contents following this marker
   * will be placed into that bundle until otherwise specified.
   */
  bundleName: TBundleName;
}

export interface CSSBundleStartObject<TBundleName extends string> extends BundleStartObject<"css", TBundleName> { }
export interface JSBundleStartObject<TBundleName extends string> extends BundleStartObject<"js", TBundleName> { }

type AnyBundleStartObject = CSSBundleStartObject<string> | JSBundleStartObject<string>;

export const makeBundleStartObject = <TAssetType extends BundleStartAssetType, TBundleName extends string>(assetType: TAssetType, bundleName: TBundleName): BundleStartObject<TAssetType, TBundleName> => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new BundleError(`Attempted to create bundle with reserved wildcard name "${WILDCARD_BUNDLE_NAME}".`);
  }

  return ({
    [BUNDLE_TYPE]: "start",
    assetType,
    bundleName,
  })
};

/**
 * Object marking a place in an HTML template where a bundle's contents should be inlined into the HTML.
 */
export interface BundleInlineObject<TAssetType extends AssetType = AssetType, TBundleName extends string = string> extends BaseBundleObject<TAssetType, "inline"> {
  /**
   * The name of the bundle that this inline content belongs to.
   */
  bundleName: TBundleName;
}

export const makeBundleInlineObject = <TAssetType extends AssetType, TBundleName extends string>(assetType: TAssetType, bundleName: TBundleName): BundleInlineObject<TAssetType, TBundleName> => ({
  [BUNDLE_TYPE]: "inline",
  assetType,
  bundleName,
});

export const INLINED_BUNDLE_ELEMENT_TAG_NAME = "---INLINED-BUNDLE---";
/**
 * Special element node used as a placeholder for where inlined bundle content should be
 * placed in a final processing step after HTML parsing.
 */
export interface BundleInlineElementNode extends YetiElementNode {
  tagName: typeof INLINED_BUNDLE_ELEMENT_TAG_NAME;
  attributes: {
    bundleName: string;
    assetType: AssetType;
  };
}

export const makeBundleInlineElementNode = (bundleName: string, assetType: AssetType): BundleInlineElementNode => ({
  type: YETI_NODE_TYPE.ELEMENT,
  tagName: INLINED_BUNDLE_ELEMENT_TAG_NAME,
  attributes: {
    bundleName,
    assetType,
  },
});

export const isInlinedBundleElementNode = (node: YetiElementNode): node is BundleInlineElementNode => {
  return node.tagName === INLINED_BUNDLE_ELEMENT_TAG_NAME &&
    typeof node.attributes?.bundleName === "string" &&
    (node.attributes.assetType === "html" || node.attributes.assetType === "css" || node.attributes.assetType === "js");
};

/**
 * Object marking a place in an HTML template which should be replaced by a string pointing to an external bundle file.
 */
export interface BundleSrcObject<TAssetType extends AssetType, TBundleName extends string = string> extends BaseBundleObject<TAssetType, "src"> {
  /**
   * The name of the bundle which should be written to an external file and whose file path should be placed at this location in the HTML.
   */
  bundleName: TBundleName;
}

export const makeBundleSrcObject = <TAssetType extends AssetType, TBundleName extends string>(assetType: TAssetType, bundleName: TBundleName): BundleSrcObject<TAssetType, TBundleName> => ({
  [BUNDLE_TYPE]: "src",
  assetType,
  bundleName,
});

interface BundleImportObject<TAssetType extends AssetType> extends BaseBundleObject<TAssetType, "import"> {
  /**
   * The resolved absolute path to the imported external file.
   */
  importPath: string;
  /**
   * The name of the bundle that the contents of the imported file
   * should be placed into. If not specified, the contents will be
   * placed into the current active bundle, or in the case of HTML,
   * the HTML contents will be inserted in place of the import statement
   * without bundling.
   */
  bundleName?: string;
}

export interface HTMLBundleImportObject extends BundleImportObject<"html"> {
  /**
   * Additional options for how the imported HTML contents should be processed.
   */
  options?: {
    /**
     * Specifies whether the imported HTML content should be treated as text content
     * and escaped before being inserted into the document.
     * This may be useful if you just want to import raw text content from an external file
     * and display it.
     *
     * @default false
     */
    shouldEscape?: boolean;
  }
}
export interface CSSBundleImportObject extends BundleImportObject<"css"> { }
export interface JSBundleImportObject extends BundleImportObject<"js"> { }

type AnyBundleImportObject = HTMLBundleImportObject | CSSBundleImportObject | JSBundleImportObject;

export const makeBundleImportObject = <TAssetType extends AssetType>(assetType: TAssetType, importPath: string, bundleName?: string, options?: TAssetType extends "html" ? HTMLBundleImportObject["options"] : never): BundleImportObject<TAssetType> => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new BundleError(`Attempted to import into bundle with reserved wildcard name "${WILDCARD_BUNDLE_NAME}".`);
  }

  const importObject: BundleImportObject<TAssetType> = {
    [BUNDLE_TYPE]: "import",
    assetType,
    importPath,
    bundleName,
  };
  if (assetType === "html" && options) {
    (importObject as HTMLBundleImportObject).options = options;
  }
  return importObject;
};

type AnyBundleObject = AnyBundleStartObject | AnyBundleImportObject | BundleInlineObject<AssetType, string> | BundleSrcObject<AssetType, string>;

export const isBundleObject = (obj: unknown): obj is AnyBundleObject => {
  return typeof obj === "object" && obj !== null && BUNDLE_TYPE in obj;
};

export const isBundleStartObject = <TAssetType extends BundleStartAssetType = BundleStartAssetType>(obj: unknown, assetType?: TAssetType): obj is BundleStartObject<TAssetType> => {
  return isBundleObject(obj) && obj[BUNDLE_TYPE] === "start" && (assetType === undefined || obj.assetType === assetType);
};

export const isBundleImportObject = <TAssetType extends AssetType = AssetType>(obj: unknown, assetType?: TAssetType): obj is Extract<AnyBundleImportObject, { assetType: TAssetType }> => {
  return isBundleObject(obj) && obj[BUNDLE_TYPE] === "import" && (assetType === undefined || obj.assetType === assetType);
};

export const isBundleInlineObject = <TAssetType extends AssetType = AssetType>(obj: unknown, assetType?: TAssetType): obj is BundleInlineObject<TAssetType> => {
  return isBundleObject(obj) && obj[BUNDLE_TYPE] === "inline" && (assetType === undefined || obj.assetType === assetType);
};

export const isBundleSrcObject = <TAssetType extends AssetType = AssetType>(obj: unknown, assetType?: TAssetType): obj is BundleSrcObject<TAssetType> => {
  return isBundleObject(obj) && obj[BUNDLE_TYPE] === "src" && (assetType === undefined || obj.assetType === assetType);
};

export const getExternalBundleFilePath = (bundleName: string, assetType: AssetType): string => {
  return getConfig()[assetType].deriveBundleFilePath(bundleName);
}