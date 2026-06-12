import browserslist from 'browserslist';
import browserslistToEsbuild from 'browserslist-to-esbuild';
import { browserslistToTargets, type Targets } from 'lightningcss';

import { getConfig, type JSBundleTransformConfig, type CSSBundleTransformConfig } from './config.ts';
import { YetiConfigError } from './error.ts';

export type ResolvedBrowserTargets = {
  /**
   * esbuild `target` array, e.g. `['chrome90', 'safari15']`. May be empty when none of the
   * resolved browsers map to an engine esbuild can target (e.g. only Samsung Internet / Opera Mini),
   * in which case no esbuild `target` should be injected.
   */
  esbuildTarget: string[];
  /** lightningcss `targets` object produced by `browserslistToTargets`. */
  lightningcssTargets: Targets;
};

/**
 * Resolve a project's browser support into concrete esbuild + lightningcss targets from a single
 * browserslist source of truth.
 *
 * - If an explicit `query` is given, it's used directly (resolved relative to `projectPath`).
 * - Otherwise we auto-detect: only when the project actually has a browserslist config
 *   (`.browserslistrc`, `package.json#browserslist`, etc.) reachable from `projectPath` do we
 *   resolve it. We deliberately do **not** fall back to browserslist's built-in `defaults` query,
 *   which would silently change output for projects that never opted in.
 * - When there's neither an explicit query nor a project config, returns `null` so the caller
 *   injects nothing and preserves esbuild/lightningcss defaults (the no-config = no-change rule).
 *
 * The same concrete browser list feeds both engines, so JS and CSS stay consistent. The esbuild
 * translation (via `browserslist-to-esbuild`) drops browsers esbuild can't target; those are still
 * honored by lightningcss, which supports a broader set.
 *
 * @throws {YetiConfigError} if an explicit `query` is not a valid browserslist query.
 */
export const resolveBrowserTargets = (
  query: string | string[] | null,
  projectPath: string,
): ResolvedBrowserTargets | null => {
  let resolvedList: string[];

  if (query !== null || browserslist.findConfig(projectPath)) {
    // Resolve the list if we have a user-defined query or we found a browserslist config in the project
    try {
      resolvedList = browserslist(query, { path: projectPath });
    } catch (error) {
      throw new YetiConfigError(
        `Invalid "browserslist" query ${JSON.stringify(query)}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  } else {
    // Nothing to go on: inject no targets and keep the bundlers' defaults.
    return null;
  }

  return {
    // `browserslist-to-esbuild` re-runs browserslist on the (already concrete) list, which is
    // idempotent, so both engines derive from the exact same resolved browser set.
    esbuildTarget: browserslistToEsbuild(resolvedList),
    lightningcssTargets: browserslistToTargets(resolvedList),
  };
};

/**
 * Build-scoped cache of the resolved browser targets. Resolution touches the filesystem
 * (browserslist config lookup + caniuse data), so we resolve at most once per build and reuse the
 * result across every bundle. `undefined` means "not yet computed this build"; a resolved value of
 * `null` (no query, no project config) is cached too so we don't re-check every call.
 *
 * Reset at the start of each build via {@link resetBrowserTargetsCache} so watch-mode rebuilds pick
 * up a changed query / project config.
 */
let resolvedTargetsCache: ResolvedBrowserTargets | null | undefined;

/** Clear the cached browser-target resolution. Call once per build (in `eleventy.before`). */
export const resetBrowserTargetsCache = (): void => {
  resolvedTargetsCache = undefined;
};

const getResolvedBrowserTargets = (): ResolvedBrowserTargets | null => {
  if (resolvedTargetsCache === undefined) {
    const { browserslist: query, inputDir } = getConfig();
    resolvedTargetsCache = resolveBrowserTargets(query, inputDir);
  }
  return resolvedTargetsCache;
};

/**
 * The esbuild `target` for the current config's browser support, resolved on demand and cached for
 * the build. Returns `undefined` when there's no query / project config, or when no resolved browser
 * maps to an esbuild engine — in both cases esbuild should keep its default.
 *
 * @throws {YetiConfigError} if the configured `browserslist` query is invalid.
 */
export const getESBuildBrowserTargets = (): string[] | undefined => {
  const resolved = getResolvedBrowserTargets();
  return resolved && resolved.esbuildTarget.length > 0 ? resolved.esbuildTarget : undefined;
};

/**
 * The lightningcss `targets` for the current config's browser support, resolved on demand and cached
 * for the build. Returns `undefined` when there's no query / project config (lightningcss keeps its
 * default).
 *
 * @throws {YetiConfigError} if the configured `browserslist` query is invalid.
 */
export const getLightningCSSBrowserTargets = (): Targets | undefined => {
  return getResolvedBrowserTargets()?.lightningcssTargets ?? undefined;
};

/**
 * Apply the resolved esbuild `target` to a JS transform config as a base, unless the user already
 * set `target` explicitly (their value always wins). Returns the input unchanged when there's no
 * browser target to apply, so the no-config case stays a byte-identical no-op.
 */
export const withESBuildBrowserTargets = (defaults: JSBundleTransformConfig): JSBundleTransformConfig => {
  if (defaults.target !== undefined) {
    // User has explicitly set a target, so we don't apply browser targets at all (even if they exist).
    return defaults;
  }

  return {
    ...defaults,
    target: getESBuildBrowserTargets(),
  };
};

/**
 * Apply the resolved lightningcss `targets` to a CSS transform config as a base, unless the user
 * already set `targets` explicitly (their value always wins). Returns the input unchanged when
 * there's no browser target to apply.
 */
export const withLightningCSSBrowserTargets = (defaults: CSSBundleTransformConfig): CSSBundleTransformConfig => {
  if (defaults.targets !== undefined) {
    // User has explicitly set targets, so we don't apply browser targets at all (even if they exist).
    return defaults;
  }

  return {
    ...defaults,
    targets: getLightningCSSBrowserTargets(),
  };
};
