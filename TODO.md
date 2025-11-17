- Refactor `plugin.js` to not be a 1000+ line mega-file; a lot of this logic would benefit from being broken out into separate testable functions
  - Improve JS build errors for inlined JS
  - Improve CSS build errors
- Fork HTM to support `<!DOCTYPE>` and root-level non-element content
  - Potentially update so that `html` produces a `parse5`-compliant tree representation of the HTML
    instead of an HTML string; this would be more efficient than the current flow of
    template string -> parsed HTM representation -> HTML string -> parsed Parse5 representation
- Performance audit: what can run better?
- Make `js.import()` resolve any sub-dependencies of the file by bundling with esbuild?