import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getCallSites } from "node:util";
import { getConfig } from "../config.js";

const FILE_URL_PREFIX = "file://";

export const resolveImportPath = (importPath: string): string => {
  if (importPath.startsWith(FILE_URL_PREFIX)) {
    return fileURLToPath(importPath);
  }

  if (importPath.startsWith("/")) {
    const { inputDir } = getConfig();
    // Absolute path starting with "/" should be resolved relative to the input directory
    return resolve(inputDir, `.${importPath}`);
  }

  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    // Relative path should be resolved relative to the caller file's directory
    const callSites = getCallSites();
    const callerDirname = dirname(
      // Need to go up two levels; first is this resolveImportPath function,
      // second is the import() method calling this,
      // third is the file which called import() which we're interested in.
      fileURLToPath(callSites[2].scriptName),
    );
    return resolve(callerDirname, importPath);
  }

  return fileURLToPath(import.meta.resolve(importPath));
};