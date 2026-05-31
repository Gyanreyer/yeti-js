import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getWriteSkipStats,
  resetWriteSkipStats,
  writeFileIfChanged,
} from './writeFileIfChanged.ts';

describe('writeFileIfChanged', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'yeti-write-if-changed-'));
    resetWriteSkipStats();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => { });
  });

  test('writes when the file does not exist', async () => {
    const filePath = join(tmp, 'new.txt');
    const result = await writeFileIfChanged(filePath, 'hello');
    assert.equal(result, true);
    assert.equal(await readFile(filePath, 'utf-8'), 'hello');
    assert.equal(getWriteSkipStats().writes, 1);
    assert.equal(getWriteSkipStats().skips, 0);
  });

  test('skips when existing file content is identical', async () => {
    const filePath = join(tmp, 'existing.txt');
    await writeFile(filePath, 'same content');
    const before = await stat(filePath);

    // Wait long enough that any rewrite would change mtime.
    await new Promise((r) => setTimeout(r, 10));

    const result = await writeFileIfChanged(filePath, 'same content');
    assert.equal(result, false);
    const after = await stat(filePath);
    assert.equal(after.mtimeMs, before.mtimeMs, 'mtime must not change on skip');
    assert.equal(getWriteSkipStats().writes, 0);
    assert.equal(getWriteSkipStats().skips, 1);
  });

  test('writes when file size differs (fast path)', async () => {
    const filePath = join(tmp, 'diff-size.txt');
    await writeFile(filePath, 'short');
    const result = await writeFileIfChanged(filePath, 'a longer piece of content');
    assert.equal(result, true);
    assert.equal(await readFile(filePath, 'utf-8'), 'a longer piece of content');
  });

  test('writes when same size but bytes differ at the start', async () => {
    const filePath = join(tmp, 'diff-start.txt');
    await writeFile(filePath, 'XXXXX-rest-of-content');
    const result = await writeFileIfChanged(filePath, 'YYYYY-rest-of-content');
    assert.equal(result, true);
    assert.equal(await readFile(filePath, 'utf-8'), 'YYYYY-rest-of-content');
  });

  test('writes when same size but bytes differ across a chunk boundary', async () => {
    // Build a file larger than 64KB (the internal chunk size) where bytes only differ
    // in the second chunk to verify the streaming compare reads past the first chunk.
    const chunkSize = 64 * 1024;
    const original = Buffer.alloc(chunkSize * 2 + 100, 0x41); // 'A' x ~128KB
    const updated = Buffer.from(original);
    updated[chunkSize + 50] = 0x42; // single byte 'B' in the second chunk

    const filePath = join(tmp, 'large.bin');
    await writeFile(filePath, original);
    const result = await writeFileIfChanged(filePath, updated);
    assert.equal(result, true);

    const onDisk = await readFile(filePath);
    assert.equal(Buffer.compare(onDisk, updated), 0);
  });

  test('skips identical content larger than one chunk', async () => {
    const chunkSize = 64 * 1024;
    const content = Buffer.alloc(chunkSize * 3 + 7, 0x5a); // ~192KB of 'Z'

    const filePath = join(tmp, 'large-same.bin');
    await writeFile(filePath, content);
    const before = await stat(filePath);
    await new Promise((r) => setTimeout(r, 10));

    const result = await writeFileIfChanged(filePath, content);
    assert.equal(result, false);
    const after = await stat(filePath);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });

  test('creates parent directory if missing', async () => {
    const filePath = join(tmp, 'nested', 'deep', 'file.txt');
    const result = await writeFileIfChanged(filePath, 'content');
    assert.equal(result, true);
    assert.equal(await readFile(filePath, 'utf-8'), 'content');
  });

  test('accepts Uint8Array content', async () => {
    const filePath = join(tmp, 'bytes.bin');
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const r1 = await writeFileIfChanged(filePath, bytes);
    assert.equal(r1, true);

    const r2 = await writeFileIfChanged(filePath, new Uint8Array([1, 2, 3, 4, 5]));
    assert.equal(r2, false);
  });

  test('stats accumulate across multiple calls', async () => {
    const a = join(tmp, 'a.txt');
    const b = join(tmp, 'b.txt');

    await writeFileIfChanged(a, 'one');
    await writeFileIfChanged(b, 'two');
    await writeFileIfChanged(a, 'one');         // skip
    await writeFileIfChanged(b, 'two-changed'); // write

    const s = getWriteSkipStats();
    assert.equal(s.writes, 3);
    assert.equal(s.skips, 1);

    resetWriteSkipStats();
    assert.equal(getWriteSkipStats().writes, 0);
    assert.equal(getWriteSkipStats().skips, 0);
  });
});
