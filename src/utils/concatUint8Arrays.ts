/**
 * Concatenates an iterable of Uint8Arrays into a single contiguous Uint8Array.
 */
export const concatUint8Arrays = (chunks: Iterable<Uint8Array>): Uint8Array => {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.byteLength;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};
