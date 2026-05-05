/**
 * ESM loader hook that cache-busts project file imports during watch rebuilds.
 *
 * Registered via `module.register()` from the plugin. A MessagePort receives
 * the absolute input directory path and a build counter from the main thread
 * before each build. The `resolve` hook appends a `?_yeti=<counter>` query
 * parameter to every `file://` specifier that falls inside the input directory
 * (and is not in node_modules), forcing Node to treat each build's imports as
 * distinct modules and bypassing the ESM module cache.
 */
import { fileURLToPath } from "node:url";

let inputDir: string | null = null;
let buildId = 0;

export async function initialize({ port }: { port: MessagePort }) {
  port.addEventListener("message", (event: MessageEvent<{ inputDir: string; buildId: number }>) => {
    inputDir = event.data.inputDir;
    buildId = event.data.buildId;
  });
}

export async function resolve(
  specifier: string,
  _context: { parentURL?: string },
  nextResolve: (specifier: string) => Promise<{ url: string }>,
) {
  // Skip bare specifiers — only relative or file: URLs can possibly resolve to a project file.
  // We intentionally don't filter by parentURL here: the plugin itself lives in node_modules
  // and imports user page components, and those imports must be cache-busted. The check on
  // the *resolved* path below is the real node_modules guard.
  if (
    !specifier.startsWith("./") &&
    !specifier.startsWith("../") &&
    !specifier.startsWith("file:")
  ) {
    return nextResolve(specifier);
  }

  // Resolve first so we get the canonical file: URL
  const resolved = await nextResolve(specifier);

  // Only cache-bust file: URLs inside the input directory
  if (!resolved.url.startsWith("file:") || !inputDir || buildId === 0) {
    return resolved;
  }

  let absolutePath: string;
  try {
    absolutePath = fileURLToPath(resolved.url);
  } catch {
    return resolved;
  }

  if (!absolutePath.startsWith(inputDir) || absolutePath.includes("/node_modules/")) {
    return resolved;
  }

  // Append cache-bust parameter so Node treats this as a new module
  const url = new URL(resolved.url);
  url.searchParams.set("_yeti", String(buildId));
  return { ...resolved, url: url.href };
}
