import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { mergeConfigs, validateConfig } from "./config.ts";
import { YetiConfigError } from "./error.ts";

describe("validateConfig", () => {
  test("accepts an empty config", () => {
    assert.doesNotThrow(() => validateConfig({}));
  });

  test("accepts a fully valid partial config", () => {
    assert.doesNotThrow(() =>
      validateConfig({
        pageTemplateFileExtension: ["page.js", "page.ts"],
        js: {
          deriveBundleFilePath: (name) => `/js/${name}.js`,
          derivePageBundleFilePath: (page) => `/js/_pages/${page.fileSlug}.js`,
          deriveBundleTransformConfig: (_name, config) => config,
          defaultBundleTransformConfig: { minify: true },
          externalDependencies: { alpinejs: "/js/ext/alpine.js" },
        },
        css: {
          deriveBundleFilePath: (name) => `/css/${name}.css`,
          derivePageBundleFilePath: (page) => `/css/_pages/${page.fileSlug}.css`,
          deriveBundleTransformConfig: (_name, config) => config,
          defaultBundleTransformConfig: { minify: false },
        },
        html: {
          minify: false,
          deriveBundleFilePath: (name) => `/html/${name}.html`,
          derivePageBundleFilePath: (page) => `/html/_pages/${page.fileSlug}.html`,
          deriveBundleTransformConfig: (_name, config) => config,
          defaultBundleTransformConfig: { minify: true },
          processImport: (_path, content) => content,
        },
      })
    );
  });

  test("accepts pageTemplateFileExtension as a single string", () => {
    assert.doesNotThrow(() =>
      validateConfig({ pageTemplateFileExtension: "page.js" })
    );
  });

  test("accepts pageTemplateFileExtension as an array of strings", () => {
    assert.doesNotThrow(() =>
      validateConfig({ pageTemplateFileExtension: ["page.js", "page.ts"] })
    );
  });

  test("accepts internal-only fields (inputDir, outputDir, quietMode)", () => {
    assert.doesNotThrow(() =>
      validateConfig({
        inputDir: "/some/path",
        outputDir: "/some/other/path",
        quietMode: true,
      })
    );
  });

  // --- pageTemplateFileExtension ---

  test("rejects pageTemplateFileExtension with wrong type", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ pageTemplateFileExtension: 123 }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /pageTemplateFileExtension/);
        assert.match(err.message, /string or array of strings/);
        return true;
      }
    );
  });

  test("rejects empty string for pageTemplateFileExtension", () => {
    assert.throws(
      () => validateConfig({ pageTemplateFileExtension: "" }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /pageTemplateFileExtension/);
        return true;
      }
    );
  });

  test("rejects empty string inside pageTemplateFileExtension array", () => {
    assert.throws(
      () => validateConfig({ pageTemplateFileExtension: ["page.js", ""] }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /pageTemplateFileExtension\[1\]/);
        return true;
      }
    );
  });

  test("rejects pageTemplateFileExtension with a leading dot", () => {
    assert.throws(
      () => validateConfig({ pageTemplateFileExtension: ".page.js" }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /pageTemplateFileExtension/);
        assert.match(err.message, /leading dot/);
        return true;
      }
    );
  });

  test("rejects leading dot inside pageTemplateFileExtension array", () => {
    assert.throws(
      () => validateConfig({ pageTemplateFileExtension: ["page.js", ".page.ts"] }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /pageTemplateFileExtension\[1\]/);
        assert.match(err.message, /leading dot/);
        return true;
      }
    );
  });

  // --- js ---

  test("rejects js as a non-object", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ js: "bad" }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /"js" config must be an object/);
        return true;
      }
    );
  });

  test("rejects js.derivePageBundleFilePath as non-function", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ js: { derivePageBundleFilePath: "/some/path" } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /js\.derivePageBundleFilePath/);
        assert.match(err.message, /function/);
        return true;
      }
    );
  });

  test("rejects js.deriveBundleFilePath as non-function", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ js: { deriveBundleFilePath: "/some/path" } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /js\.deriveBundleFilePath/);
        assert.match(err.message, /function/);
        return true;
      }
    );
  });

  test("rejects js.deriveBundleTransformConfig as non-function", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ js: { deriveBundleTransformConfig: {} } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /js\.deriveBundleTransformConfig/);
        assert.match(err.message, /function/);
        return true;
      }
    );
  });

  test("rejects js.defaultBundleTransformConfig as non-object", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ js: { defaultBundleTransformConfig: "bad" } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /js\.defaultBundleTransformConfig/);
        assert.match(err.message, /object/);
        return true;
      }
    );
  });

  test("rejects js.defaultBundleTransformConfig as array", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ js: { defaultBundleTransformConfig: [1, 2] } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /js\.defaultBundleTransformConfig/);
        assert.match(err.message, /got array/);
        return true;
      }
    );
  });

  test("rejects js.externalDependencies as non-object", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ js: { externalDependencies: "bad" } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /js\.externalDependencies/);
        assert.match(err.message, /object/);
        return true;
      }
    );
  });

  test("rejects js.externalDependencies with non-string values", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ js: { externalDependencies: { alpinejs: 123 } } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /js\.externalDependencies\.alpinejs/);
        assert.match(err.message, /string/);
        return true;
      }
    );
  });

  // --- css ---

  test("rejects css as a non-object", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ css: true }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /"css" config must be an object/);
        return true;
      }
    );
  });

  test("rejects css.derivePageBundleFilePath as non-function", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ css: { derivePageBundleFilePath: 42 } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /css\.derivePageBundleFilePath/);
        return true;
      }
    );
  });

  test("rejects css.deriveBundleFilePath as non-function", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ css: { deriveBundleFilePath: {} } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /css\.deriveBundleFilePath/);
        return true;
      }
    );
  });

  // --- html ---

  test("rejects html as a non-object", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ html: [] }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /"html" config must be an object/);
        return true;
      }
    );
  });

  test("rejects html.minify as non-boolean", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ html: { minify: "yes" } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /html\.minify/);
        assert.match(err.message, /boolean/);
        return true;
      }
    );
  });

  test("rejects html.processImport as non-function", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ html: { processImport: "bad" } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /html\.processImport/);
        assert.match(err.message, /function/);
        return true;
      }
    );
  });

  test("rejects html.deriveBundleFilePath as non-function", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ html: { deriveBundleFilePath: 42 } }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /html\.deriveBundleFilePath/);
        return true;
      }
    );
  });

  // --- inputDir / outputDir / quietMode ---

  test("rejects inputDir as non-string", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ inputDir: 123 }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /inputDir/);
        return true;
      }
    );
  });

  test("rejects quietMode as non-boolean", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => validateConfig({ quietMode: "true" }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /quietMode/);
        return true;
      }
    );
  });

  // --- Multiple errors ---

  test("collects multiple errors into a single throw", () => {
    assert.throws(
      () =>
        validateConfig({
          // @ts-expect-error testing invalid input
          js: { derivePageBundleFilePath: 42, deriveBundleFilePath: "not-a-fn" },
          // @ts-expect-error testing invalid input
          html: { minify: "yes" },
        }),
      (err: Error) => {
        assert(err instanceof YetiConfigError);
        assert.match(err.message, /js\.derivePageBundleFilePath/);
        assert.match(err.message, /js\.deriveBundleFilePath/);
        assert.match(err.message, /html\.minify/);
        return true;
      }
    );
  });

  // --- Unknown keys ---

  test("warns on unknown top-level keys", (t) => {
    const warnings: string[] = [];
    t.mock.method(console, "warn", (...args: any[]) => {
      warnings.push(args.map(String).join(" "));
    });

    // @ts-expect-error testing invalid input
    validateConfig({ notARealOption: true });

    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /notARealOption/);
  });

  test("warns on unknown nested keys", (t) => {
    const warnings: string[] = [];
    t.mock.method(console, "warn", (...args: any[]) => {
      warnings.push(args.map(String).join(" "));
    });

    // @ts-expect-error testing invalid input
    validateConfig({ js: { notReal: true }, css: { alsoFake: "hi" } });

    assert.strictEqual(warnings.length, 2);
    assert.match(warnings[0], /js\.notReal/);
    assert.match(warnings[1], /css\.alsoFake/);
  });

  test("does not warn on valid keys", (t) => {
    const warnings: string[] = [];
    t.mock.method(console, "warn", (...args: any[]) => {
      warnings.push(args.map(String).join(" "));
    });

    validateConfig({
      js: { defaultBundleTransformConfig: { minify: false } },
      html: { minify: false },
    });

    assert.strictEqual(warnings.length, 0);
  });
});

describe("mergeConfigs", () => {
  test("retains the base value when a top-level key is explicitly undefined", () => {
    const base = { foo: "original", bar: 42 };
    const merged = mergeConfigs(base, { foo: undefined });
    assert.strictEqual(merged.foo, "original");
    assert.strictEqual(merged.bar, 42);
  });

  test("retains the base value when a nested key is explicitly undefined", () => {
    const base = {
      js: { minify: true, deriveBundleFilePath: (n: string) => `/js/${n}.js` },
    };
    const merged = mergeConfigs(base, {
      js: { minify: undefined },
    });
    assert.strictEqual(merged.js.minify, true);
    assert.strictEqual(merged.js.deriveBundleFilePath, base.js.deriveBundleFilePath);
  });

  test("does not blow away a nested object when its key is explicitly undefined", () => {
    const base = { js: { minify: true } };
    const merged = mergeConfigs(base, { js: undefined });
    assert.deepStrictEqual(merged.js, { minify: true });
  });

  test("applies sibling keys even when one is explicitly undefined", () => {
    const base = { js: { minify: true, target: "es2022" as const } };
    const merged = mergeConfigs(base, {
      js: { target: undefined, minify: false },
    });
    assert.strictEqual(merged.js.target, "es2022");
    assert.strictEqual(merged.js.minify, false);
  });
});
