/**
 * Built-in Head component for declaring `<head>` content from any component.
 *
 * When used inside a component's template, the children of the Head component
 * are collected during parsing and merged into the document's primary `<head>` element.
 * Nothing is rendered in place — all content is hoisted to the `<head>`.
 *
 * Merging rules:
 * - `<title>`: last one wins (later in document order overrides earlier)
 * - `<meta>`: deduped by `name`, `property`, or `http-equiv` attribute; last wins
 * - `<link>`: deduped by `rel` + `href`; last wins
 * - `<script>` with `src`: deduped by `src`; last wins
 * - Everything else (`<style>`, `<script>` without `src`, etc.): appended
 *
 * @example
 * ```ts
 * import { html, Head } from "yeti-js";
 *
 * export default function MyPage() {
 *   return html`<${Layout}>
 *     <${Head}>
 *       <title>My Page!</title>
 *       <meta name="description" content="My page description" />
 *     </${Head}>
 *     <main>Hello!</main>
 *   </${Layout}>`;
 * }
 * ```
 */
export function Head() {
  // This function is never called during normal operation.
  // The parser intercepts Head components and collects their children
  // onto rootNode.assets.head instead of rendering them.
  throw new Error("Head component should not be called directly — it is intercepted by the parser.");
}
