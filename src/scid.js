let scid = 0;

export function getScopedComponentID() {
  return (scid++).toString(36);
}