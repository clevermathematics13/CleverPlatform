/**
 * A minimal ZIP writer.
 *
 * This project ships a handful of small CSVs in one archive and nothing else.
 * A dependency would bring a general-purpose compressor, a streaming API and a
 * plugin surface for a job that is a few hundred bytes of header writing, so
 * the format is implemented here instead -- and, being here, it is testable
 * against the bytes rather than trusted.
 *
 * Entries are STORED (method 0), not deflated. The saving on a 700-byte CSV
 * would be invisible and stored entries need no compressor at all; every
 * unzipper, macOS Archive Utility and Windows Explorer included, reads them.
 *
 * Written to the original 1989 spec: no Zip64, no data descriptors, no
 * encryption. The size ceiling that implies -- 65,535 entries, 4 GB -- is not
 * one a folder of class score files will meet.
 */

import { crc32 } from "./crc32";

export type ZipEntry = {
  /** Path inside the archive. Forward slashes, no leading slash. */
  name: string;
  content: string | Uint8Array;
  /** Defaults to now. Fixed in tests so the bytes are reproducible. */
  date?: Date;
};

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_SIG = 0x06054b50;
/** 2.0 -- the version that introduced the fields this writer uses. */
const VERSION_NEEDED = 20;
/** Bit 11: the name is UTF-8. Without it a name with an accent in it decodes
 *  as mojibake on Windows. */
const UTF8_FLAG = 0x0800;

/**
 * MS-DOS date and time, which is what ZIP stores: a 1980-epoch date packed
 * into 16 bits and a time with two-second resolution into another 16.
 */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  };
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

/** Little-endian, which is the only byte order in the format. */
function u16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}
function u32(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The archive: every entry's local header and data, then a central directory
 * describing them, then the end-of-central-directory record that says where
 * the directory starts. Readers work backwards from that last record, which is
 * why the offsets recorded along the way have to be exact.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const data = toBytes(entry.content);
    const crc = crc32(data);
    const { date, time } = dosDateTime(entry.date ?? new Date());

    const localHeader = concat([
      u32(LOCAL_HEADER_SIG),
      u16(VERSION_NEEDED),
      u16(UTF8_FLAG),
      u16(0), // stored
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length), // compressed size == uncompressed, being stored
      u32(data.length),
      u16(name.length),
      u16(0), // no extra field
      name,
    ]);
    local.push(localHeader, data);

    central.push(
      concat([
        u32(CENTRAL_HEADER_SIG),
        u16(VERSION_NEEDED), // version made by
        u16(VERSION_NEEDED),
        u16(UTF8_FLAG),
        u16(0),
        u16(time),
        u16(date),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk number
        u16(0), // internal attributes
        u32(0), // external attributes
        u32(offset), // where this entry's local header is
        name,
      ])
    );

    offset += localHeader.length + data.length;
  }

  const directory = concat(central);
  const end = concat([
    u32(END_OF_CENTRAL_SIG),
    u16(0), // this disk
    u16(0), // disk with the directory
    u16(entries.length),
    u16(entries.length),
    u32(directory.length),
    u32(offset), // directory starts where the last entry ended
    u16(0), // no archive comment
  ]);

  return concat([...local, directory, end]);
}
