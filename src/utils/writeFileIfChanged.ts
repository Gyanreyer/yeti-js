import { open, mkdir, writeFile, access, constants, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';

import { logWarning } from '../log.ts';

const COMPARE_CHUNK_SIZE = 64 * 1024;

/**
 * Thrown when `fileMatches` encounters an unexpected zero-byte read partway through comparing
 * an on-disk file with new content. A regular file should never return 0 bytes mid-stream when
 * we still have bytes left to read; if it does, the filesystem is in a state we don't trust.
 * `writeFileIfChanged` catches this and falls through to the write path so the file is
 * defensively rewritten — the upper layer recovers, but we still surface the anomaly via a
 * warning so it's not silently swallowed.
 */
export class UnexpectedShortReadError extends Error {
  readonly filePath: string;
  readonly offset: number;
  readonly expected: number;
  constructor(filePath: string, offset: number, expected: number) {
    super(
      `Unexpected short read while comparing "${filePath}" at offset ${offset}: expected ${expected} bytes, got 0`,
    );
    this.name = "UnexpectedShortReadError";
    this.filePath = filePath;
    this.offset = offset;
    this.expected = expected;
  }
}

const stats = { writes: 0, skips: 0 };
export const getWriteSkipStats = () => stats;
export const resetWriteSkipStats = (): void => {
  stats.writes = 0;
  stats.skips = 0;
};

/**
 * Test if a directory exists and recursively create it if it doesn't
 */
const ensureDir = async (dir: string): Promise<void> => {
  try {
    await access(dir, constants.W_OK);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      await mkdir(dir, { recursive: true });
      return;
    }
    throw err;
  }
};

/**
 * Compare an on-disk file's contents with `content` in chunks. Returns true if the file
 * exists and is byte-identical. Returns false if the file is missing, sized differently,
 * or differs at any byte. Bails on first mismatch — never reads more than necessary.
 *
 * Uses a bounded 64KB read buffer so memory usage stays flat regardless of file size.
 */
const fileMatches = async (filePath: string, content: Buffer): Promise<boolean> => {
  let fileHandle: FileHandle;
  try {
    fileHandle = await open(filePath, 'r');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }

  try {
    const { size } = await fileHandle.stat();
    if (size !== content.byteLength) {
      // Fast path for size mismatch — no need to read and compare contents.
      return false;
    }

    // Pre-allocate a buffer to write chunks of the file to for comparison
    const readBuf = Buffer.alloc(COMPARE_CHUNK_SIZE);
    let offset = 0;
    while (offset < size) {
      const remaining = size - offset;
      const toRead = remaining < COMPARE_CHUNK_SIZE ? remaining : COMPARE_CHUNK_SIZE;
      const { bytesRead } = await fileHandle.read(readBuf, 0, toRead, offset);
      if (bytesRead === 0) {
        // A zero-byte read partway through a regular file shouldn't happen — the file is in
        // a state we don't trust. Surface the anomaly so `writeFileIfChanged` can recover
        // (by falling through to the write path) while still logging that something odd
        // happened.
        throw new UnexpectedShortReadError(filePath, offset, toRead);
      }
      const onDiskSlice = readBuf.subarray(0, bytesRead);
      const newSlice = content.subarray(offset, offset + bytesRead);
      if (Buffer.compare(onDiskSlice, newSlice) !== 0) {
        // If any bytes in this chunk differ, the file has changed
        return false;
      }
      offset += bytesRead;
    }
    return true;
  } finally {
    await fileHandle.close();
  }
};

/**
 * Write `content` to `filePath` only if the file's existing contents differ. Returns
 * `true` when a write happened, `false` when the file was already up-to-date and the write was skipped.
 *
 * Skipping unchanged writes avoids triggering downstream filesystem watchers (dev servers,
 * CI tools) and saves disk I/O when builds produce identical outputs.
 *
 * Streams the on-disk file in 64KB chunks so memory usage is bounded regardless of file
 * size, with early-exit on size mismatch (fast path) or first byte mismatch.
 *
 * @returns {Promise<boolean>} `true` if the file was written, `false` if the existing file already matched and the write was skipped.
 */
export const writeFileIfChanged = async (
  filePath: string,
  content: Uint8Array | string,
): Promise<boolean> => {
  const contentBuf =
    typeof content === 'string' ? Buffer.from(content) :
      Buffer.from(content.buffer, content.byteOffset, content.byteLength);

  let matches = false;
  try {
    matches = await fileMatches(filePath, contentBuf);
  } catch (err) {
    if (err instanceof UnexpectedShortReadError) {
      // Recover by falling through to the write path — the file is in a bad state, so
      // overwriting it is the safe move. Warn so the anomaly is visible in build logs.
      logWarning(`writeFileIfChanged: ${err.message}. Falling back to a defensive rewrite.`);
    } else {
      throw err;
    }
  }

  if (matches) {
    stats.skips++;
    return false;
  }

  await ensureDir(dirname(filePath));
  await writeFile(filePath, contentBuf);
  stats.writes++;
  return true;
};
