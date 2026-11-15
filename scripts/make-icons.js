'use strict';
// Generates the PWA PNG icons with no image libraries (zlib only).
// Run: npm run icons   -> web/public/icons/*.png
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'web', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// "K" mark in a unit square.
const shapes = [
  [[0.29, 0.25], [0.41, 0.25], [0.41, 0.75], [0.29, 0.75]],
  [[0.39, 0.50], [0.62, 0.25], [0.77, 0.25], [0.47, 0.57]],
  [[0.47, 0.45], [0.78, 0.75], [0.63, 0.75], [0.40, 0.53]],
];

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function render(size, { rounded }) {
  const SS = 4; // supersampling
  const px = Buffer.alloc(size * size * 4);
  const top = [0x1b, 0x7f, 0x45];
  const bottom = [0x0b, 0x35, 0x56];
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxl + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const inBg = rounded ? inRoundRect(x, y, 0.22) : true;
          if (!inBg) continue;
          bg++;
          if (shapes.some((s) => inPoly(x, y, s))) fg++;
        }
      }
      const n = SS * SS;
      const t = py / size;
      const base = top.map((c, i) => Math.round(c + (bottom[i] - c) * t));
      const f = fg / Math.max(bg, 1);
      const o = (py * size + pxl) * 4;
      px[o] = Math.round(base[0] + (255 - base[0]) * f);
      px[o + 1] = Math.round(base[1] + (255 - base[1]) * f);
      px[o + 2] = Math.round(base[2] + (255 - base[2]) * f);
      px[o + 3] = Math.round((bg / n) * 255);
    }
  }
  return png(size, size, px);
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = {
  'icon-192.png': render(192, { rounded: true }),
  'icon-512.png': render(512, { rounded: true }),
  'icon-maskable-512.png': render(512, { rounded: false }),
  'apple-touch-icon.png': render(180, { rounded: false }),
};
for (const [name, buf] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log('wrote', name, buf.length, 'bytes');
}
