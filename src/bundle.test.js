import { describe, test } from 'node:test';
import { bundle, bundleNameSymbol, importFilePathSymbol } from './bundle.js';
import { getConfig, updateConfig } from './config.js';

describe('bundle module', () => {
  test('bundle() throws on wildcard', async ({
    assert,
  }) => {
    assert.throws(() => bundle("*"), new Error('bundle() called with reserved wildcard bundle name "*"'));
  });

  test("bundle() returns correctly formed bundle descriptor object", async ({ assert }) => {
    assert.deepEqual(
      bundle("my-bundle"),
      {
        [bundleNameSymbol]: "my-bundle",
      },
      "bundle() should return correct bundle object",
    );
  });

  test("bundle() uses default bundle name when none provided", async ({ assert }) => {
    assert.deepEqual(
      bundle(),
      {
        [bundleNameSymbol]: "default",
      },
      "bundle() should return correct bundle object with default name",
    );
  });

  test('bundle.import() throws on wildcard', async ({ assert }) => {
    assert.throws(() => bundle.import("some/path", "*"), new Error('bundle.import() called with reserved wildcard bundle name "*"'));
  });

  test("bundle.import() resolves file URL paths as expected", async ({ assert }) => {
    assert.deepEqual(
      bundle.import("file:///some/path.js"),
      {
        [importFilePathSymbol]: "/some/path.js",
        [bundleNameSymbol]: "default",
      },
      "bundle.import() should return bundle import object with correctly resolved file path",
    );
  });

  test("bundle.import() resolves absolute paths relative to config's input dir", async ({ assert, after }) => {
    // Hang onto the current config to restore after the test
    const prevConfig = structuredClone(getConfig());
    updateConfig({
      inputDir: "src",
    });

    assert.deepEqual(
      bundle.import("/some/path.js"),
      {
        [importFilePathSymbol]: "/src/some/path.js",
        [bundleNameSymbol]: "default",
      },
      "bundle.import() should return bundle import object with the absolute path resolved relative to the config's inputDir",
    );

    // Restore the config to its previous state
    updateConfig(prevConfig);
  });

  test("bundle.import() resolves relative paths as expected", async ({ assert }) => {
    assert.deepEqual(
      bundle.import("./path.js", "my-bundle"),
      {
        [bundleNameSymbol]: "my-bundle",
        [importFilePathSymbol]: `${import.meta.dirname}/path.js`,
      },
      "bundle.import() should return bundle import object with the relative path resolved relative to the file it was called from",
    );
  });
});