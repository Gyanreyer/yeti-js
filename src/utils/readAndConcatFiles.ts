import { open, type FileHandle } from "node:fs/promises";

/**
 * Read exactly `length` bytes from `fh` (starting at file position `filePosition`) into
 * `buffer` at `bufferOffset`, looping past short reads.
 *
 * A single `fh.read()` is not guaranteed to return as many bytes as requested for larger
 * files — it can return fewer and require another call to continue. We loop until `length`
 * bytes have been read, or until the file signals EOF early (`bytesRead === 0`), which happens
 * if the file shrank between the `stat` that sized the buffer and this read. In that case we
 * stop and return the number of bytes actually read so the caller can reason about the gap.
 *
 * @returns The total number of bytes read — equal to `length` unless EOF was hit early.
 */
export const readIntoBufferFully = async (
  fh: FileHandle,
  buffer: Uint8Array,
  bufferOffset: number,
  length: number,
  filePosition: number,
): Promise<number> => {
  let read = 0;
  while (read < length) {
    const { bytesRead } = await fh.read(
      buffer,
      bufferOffset + read,
      length - read,
      filePosition + read,
    );
    if (bytesRead === 0) {
      // EOF before `length` bytes — the file shrank since we stat'd it. Stop here rather than
      // spinning forever; the pre-allocated buffer's trailing bytes stay zero for this file.
      break;
    }
    read += bytesRead;
  }
  return read;
};

/**
 * Open, read, and concatenate the contents of every path in `filePaths` into a single
 * pre-allocated buffer, in iteration order.
 *
 * File handles are opened and stat'd in parallel, then read sequentially into the buffer to
 * avoid kernel congestion from many concurrent reads. Each file is read fully via
 * {@link readIntoBufferFully} so partial reads of large files don't leave gaps. All handles are
 * closed regardless of which step fails.
 */
export const readAndConcatFiles = async (
  filePaths: Iterable<string>,
): Promise<Uint8Array> => {
  // `allSettled` is essential here to make sure we can safely close all opened file handles
  // if any open/stat fails
  const results = await Promise.allSettled(
    Array.from(filePaths).map(async (importPath) => {
      const fh = await open(importPath, "r");
      const { size } = await fh.stat();
      return {
        fh,
        size,
      };
    }),
  );

  const resultCount = results.length;
  const fileEntries = new Array<{ fh: FileHandle; size: number }>(resultCount);

  for (let i = 0; i < resultCount; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      // If any open/stat failed, close all the ones that succeeded before throwing the error
      for (const resultToClose of results) {
        if (resultToClose.status === "fulfilled") {
          await resultToClose.value.fh.close().catch(() => { });
        }
      }
      throw r.reason;
    } else {
      fileEntries[i] = r.value;
    }
  }

  let totalByteLength = 0;
  for (const { size } of fileEntries) {
    totalByteLength += size;
  }

  const combinedBytes = new Uint8Array(totalByteLength);
  try {
    let offset = 0;
    for (const { size, fh } of fileEntries) {
      await readIntoBufferFully(fh, combinedBytes, offset, size, 0);
      // Advance by the stat'd size to keep each file at its pre-allocated slot, even if a
      // mid-build shrink caused a short read above (a benign, pathological race).
      offset += size;
    }
  } finally {
    await Promise.all(fileEntries.map(({ fh }) => fh.close()));
  }
  return combinedBytes;
};
