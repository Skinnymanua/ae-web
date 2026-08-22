/**
 * Reads/writes .aem map files in the exact binary format used by
 * net.toyknight.aeii.utils.MapFactory (Java DataInputStream/DataOutputStream).
 *
 * Format (big-endian throughout, matches writeMap()):
 *   UTF   author              (Java "modified UTF-8": 2-byte length prefix + bytes)
 *   bool  teamAccess[4]       (1 byte each, 0x00/0x01)
 *   int32 width
 *   int32 height
 *   int16 tiles[width * height]   (column-major: outer loop x, inner loop y)
 *   int32 unitCount
 *   unitCount * { int32 team, int32 unitIndex, int32 x, int32 y }
 */

const fs = require("fs");

class JavaBufferReader {
  constructor(buffer) {
    this.buf = buffer;
    this.offset = 0;
  }

  readUTF() {
    // Java's DataOutputStream#writeUTF prefixes with a 2-byte length (in bytes,
    // "modified UTF-8" encoded). For ASCII author names this is identical to
    // plain UTF-8, which covers the vast majority of real map files.
    const len = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    const str = this.buf.toString("utf8", this.offset, this.offset + len);
    this.offset += len;
    return str;
  }

  readBoolean() {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v !== 0;
  }

  readInt32() {
    const v = this.buf.readInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  readInt16() {
    const v = this.buf.readInt16BE(this.offset);
    this.offset += 2;
    return v;
  }
}

class JavaBufferWriter {
  constructor() {
    this.chunks = [];
  }

  writeUTF(str) {
    const strBuf = Buffer.from(str, "utf8");
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(strBuf.length, 0);
    this.chunks.push(lenBuf, strBuf);
  }

  writeBoolean(v) {
    this.chunks.push(Buffer.from([v ? 1 : 0]));
  }

  writeInt32(v) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v, 0);
    this.chunks.push(b);
  }

  writeInt16(v) {
    const b = Buffer.alloc(2);
    b.writeInt16BE(v, 0);
    this.chunks.push(b);
  }

  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}

function readMap(filePath) {
  const buf = fs.readFileSync(filePath);
  const r = new JavaBufferReader(buf);

  const author = r.readUTF();
  const teamAccess = [0, 1, 2, 3].map(() => r.readBoolean());
  const width = r.readInt32();
  const height = r.readInt32();

  if (width < 5 || width > 21 || height < 5 || height > 21) {
    throw new Error(`Invalid map size ${width}x${height} (expected 5-21)`);
  }

  // column-major: tiles[x][y], matching the Java write loop order exactly
  const tiles = [];
  for (let x = 0; x < width; x++) {
    const col = [];
    for (let y = 0; y < height; y++) {
      col.push(r.readInt16());
    }
    tiles.push(col);
  }

  const unitCount = r.readInt32();
  const units = [];
  for (let i = 0; i < unitCount; i++) {
    units.push({
      team: r.readInt32(),
      unitIndex: r.readInt32(),
      x: r.readInt32(),
      y: r.readInt32(),
    });
  }

  return { author, teamAccess, width, height, tiles, units };
}

function writeMap(map, filePath) {
  const w = new JavaBufferWriter();
  w.writeUTF(map.author || "");
  for (let team = 0; team < 4; team++) {
    w.writeBoolean(!!map.teamAccess[team]);
  }
  w.writeInt32(map.width);
  w.writeInt32(map.height);
  for (let x = 0; x < map.width; x++) {
    for (let y = 0; y < map.height; y++) {
      w.writeInt16(map.tiles[x][y]);
    }
  }
  w.writeInt32(map.units.length);
  for (const unit of map.units) {
    w.writeInt32(unit.team);
    w.writeInt32(unit.unitIndex);
    w.writeInt32(unit.x);
    w.writeInt32(unit.y);
  }
  fs.writeFileSync(filePath, w.toBuffer());
}

module.exports = { readMap, writeMap };

// CLI usage: node map-format.js <path-to-.aem-file>
// Prints a JSON summary so you can sanity-check parsing against a real map.
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node map-format.js <path-to-.aem-file>");
    process.exit(1);
  }
  const map = readMap(filePath);
  console.log(
    JSON.stringify(
      {
        author: map.author,
        teamAccess: map.teamAccess,
        width: map.width,
        height: map.height,
        unitCount: map.units.length,
        units: map.units.slice(0, 5),
        firstColumnTiles: map.tiles[0],
      },
      null,
      2
    )
  );
}
