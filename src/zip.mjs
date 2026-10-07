import { Inflate, zipSync } from 'fflate';
import { LIMITS, assert, decode, utf8 } from './limits.mjs';

const table = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let j = 0; j < 8; j++) i = (i >>> 1) ^ ((i & 1) ? 0xedb88320 : 0);
  return i >>> 0;
});
export function crc32(bytes) { let crc = 0xffffffff; for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
const allowed = /^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(?:app|core|custom)\.xml|xl\/(?:workbook\.xml|styles\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|theme\/theme1\.xml|worksheets\/sheet[123]\.xml))$/;

export function readZip(bytes) {
  assert(bytes instanceof Uint8Array && bytes.length <= LIMITS.workbookBytes, 'Workbook exceeds 16 MiB');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = p => dv.getUint16(p, true), u32 = p => dv.getUint32(p, true);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) { end = p; break; }
  assert(end >= 0, 'Invalid ZIP end record');
  const count = u16(end + 10), size = u32(end + 12), offset = u32(end + 16);
  assert(u16(end + 4) === 0 && u16(end + 6) === 0 && u16(end + 8) === count, 'Split ZIP is unsupported');
  assert(count > 0 && count <= LIMITS.zipFiles && offset + size === end, 'ZIP directory bounds exceeded');
  const entries = [], seen = new Set(); let p = offset, expanded = 0;
  for (let i = 0; i < count; i++) {
    assert(p + 46 <= end && u32(p) === 0x02014b50, 'Invalid ZIP directory');
    const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16), compressed = u32(p + 20), length = u32(p + 24);
    const nameLength = u16(p + 28), extraLength = u16(p + 30), commentLength = u16(p + 32), local = u32(p + 42);
    assert(p + 46 + nameLength + extraLength + commentLength <= end, 'Invalid ZIP entry bounds');
    const name = decode(bytes.subarray(p + 46, p + 46 + nameLength));
    assert(allowed.test(name) && !seen.has(name.toLowerCase()), 'Unknown or duplicate workbook ZIP part'); seen.add(name.toLowerCase());
    assert((flags & ~0x080e) === 0 && (method === 0 || method === 8) && u16(p + 34) === 0, 'Encrypted or unsupported ZIP encoding');
    assert(length <= LIMITS.zipPart && (expanded += length) <= LIMITS.zipExpanded && compressed <= LIMITS.workbookBytes, 'Expanded ZIP exceeds limits');
    assert(local + 30 <= offset && u32(local) === 0x04034b50, 'Invalid local ZIP header');
    const localNameLength = u16(local + 26), start = local + 30 + localNameLength + u16(local + 28);
    assert(start + compressed <= offset && u16(local + 6) === flags && u16(local + 8) === method, 'ZIP local-header mismatch');
    assert(decode(bytes.subarray(local + 30, local + 30 + localNameLength)) === name, 'ZIP local name mismatch');
    if (!(flags & 8)) assert(u32(local + 14) === crc && u32(local + 18) === compressed && u32(local + 22) === length, 'ZIP local size mismatch');
    entries.push({ name, local, start, compressed, length, crc, method });
    p += 46 + nameLength + extraLength + commentLength;
  }
  assert(p === end, 'Unexpected ZIP directory data');
  const sorted = [...entries].sort((a, b) => a.local - b.local);
  for (let i = 1; i < sorted.length; i++) assert(sorted[i].local >= sorted[i - 1].start + sorted[i - 1].compressed, 'Overlapping ZIP entries');
  const result = new Map(); let actual = 0;
  for (const entry of entries) {
    const chunks = []; let produced = 0;
    const take = chunk => {
      produced += chunk.length; actual += chunk.length;
      assert(produced <= entry.length && actual <= LIMITS.zipExpanded, 'ZIP actual expansion exceeds declared limits');
      chunks.push(chunk.slice());
    };
    const compressed = bytes.subarray(entry.start, entry.start + entry.compressed);
    if (entry.method === 0) take(compressed);
    else {
      const inflater = new Inflate(take);
      for (let i = 0; i < compressed.length; i += 1024) inflater.push(compressed.subarray(i, i + 1024), i + 1024 >= compressed.length);
      if (!compressed.length) inflater.push(new Uint8Array(), true);
    }
    assert(produced === entry.length, 'ZIP uncompressed-size mismatch');
    const data = new Uint8Array(produced); let at = 0;
    for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
    assert(crc32(data) === entry.crc, 'ZIP CRC mismatch'); result.set(entry.name, decode(data));
  }
  return result;
}

export function writeZip(parts) {
  let total = 0; const encoded = {};
  for (const [name, value] of Object.entries(parts)) {
    const data = utf8.encode(value); total += data.length;
    assert(data.length <= LIMITS.zipPart && total <= LIMITS.zipExpanded, 'Generated XML exceeds expanded workbook budget');
    encoded[name] = [data, { mtime: new Date('2020-01-01T00:00:00Z') }];
  }
  const bytes = zipSync(encoded, { level: 6 });
  assert(bytes.length <= LIMITS.workbookBytes, 'Generated workbook exceeds 16 MiB');
  return bytes;
}
