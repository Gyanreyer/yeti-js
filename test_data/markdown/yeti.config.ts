import type { PartialYetiConfig } from "../../src/index.ts";
import { parseMarkdown } from "../../src/index.ts";

const config: PartialYetiConfig = {
  html: {
    minify: false,
    defaultBundleTransformConfig: {
      minify: false,
    },
    processImport(importPath, content) {
      if (importPath.endsWith(".md")) {
        return parseMarkdown(content);
      }
      return content;
    }
  }
}

export default config;