export const mergeSets = <
  T,
  TTargetSet extends Set<T> | undefined,
  TSourceSet extends Set<T> | undefined,
>(targetSet: TTargetSet, sourceSet: TSourceSet): TTargetSet extends undefined ? TSourceSet : TTargetSet => {
  if (!sourceSet) {
    // If we don't have a source set, leave the target set as is (which could be undefined or a Set) and return it
    return targetSet as TTargetSet extends undefined ? TSourceSet : TTargetSet;
  }

  if (!targetSet) {
    // If we have a source set but no target set, make a copy of the source and return it
    return new Set(sourceSet) as TTargetSet extends undefined ? TSourceSet : TTargetSet;
  }

  // Copy items from the source set into the target set
  for (const item of sourceSet) {
    targetSet.add(item);
  }
  return targetSet as TTargetSet extends undefined ? TSourceSet : TTargetSet;
};

export const mergeBundleSetMaps = <
  T,
  TTargetMap extends Map<string, Set<T>> | undefined,
  TSourceMap extends Map<string, Set<T>> | undefined,
>(targetMap: TTargetMap, sourceMap: TSourceMap): TTargetMap extends undefined ? TSourceMap : TTargetMap => {
  if (!sourceMap) {
    // If we don't have a source map, leave the target map as is (which could be undefined or a Map) and return it
    return targetMap as TTargetMap extends undefined ? TSourceMap : TTargetMap;
  }

  if (!targetMap) {
    // If we have a source map but no target map, make a copy of the source and return it
    return new Map(sourceMap) as TTargetMap extends undefined ? TSourceMap : TTargetMap;
  }

  // Merge the source map into the target map
  for (const [key, sourceSet] of sourceMap.entries()) {
    const targetSet = targetMap.get(key);
    targetMap.set(key, mergeSets(targetSet, sourceSet));
  }
  return targetMap as TTargetMap extends undefined ? TSourceMap : TTargetMap;
};
