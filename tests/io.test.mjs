import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, open, rename, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { bounded, readHandleBounded } from '../src/io.mjs';

test('single-handle bounded read rejects growth beyond the inspected size', async () => {
  let calls = 0, allocated = 0;
  const fake = { stat: async () => ({ isFile: () => true, size: 1 }), read: async buffer => { calls++; allocated += buffer.length; buffer.fill(65); return { bytesRead: buffer.length }; } };
  await assert.rejects(readHandleBounded(fake, 8), /grew/);
  assert.equal(calls, 1); assert.equal(allocated, 9);
});
test('FIFO and symlink inputs reject promptly; opened handles survive pathname replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'branch-sheet-io-'));
  try {
    const path = join(dir, 'input'), replacement = join(dir, 'new'), fifo = join(dir, 'fifo');
    await writeFile(path, 'original'); await writeFile(replacement, 'replacement');
    const handle = await open(path, 'r');
    await rename(replacement, path);
    assert.equal((await readHandleBounded(handle, 32)).toString(), 'original'); await handle.close();
    await symlink(path, join(dir, 'link')); await assert.rejects(bounded(join(dir, 'link'), 32));
    execFileSync('mkfifo', [fifo]); await assert.rejects(bounded(fifo, 32), /regular/);
    assert.equal((await bounded(path, 32)).toString(), 'replacement');
  } finally { await rm(dir, { recursive: true }); }
});
