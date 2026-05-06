import { build, type Plugin } from 'esbuild';
import { join, matchesGlob, parse as parsePath } from 'node:path';

import { getConfig } from '../config.ts';
import { BundleError } from '../error.ts';
import { logError } from '../log.ts';
import { safeWriteFile } from '../utils/safeWriteFile.ts';

/**
 * Derives the output file path for a specifier matched by a directory-style external dependency entry.
 * Strips file extensions and appends `.js`.
 *
 * @example deriveOutputPathForSpecifier("lit", "/js/ext/") → "/js/ext/lit.js"
 * @example deriveOutputPathForSpecifier("lit/decorators.js", "/js/ext/") → "/js/ext/lit/decorators.js"
 */
export const deriveOutputPathForSpecifier = (specifier: string, outputDir: string): string => {
  const { name, dir } = parsePath(specifier);
  return join(outputDir, dir, `${name}.js`);
};

// Tracks which external dependency specifiers were imported across all bundles in the current build.
// Populated either by the esbuild plugin (when `out` is passed) or by `addUsedExternalSpecifiers()`
// (used to replay specifiers from a cached bundle result, since cache hits skip esbuild).
let usedExternalSpecifiers = new Set<string>();

export const resetUsedExternalSpecifiers = () => {
  usedExternalSpecifiers = new Set<string>();
};

export const getUsedExternalSpecifiers = () => usedExternalSpecifiers;

/**
 * Add specifiers to the global used-specifiers set. Called by `bundleImportCache` after every
 * bundle resolution (hit or miss) so that bundle-level cache hits still register their
 * external dependencies for the per-build `buildAndWriteExternalDependencies()` pass.
 */
export const addUsedExternalSpecifiers = (specifiers: Iterable<string>): void => {
  for (const s of specifiers) {
    usedExternalSpecifiers.add(s);
  }
};

// Matches bare specifiers (not starting with . or /)
const externalDependencyResolveFilterRegex = /^[^./]/;

/**
 * Creates an esbuild plugin that externalizes imports matching configured external dependency patterns.
 * Matched imports are marked as external and their paths are rewritten to the configured output location.
 *
 * @param externalDeps - The `externalDependencies` config mapping glob patterns to output paths/dirs.
 * @param out - If provided, every matched specifier is added to this set. The caller is
 *   responsible for forwarding these into the global `usedExternalSpecifiers` set (typically
 *   via `addUsedExternalSpecifiers()`); the plugin itself no longer touches global state.
 * @param excludeSpecifier - Optional specifier to exclude from matching (used when building
 *   an external dependency bundle to avoid self-externalization).
 */
export const createExternalDependenciesEsbuildPlugin = (
  externalDeps: Record<string, string>,
  out: Set<string> | null,
  excludeSpecifier?: string,
): Plugin => {
  const entries = Object.entries(externalDeps);

  return {
    name: 'yeti-external-dependencies',
    setup(build) {
      build.onResolve({ filter: externalDependencyResolveFilterRegex }, (args) => {
        if (args.path === excludeSpecifier) {
          return undefined;
        }

        for (const [pattern, output] of entries) {
          if (matchesGlob(args.path, pattern)) {
            out?.add(args.path);

            const isDirectory = output.endsWith('/');
            const outputPath = isDirectory
              ? deriveOutputPathForSpecifier(args.path, output)
              : output;

            return {
              path: outputPath,
              external: true,
            };
          }
        }

        return undefined;
      });
    },
  };
};

/**
 * Builds a single external dependency into a standalone ESM bundle.
 * Used for external dependency entries with a file path output (no trailing `/`).
 */
export const buildSingleExternalBundle = async (
  specifier: string,
  allExternalDeps: Record<string, string>,
): Promise<Uint8Array> => {
  const config = getConfig();
  const transformConfig = config.js.deriveBundleTransformConfig(
    `external:${specifier}`,
    config.js.defaultBundleTransformConfig,
  );

  const result = await build({
    entryPoints: [specifier],
    bundle: true,
    write: false,
    treeShaking: true,
    format: 'esm',
    platform: 'browser',
    outdir: 'out',
    minify: transformConfig.minify,
    target: transformConfig.target,
    plugins: [createExternalDependenciesEsbuildPlugin(allExternalDeps, null, specifier)],
  });

  if (!result.outputFiles || result.outputFiles.length === 0) {
    throw new BundleError(`Failed to build external dependency "${specifier}": no output files produced.`);
  }

  return result.outputFiles[0].contents;
};

/**
 * Builds a group of external dependency specifiers together with esbuild code splitting.
 * Used for external dependency entries with a directory output (trailing `/`).
 * Returns an array of output files to be written to disk.
 */
export const buildCodeSplitExternalBundles = async (
  specifiers: string[],
  outputDir: string,
  allExternalDeps: Record<string, string>,
  outputBase: string,
): Promise<{ path: string; contents: Uint8Array }[]> => {
  const config = getConfig();
  const transformConfig = config.js.deriveBundleTransformConfig(
    `external:${outputDir}`,
    config.js.defaultBundleTransformConfig,
  );

  // Build entry points object: entry name (specifier with extension stripped) → specifier
  const entryPoints: Record<string, string> = {};
  for (const specifier of specifiers) {
    const entryName = specifier.replace(/\.(js|ts|mjs|mts|jsx|tsx)$/, '');
    entryPoints[entryName] = specifier;
  }

  // Create a version of externalDeps that excludes the current pattern's specifiers
  // so they resolve to each other within the code-split build rather than being externalized.
  // We do this by removing the pattern entry that matched these specifiers.
  const filteredExternalDeps: Record<string, string> = {};
  for (const [pattern, output] of Object.entries(allExternalDeps)) {
    // Keep the entry only if none of our specifiers match it
    const matchesAny = specifiers.some(s => matchesGlob(s, pattern));
    if (!matchesAny) {
      filteredExternalDeps[pattern] = output;
    }
  }

  const absOutDir = join(outputBase, outputDir);

  const result = await build({
    entryPoints,
    bundle: true,
    splitting: true,
    write: false,
    treeShaking: true,
    format: 'esm',
    platform: 'browser',
    outdir: absOutDir,
    minify: transformConfig.minify,
    target: transformConfig.target,
    plugins: Object.keys(filteredExternalDeps).length > 0
      ? [createExternalDependenciesEsbuildPlugin(filteredExternalDeps, null)]
      : [],
  });

  if (!result.outputFiles || result.outputFiles.length === 0) {
    throw new BundleError(`Failed to build external dependencies for output directory "${outputDir}": no output files produced.`);
  }

  return result.outputFiles.map(file => ({
    path: file.path,
    contents: file.contents,
  }));
};

/**
 * Groups used external dependency specifiers by their matching config pattern,
 * builds each group, and writes the output files to disk.
 */
export const buildAndWriteExternalDependencies = async (
  externalDependencies: Record<string, string>,
  output: string,
) => {
  const usedSpecifiers = getUsedExternalSpecifiers();
  if (usedSpecifiers.size === 0) {
    return;
  }

  // Group used specifiers by which config entry pattern they matched
  const entries = Object.entries(externalDependencies);
  const groups = new Map<string, { outputTarget: string; specifiers: string[] }>();
  for (const specifier of usedSpecifiers) {
    for (const [pattern, outputTarget] of entries) {
      if (matchesGlob(specifier, pattern)) {
        let group = groups.get(pattern);
        if (!group) {
          group = { outputTarget, specifiers: [] };
          groups.set(pattern, group);
        }
        group.specifiers.push(specifier);
        break;
      }
    }
  }

  await Promise.all(
    Array.from(groups.entries()).map(async ([pattern, { outputTarget, specifiers }]) => {
      const isDirectory = outputTarget.endsWith('/');

      if (isDirectory) {
        const outputFiles = await buildCodeSplitExternalBundles(
          specifiers,
          outputTarget,
          externalDependencies,
          output,
        );
        await Promise.all(
          outputFiles.map(file => safeWriteFile(file.path, file.contents))
        );
      } else {
        if (specifiers.length > 1) {
          logError(
            `External dependency pattern "${pattern}" matched ${specifiers.length} specifiers
       ${specifiers.join(', ')}), but the output path "${outputTarget}" is a file path.
       Use a directory path (with trailing "/") to support multiple matched specifiers with code splitting.`
          );
        }
        const code = await buildSingleExternalBundle(specifiers[0], externalDependencies);
        await safeWriteFile(join(output, outputTarget), code);
      }
    })
  );
};
