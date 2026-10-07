import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { assert } from './limits.mjs';

export async function readHandleBounded(handle, limit) {
  const info = await handle.stat();
  assert(info.isFile() && info.size <= limit, 'Expected a bounded regular input file');
  const chunks = []; let total = 0;
  while (total <= limit) {
    const buffer = Buffer.alloc(Math.min(65536, limit + 1 - total));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
    if (bytesRead === 0) return Buffer.concat(chunks, total);
    total += bytesRead;
    assert(total <= limit, 'Input file grew beyond limit');
    chunks.push(buffer.subarray(0, bytesRead));
  }
  throw new Error('Input exceeds limit');
}
export async function bounded(path, limit) {
  // One handle prevents a pathname replacement from changing the source after inspection.
  // O_NONBLOCK prevents a selected FIFO from hanging before fstat rejects it.
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try { return await readHandleBounded(handle, limit); }
  finally { await handle.close(); }
}
