import type { PartialYetiConfig } from "../../src/index.ts";
import { parseMarkdown } from "../../src/index.ts";

const config: PartialYetiConfig = {
  html: {
    processImport(importPath, content) {
      if (importPath.endsWith(".md")) {
        return parseMarkdown(content);
      }
      return content;
    }
  }
}