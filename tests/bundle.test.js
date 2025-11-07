import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { getConfig, updateConfig } from '../src/config.js';
import { bundle, bundleNameSymbol, importFilePathSymbol, shouldEscapeHTMLSymbol } from '../src/bundle.js';

describe('bundle module', () => {
  test('bundle() throws on wildcard', ({
    assert,
  }) => {
    assert.throws(() => bundle("*"), new Error('bundle() called with reserved wildcard bundle name "*"'));
  });

  test("bundle() returns correctly formed bundle descriptor object", ({ assert }) => {
    assert.deepEqual(
      bundle("my-bundle"),
      {
        [bundleNameSymbol]: "my-bundle",
      },
      "bundle() should return correct bundle object",
    );
  });

  test("bundle() uses default bundle name when none provided", ({ assert }) => {
    assert.deepEqual(
      bundle(),
      {
        [bundleNameSymbol]: "default",
      },
      "bundle() should return correct bundle object with default name",
    );
  });

  test('bundle.import() throws on wildcard', ({ assert }) => {
    assert.throws(() => bundle.import("some/path", "*"), new Error('bundle.import() called with reserved wildcard bundle name "*"'));
  });

  test("bundle.import() resolves file URL paths as expected", ({ assert }) => {
    assert.deepEqual(
      bundle.import("file:///some/path.js"),
      {
        [importFilePathSymbol]: "/some/path.js",
        [bundleNameSymbol]: "default",
      },
      "bundle.import() should return bundle import object with correctly resolved file path",
    );
  });

  test("bundle.import() resolves absolute paths relative to config's input dir", ({ assert, after }) => {
    // Hang onto the current config to restore after the test
    const prevConfig = structuredClone(getConfig());
    const inputDir = fileURLToPath(import.meta.resolve("../../src"));
    updateConfig({
      inputDir,
    });

    assert.deepEqual(
      bundle.import("/some/path.js"),
      {
        [importFilePathSymbol]: `${inputDir}/some/path.js`,
        [bundleNameSymbol]: "default",
      },
      "bundle.import() should return bundle import object with the absolute path resolved relative to the config's inputDir",
    );

    // Restore the config to its previous state
    updateConfig(prevConfig);
  });

  test("bundle.import() resolves relative paths as expected", ({ assert }) => {
    assert.deepEqual(
      bundle.import("./path.js", "my-bundle"),
      {
        [bundleNameSymbol]: "my-bundle",
        [importFilePathSymbol]: `${import.meta.dirname}/path.js`,
      },
      "bundle.import() should return bundle import object with the relative path resolved relative to the file it was called from",
    );
  });

  test("bundle.importHTML() resolves relative paths as expected", ({ assert }) => {
    assert.deepEqual(
      bundle.importHTML("./path.html"),
      {
        [importFilePathSymbol]: `${import.meta.dirname}/path.html`,
        [shouldEscapeHTMLSymbol]: false,
      },
      "bundle.importHTML() should return bundle HTML import object with the relative path resolved relative to the file it was called from",
    );

    assert.deepEqual(
      bundle.importHTML("./other-path.html", true),
      {
        [importFilePathSymbol]: `${import.meta.dirname}/other-path.html`,
        [shouldEscapeHTMLSymbol]: true,
      },
      "bundle.importHTML() should return bundle HTML import object with the relative path resolved relative to the file it was called from",
    );
  });

  test("bundle.src() creates a placeholder src string as expected", ({ assert }) => {
    const result = bundle.src("my-bundle");
    assert.equal(
      result,
      "@bundle/my-bundle",
      "bundle.src() should return the correctly prefixed bundle src placeholder",
    );
  });

  test("bundle.inline() creates a comment placeholder for inlining bundles as expected", ({ assert }) => {
    const result = bundle.inline("my-bundle");
    assert.equal(
      result,
      "/*@--BUNDLE--my-bundle--@*/",
      "bundle.inline() should return the correctly formatted bundle inline placeholder comment",
    );
  });
});