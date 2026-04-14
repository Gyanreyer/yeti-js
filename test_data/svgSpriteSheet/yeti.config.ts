import { type PartialYetiConfig, YETI_NODE_TYPE, type YetiRootNode, type YetiElementNode, type HTMLBundleTransformConfig } from "../../src/index.ts";

const config: PartialYetiConfig = {
  html: {
    minify: false,
    deriveBundleFilePath: (bundleName: string) => {
      if (bundleName === "icons") {
        return "/assets/icons.svg";
      }

      return `/html/${bundleName}.html`;
    },
    defaultBundleTransformConfig: {
      minify: false,
    },
    deriveBundleTransformConfig: (bundleName: string, defaultConfig: HTMLBundleTransformConfig) => {
      if (bundleName === "icons") {
        return {
          ...defaultConfig,
          processNodeTree: (rawRootNode: YetiRootNode) => {
            const defsElement: YetiElementNode = {
              type: YETI_NODE_TYPE.ELEMENT,
              tagName: "defs",
              attributes: {},
              children: [],
            };

            for (const childNode of rawRootNode.children) {
              if (childNode.type === YETI_NODE_TYPE.ELEMENT && childNode.tagName === "svg") {
                defsElement.children!.push({
                  type: YETI_NODE_TYPE.ELEMENT,
                  tagName: "symbol",
                  attributes: {
                    viewBox: childNode.attributes?.viewBox,
                    id: childNode.attributes?.id,
                  },
                  children: childNode.children,
                });
              }
            }

            return {
              type: YETI_NODE_TYPE.ROOT,
              children: [{
                type: YETI_NODE_TYPE.ELEMENT,
                tagName: "svg",
                attributes: {
                  xmlns: "http://www.w3.org/2000/svg",
                },
                children: [defsElement],
              }],
            };
          },
        };
      }

      return defaultConfig;
    },
  },
}

export default config;