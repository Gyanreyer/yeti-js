import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readIntoBufferFully, readAndConcatFiles } from "./readAndConcatFiles.ts";

const textEncoder = new TextEncoder();
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("readAndConcatFiles", () => {
  let tempDir: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "yeti-readconcat-"));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("concatenates multiple files in iteration order", async () => {
    const a = join(tempDir, "a.txt");
    const b = join(tempDir, "b.txt");
    const c = join(tempDir, "c.txt");
    await writeFile(a, "alpha");
    await writeFile(b, "beta");
    await writeFile(c, "gamma");

    const result = await readAndConcatFiles([a, b, c]);
    assert.equal(decode(result), "alphabetagamma");
  });

  test("returns an empty buffer for no paths", async () => {
    const result = await readAndConcatFiles([]);
    assert.equal(result.byteLength, 0);
  });

  test("rejects (without hanging) when one of several paths cannot be opened", async () => {
    const a = join(tempDir, "exists-a.txt");
    const b = join(tempDir, "exists-b.txt");
    await writeFile(a, "alpha");
    await writeFile(b, "beta");
    const missing = join(tempDir, "does-not-exist.txt");

    // A failed open partway through must surface the error rather than producing a buffer; the
    // handles that did open are closed internally (see the open-phase cleanup in readAndConcatFiles).
    await assert.rejects(
      readAndConcatFiles([a, missing, b]),
      /ENOENT/,
    );
  });

  test("reads a file larger than a single read chunk correctly", async () => {
    // ~5MB of repeating content — large enough that the OS may satisfy it across multiple reads.
    const big = join(tempDir, "big.txt");
    const chunk = "0123456789abcdef";
    const content = chunk.repeat((5 * 1024 * 1024) / chunk.length);
    await writeFile(big, content);

    const small = join(tempDir, "small.txt");
    await writeFile(small, "TAIL");

    const result = await readAndConcatFiles([big, small]);
    assert.equal(result.byteLength, textEncoder.encode(content).byteLength + 4);
    assert.equal(decode(result), content + "TAIL");
  });
});

describe("readIntoBufferFully", () => {
  /**
   * A FileHandle stub whose `read` deliberately returns fewer bytes than requested on each call,
   * forcing the loop to iterate. Only the members `readIntoBufferFully` touches are implemented.
   */
  const makeShortReadHandle = (source: Uint8Array, maxBytesPerRead: number): FileHandle => {
    return {
      async read(
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ): Promise<{ bytesRead: number; buffer: Uint8Array }> {
        const available = source.byteLength - position;
        if (available <= 0) {
          return { bytesRead: 0, buffer };
        }
        const toCopy = Math.min(length, maxBytesPerRead, available);
        buffer.set(source.subarray(position, position + toCopy), offset);
        return { bytesRead: toCopy, buffer };
      },
    } as unknown as FileHandle;
  };

  test("loops past short reads to fill the requested length", async () => {
    const source = textEncoder.encode("the quick brown fox jumps");
    const handle = makeShortReadHandle(source, 4); // never returns more than 4 bytes at a time
    const buffer = new Uint8Array(source.byteLength);

    const read = await readIntoBufferFully(handle, buffer, 0, source.byteLength, 0);

    assert.equal(read, source.byteLength);
    assert.equal(decode(buffer), "the quick brown fox jumps");
  });

  test("writes into the buffer at the given offset", async () => {
    const source = textEncoder.encode("XYZ");
    const handle = makeShortReadHandle(source, 1);
    const buffer = new Uint8Array(6); // leading bytes stay zero

    const read = await readIntoBufferFully(handle, buffer, 3, source.byteLength, 0);

    assert.equal(read, 3);
    assert.deepEqual(Array.from(buffer), [0, 0, 0, 88, 89, 90]); // "XYZ" === 88,89,90
  });

  test("stops at EOF (zero-byte read) without spinning, returning bytes actually read", async () => {
    const source = textEncoder.encode("short");
    const handle = makeShortReadHandle(source, 8);
    // Ask for more than the file actually contains (simulates a shrink after stat).
    const buffer = new Uint8Array(10);

    const read = await readIntoBufferFully(handle, buffer, 0, 10, 0);

    assert.equal(read, source.byteLength, "should stop once the source is exhausted");
    assert.equal(decode(buffer.subarray(0, read)), "short");
  });
});
