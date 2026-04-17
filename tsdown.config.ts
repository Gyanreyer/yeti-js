import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    // Registered as a Node ESM loader hook via `register(import.meta.resolve("./esmCacheBust.ts"))`.
    // The string spec is opaque to the bundler, so it must be listed as an explicit entry
    // to guarantee the file is emitted and not inlined into its referrer.
    "src/plugin/esmCacheBust.ts",
  ],
  format: "esm",
  platform: "node",
  target: "node24",
  unbundle: true,
  dts: true,
  // Emit .js / .d.ts (not .mjs / .d.mts). The package sets "type": "module",
  // so .js is already unambiguously ESM. Default on node platform is `true`,
  // which would force .mjs.
  fixedExtension: false,
  clean: true,
  sourcemap: true,
});
