/*!
 * zqr.js - dependency-free QR Code encoder (ISO/IEC 18004).
 *
 * Usage in a browser:   <script src="/js/vendor/zqr.js"></script>  ->  window.ZQR
 * Usage in Node:        const ZQR = require('./public/js/vendor/zqr.js');
 *
 * Public API
 *   ZQR.encode(text, options) -> { size, version, ecl, mask, modules }
 *   ZQR.svg(text, options)    -> standalone "<svg ...>...</svg>" string
 *
 * options: { ecl, margin, scale, dark, light, minVersion, maxVersion }
 *
 * No dependencies, no network access, no build step.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ZQR = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ==========================================================================
  // 1. Constants and static tables from ISO/IEC 18004
  // ==========================================================================

  const MIN_VERSION = 1;
  const MAX_VERSION = 40;

  // Error correction levels. `formatBits` is the 2-bit indicator embedded in
  // the format information (L=01, M=00, Q=11, H=10).
  const ECL_TABLE = {
    L: { index: 0, formatBits: 1 },
    M: { index: 1, formatBits: 0 },
    Q: { index: 2, formatBits: 3 },
    H: { index: 3, formatBits: 2 }
  };

  // Mode indicator + character count indicator widths for the three version
  // groups: 1-9, 10-26, 27-40.
  const MODE_NUMERIC = { name: 'numeric', bits: 0x1, cc: [10, 12, 14] };
  const MODE_ALNUM = { name: 'alphanumeric', bits: 0x2, cc: [9, 11, 13] };
  const MODE_BYTE = { name: 'byte', bits: 0x4, cc: [8, 16, 16] };

  const ALNUM_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  // Number of error correction codewords per block, indexed
  // [eclIndex][version]; index 0 of each row is an unused placeholder.
  const ECC_CODEWORDS_PER_BLOCK = [
    // L
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28,
      28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    // M
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
      26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    // Q
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26,
      30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    // H
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26,
      28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];

  // Number of error correction blocks, indexed [eclIndex][version].
  const NUM_BLOCKS = [
    // L
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7,
      8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    // M
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14,
      16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    // Q
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21,
      20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    // H
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25,
      25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  // Row/column centre coordinates of the alignment patterns, indexed by
  // version. Version 1 has none; the three coordinate pairs that collide with
  // the finder patterns are skipped when drawing.
  const ALIGN_POSITIONS = [
    /*  0 */[],
    /*  1 */[],
    /*  2 */[6, 18],
    /*  3 */[6, 22],
    /*  4 */[6, 26],
    /*  5 */[6, 30],
    /*  6 */[6, 34],
    /*  7 */[6, 22, 38],
    /*  8 */[6, 24, 42],
    /*  9 */[6, 26, 46],
    /* 10 */[6, 28, 50],
    /* 11 */[6, 30, 54],
    /* 12 */[6, 32, 58],
    /* 13 */[6, 34, 62],
    /* 14 */[6, 26, 46, 66],
    /* 15 */[6, 26, 48, 70],
    /* 16 */[6, 26, 50, 74],
    /* 17 */[6, 30, 54, 78],
    /* 18 */[6, 30, 56, 82],
    /* 19 */[6, 30, 58, 86],
    /* 20 */[6, 34, 62, 90],
    /* 21 */[6, 28, 50, 72, 94],
    /* 22 */[6, 26, 50, 74, 98],
    /* 23 */[6, 30, 54, 78, 102],
    /* 24 */[6, 28, 54, 80, 106],
    /* 25 */[6, 32, 58, 84, 110],
    /* 26 */[6, 30, 58, 86, 114],
    /* 27 */[6, 34, 62, 90, 118],
    /* 28 */[6, 26, 50, 74, 98, 122],
    /* 29 */[6, 30, 54, 78, 102, 126],
    /* 30 */[6, 26, 52, 78, 104, 130],
    /* 31 */[6, 30, 56, 82, 108, 134],
    /* 32 */[6, 34, 60, 86, 112, 138],
    /* 33 */[6, 30, 58, 86, 114, 142],
    /* 34 */[6, 34, 62, 90, 118, 146],
    /* 35 */[6, 30, 54, 78, 102, 126, 150],
    /* 36 */[6, 24, 50, 76, 102, 128, 154],
    /* 37 */[6, 28, 54, 80, 106, 132, 158],
    /* 38 */[6, 32, 58, 84, 110, 136, 162],
    /* 39 */[6, 26, 54, 82, 110, 138, 166],
    /* 40 */[6, 30, 58, 86, 114, 142, 170]
  ];

  // Mask penalty weights (ISO/IEC 18004 table 11).
  const PENALTY_N1 = 3;
  const PENALTY_N2 = 3;
  const PENALTY_N3 = 40;
  const PENALTY_N4 = 10;

  // ==========================================================================
  // 2. GF(256) arithmetic and Reed-Solomon
  // ==========================================================================

  // Field generated by x^8 + x^4 + x^3 + x^2 + 1 (0x11D), generator element 2.
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function buildGaloisTables() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  // Generator polynomial of the given degree, highest power first, monic.
  const generatorCache = {};
  function rsGeneratorPoly(degree) {
    if (generatorCache[degree]) return generatorCache[degree];
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];                        // multiply by x
        next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);  // multiply by alpha^i
      }
      poly = next;
    }
    generatorCache[degree] = poly;
    return poly;
  }

  // Remainder of data * x^degree divided by the generator polynomial.
  function rsRemainder(data, degree) {
    const gen = rsGeneratorPoly(degree);
    const work = new Uint8Array(data.length + degree);
    work.set(data, 0);
    for (let i = 0; i < data.length; i++) {
      const coef = work[i];
      if (coef === 0) continue;
      for (let j = 1; j <= degree; j++) work[i + j] ^= gfMul(gen[j], coef);
    }
    return work.subarray(data.length);
  }

  // ==========================================================================
  // 3. Bit buffer and text analysis
  // ==========================================================================

  function BitBuffer() {
    this.bits = [];
  }
  BitBuffer.prototype.append = function (value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };
  BitBuffer.prototype.length = function () {
    return this.bits.length;
  };

  function isNumericText(text) {
    if (text.length === 0) return false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x30 || c > 0x39) return false;
    }
    return true;
  }

  function isAlnumText(text) {
    if (text.length === 0) return false;
    for (let i = 0; i < text.length; i++) {
      if (ALNUM_CHARS.indexOf(text.charAt(i)) < 0) return false;
    }
    return true;
  }

  // Minimal UTF-8 encoder (no TextEncoder dependency).
  function utf8Bytes(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      let cp = text.codePointAt(i);
      if (cp > 0xffff) i++; // consumed a surrogate pair
      if (cp < 0x80) {
        out.push(cp);
      } else if (cp < 0x800) {
        out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      } else if (cp < 0x10000) {
        out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
      }
    }
    return out;
  }

  // Chooses the single best mode for the whole string.
  function chooseSegment(text) {
    if (isNumericText(text)) return { mode: MODE_NUMERIC, charCount: text.length, text: text };
    if (isAlnumText(text)) return { mode: MODE_ALNUM, charCount: text.length, text: text };
    const bytes = utf8Bytes(text);
    return { mode: MODE_BYTE, charCount: bytes.length, bytes: bytes };
  }

  function ccBitsFor(mode, version) {
    const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    return mode.cc[group];
  }

  // Payload bit count of a segment, excluding mode and count indicators.
  function payloadBits(segment) {
    const n = segment.charCount;
    if (segment.mode === MODE_NUMERIC) {
      return Math.floor(n / 3) * 10 + [0, 4, 7][n % 3];
    }
    if (segment.mode === MODE_ALNUM) {
      return Math.floor(n / 2) * 11 + (n % 2) * 6;
    }
    return n * 8;
  }

  function writeSegment(bb, segment, version) {
    bb.append(segment.mode.bits, 4);
    bb.append(segment.charCount, ccBitsFor(segment.mode, version));
    if (segment.mode === MODE_NUMERIC) {
      const t = segment.text;
      let i = 0;
      for (; i + 3 <= t.length; i += 3) bb.append(parseInt(t.substr(i, 3), 10), 10);
      const rest = t.length - i;
      if (rest === 2) bb.append(parseInt(t.substr(i, 2), 10), 7);
      else if (rest === 1) bb.append(parseInt(t.substr(i, 1), 10), 4);
    } else if (segment.mode === MODE_ALNUM) {
      const t = segment.text;
      let i = 0;
      for (; i + 2 <= t.length; i += 2) {
        bb.append(ALNUM_CHARS.indexOf(t.charAt(i)) * 45 + ALNUM_CHARS.indexOf(t.charAt(i + 1)), 11);
      }
      if (i < t.length) bb.append(ALNUM_CHARS.indexOf(t.charAt(i)), 6);
    } else {
      for (let i = 0; i < segment.bytes.length; i++) bb.append(segment.bytes[i], 8);
    }
  }

  // ==========================================================================
  // 4. Capacity helpers
  // ==========================================================================

  // Number of modules available for data + EC codewords (includes remainder
  // bits, which is why the codeword count is floored).
  function numRawDataModules(version) {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      const numAlign = Math.floor(version / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }

  function numTotalCodewords(version) {
    return Math.floor(numRawDataModules(version) / 8);
  }

  function numDataCodewords(version, eclIndex) {
    return (
      numTotalCodewords(version) -
      ECC_CODEWORDS_PER_BLOCK[eclIndex][version] * NUM_BLOCKS[eclIndex][version]
    );
  }

  // ==========================================================================
  // 5. Codeword generation: padding, Reed-Solomon, interleaving
  // ==========================================================================

  function buildDataCodewords(segment, version, eclIndex) {
    const capacityBits = numDataCodewords(version, eclIndex) * 8;
    const bb = new BitBuffer();
    writeSegment(bb, segment, version);
    if (bb.length() > capacityBits) {
      throw new Error('zqr: internal error, segment exceeds selected version capacity');
    }
    // Terminator (up to four zero bits), then zero-pad to a byte boundary.
    const terminator = Math.min(4, capacityBits - bb.length());
    bb.append(0, terminator);
    bb.append(0, (8 - (bb.length() % 8)) % 8);
    // Alternating pad codewords 0xEC / 0x11.
    let pad = 0xec;
    while (bb.length() < capacityBits) {
      bb.append(pad, 8);
      pad = pad === 0xec ? 0x11 : 0xec;
    }
    const bytes = new Uint8Array(capacityBits / 8);
    for (let i = 0; i < bb.bits.length; i++) {
      bytes[i >>> 3] |= bb.bits[i] << (7 - (i & 7));
    }
    return bytes;
  }

  // Splits data codewords into blocks, appends EC codewords, and interleaves
  // both groups into the final codeword sequence.
  function addEccAndInterleave(data, version, eclIndex) {
    const numBlocks = NUM_BLOCKS[eclIndex][version];
    const eccLen = ECC_CODEWORDS_PER_BLOCK[eclIndex][version];
    const totalCw = numTotalCodewords(version);
    const shortBlockLen = Math.floor(totalCw / numBlocks);
    const numShortBlocks = numBlocks - (totalCw % numBlocks);

    const blocks = [];
    let offset = 0;
    let maxDataLen = 0;
    for (let b = 0; b < numBlocks; b++) {
      const blockLen = shortBlockLen + (b < numShortBlocks ? 0 : 1);
      const dataLen = blockLen - eccLen;
      const dat = data.subarray(offset, offset + dataLen);
      offset += dataLen;
      blocks.push({ data: dat, ecc: rsRemainder(dat, eccLen) });
      if (dataLen > maxDataLen) maxDataLen = dataLen;
    }
    if (offset !== data.length) {
      throw new Error('zqr: internal error, data codeword split mismatch');
    }

    const result = new Uint8Array(totalCw);
    let k = 0;
    for (let i = 0; i < maxDataLen; i++) {
      for (let b = 0; b < numBlocks; b++) {
        if (i < blocks[b].data.length) result[k++] = blocks[b].data[i];
      }
    }
    for (let i = 0; i < eccLen; i++) {
      for (let b = 0; b < numBlocks; b++) result[k++] = blocks[b].ecc[i];
    }
    if (k !== totalCw) throw new Error('zqr: internal error, interleave length mismatch');
    return result;
  }

  // ==========================================================================
  // 6. Matrix construction
  // ==========================================================================

  function Matrix(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = new Uint8Array(this.size * this.size);
    this.isFunction = new Uint8Array(this.size * this.size);
  }
  Matrix.prototype.set = function (x, y, dark) {
    this.modules[y * this.size + x] = dark ? 1 : 0;
  };
  Matrix.prototype.get = function (x, y) {
    return this.modules[y * this.size + x];
  };
  Matrix.prototype.setFunction = function (x, y, dark) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.modules[y * this.size + x] = dark ? 1 : 0;
    this.isFunction[y * this.size + x] = 1;
  };

  function drawFinderPattern(m, cx, cy) {
    // 7x7 finder plus the surrounding one-module separator (distance 4).
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        m.setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  }

  function drawAlignmentPattern(m, cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        m.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  // BCH(15,5) format information, masked with 0x5412.
  function formatInfoBits(eclFormatBits, mask) {
    const data = (eclFormatBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return (((data << 10) | (rem & 0x3ff)) ^ 0x5412) & 0x7fff;
  }

  // BCH(18,6) version information, masked with 0x1F25.
  function versionInfoBits(version) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return ((version << 12) | (rem & 0xfff)) & 0x3ffff;
  }

  function drawFormatInfo(m, eclFormatBits, mask) {
    const bits = formatInfoBits(eclFormatBits, mask);
    const size = m.size;
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    // First copy, around the top-left finder pattern.
    for (let i = 0; i <= 5; i++) m.setFunction(8, i, bit(i));
    m.setFunction(8, 7, bit(6));
    m.setFunction(8, 8, bit(7));
    m.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) m.setFunction(14 - i, 8, bit(i));
    // Second copy, split between the top-right and bottom-left finders.
    for (let i = 0; i < 8; i++) m.setFunction(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) m.setFunction(8, size - 15 + i, bit(i));
    m.setFunction(8, size - 8, true); // dark module
  }

  function drawFunctionPatterns(m) {
    const size = m.size;
    // Timing patterns.
    for (let i = 0; i < size; i++) {
      m.setFunction(6, i, i % 2 === 0);
      m.setFunction(i, 6, i % 2 === 0);
    }
    // Finder patterns and separators.
    drawFinderPattern(m, 3, 3);
    drawFinderPattern(m, size - 4, 3);
    drawFinderPattern(m, 3, size - 4);
    // Alignment patterns (skipping the three finder corners).
    const pos = ALIGN_POSITIONS[m.version];
    const last = pos.length - 1;
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        drawAlignmentPattern(m, pos[j], pos[i]);
      }
    }
    // Version information (versions 7 and up).
    if (m.version >= 7) {
      const bits = versionInfoBits(m.version);
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        m.setFunction(a, b, dark);
        m.setFunction(b, a, dark);
      }
    }
    // Reserve the format information area (real values drawn later).
    drawFormatInfo(m, 0, 0);
  }

  // Standard two-module-wide zigzag placement, skipping function modules and
  // the vertical timing column.
  function drawCodewords(m, codewords) {
    const size = m.size;
    let bitIndex = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (m.isFunction[y * size + x] || bitIndex >= totalBits) continue;
          const bit = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
          m.modules[y * size + x] = bit;
          bitIndex++;
        }
      }
    }
    if (bitIndex !== totalBits) {
      throw new Error('zqr: internal error, placed ' + bitIndex + ' of ' + totalBits + ' bits');
    }
    // Remaining modules stay light, as required for remainder bits.
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: throw new Error('zqr: invalid mask ' + mask);
    }
  }

  function applyMask(m, mask) {
    const size = m.size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        if (m.isFunction[idx]) continue;
        if (maskBit(mask, x, y)) m.modules[idx] ^= 1;
      }
    }
  }

  // --------------------------------------------------------------------------
  // Mask penalty scoring (four standard rules)
  // --------------------------------------------------------------------------

  const FINDER_LIKE_A = '10111010000';
  const FINDER_LIKE_B = '00001011101';

  function countPattern(line, pattern) {
    let count = 0;
    let from = line.indexOf(pattern);
    while (from >= 0) {
      count++;
      from = line.indexOf(pattern, from + 1);
    }
    return count;
  }

  function penaltyScore(m) {
    const size = m.size;
    const mod = m.modules;
    let score = 0;

    // Rule 1: runs of five or more same-coloured modules in a row/column.
    // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules on a side.
    for (let y = 0; y < size; y++) {
      let line = '';
      let runColor = mod[y * size];
      let runLength = 0;
      for (let x = 0; x < size; x++) {
        const v = mod[y * size + x];
        line += v ? '1' : '0';
        if (v === runColor) {
          runLength++;
        } else {
          if (runLength >= 5) score += PENALTY_N1 + (runLength - 5);
          runColor = v;
          runLength = 1;
        }
      }
      if (runLength >= 5) score += PENALTY_N1 + (runLength - 5);
      score += PENALTY_N3 * (countPattern(line, FINDER_LIKE_A) + countPattern(line, FINDER_LIKE_B));
    }
    for (let x = 0; x < size; x++) {
      let line = '';
      let runColor = mod[x];
      let runLength = 0;
      for (let y = 0; y < size; y++) {
        const v = mod[y * size + x];
        line += v ? '1' : '0';
        if (v === runColor) {
          runLength++;
        } else {
          if (runLength >= 5) score += PENALTY_N1 + (runLength - 5);
          runColor = v;
          runLength = 1;
        }
      }
      if (runLength >= 5) score += PENALTY_N1 + (runLength - 5);
      score += PENALTY_N3 * (countPattern(line, FINDER_LIKE_A) + countPattern(line, FINDER_LIKE_B));
    }

    // Rule 2: 2x2 blocks of one colour.
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const v = mod[y * size + x];
        if (
          v === mod[y * size + x + 1] &&
          v === mod[(y + 1) * size + x] &&
          v === mod[(y + 1) * size + x + 1]
        ) {
          score += PENALTY_N2;
        }
      }
    }

    // Rule 4: deviation of the dark module proportion from 50%.
    let dark = 0;
    for (let i = 0; i < mod.length; i++) dark += mod[i];
    const total = size * size;
    // Smallest k >= 0 such that (50 - 5k)% <= dark/total <= (50 + 5k)%.
    const k = Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1);
    score += PENALTY_N4 * k;

    return score;
  }

  // ==========================================================================
  // 7. Public API
  // ==========================================================================

  function normalizeOptions(options) {
    const o = options || {};
    const eclName = (o.ecl === undefined || o.ecl === null ? 'M' : String(o.ecl)).toUpperCase();
    if (!ECL_TABLE[eclName]) {
      throw new Error("zqr: invalid ecl '" + o.ecl + "', expected 'L', 'M', 'Q' or 'H'");
    }
    const minVersion = o.minVersion === undefined ? MIN_VERSION : Math.floor(o.minVersion);
    const maxVersion = o.maxVersion === undefined ? MAX_VERSION : Math.floor(o.maxVersion);
    if (
      !isFinite(minVersion) || !isFinite(maxVersion) ||
      minVersion < MIN_VERSION || maxVersion > MAX_VERSION || minVersion > maxVersion
    ) {
      throw new Error('zqr: invalid version range ' + minVersion + '..' + maxVersion);
    }
    const margin = o.margin === undefined ? 4 : Math.floor(o.margin);
    if (!isFinite(margin) || margin < 0) throw new Error('zqr: invalid margin ' + o.margin);
    const scale = o.scale === undefined ? 4 : Number(o.scale);
    if (!isFinite(scale) || scale <= 0) throw new Error('zqr: invalid scale ' + o.scale);
    return {
      eclName: eclName,
      ecl: ECL_TABLE[eclName],
      minVersion: minVersion,
      maxVersion: maxVersion,
      margin: margin,
      scale: scale,
      dark: o.dark === undefined ? '#000' : String(o.dark),
      light: o.light === undefined ? '#fff' : String(o.light)
    };
  }

  function encode(text, options) {
    if (text === undefined || text === null) throw new Error('zqr: text is required');
    const str = typeof text === 'string' ? text : String(text);
    const opts = normalizeOptions(options);
    const eclIndex = opts.ecl.index;

    const segment = chooseSegment(str);
    const bodyBits = payloadBits(segment);

    // Smallest version in range that fits mode + count indicator + payload.
    let version = -1;
    for (let v = opts.minVersion; v <= opts.maxVersion; v++) {
      const needed = 4 + ccBitsFor(segment.mode, v) + bodyBits;
      if (needed <= numDataCodewords(v, eclIndex) * 8) {
        version = v;
        break;
      }
    }
    if (version < 0) {
      const capacity = numDataCodewords(opts.maxVersion, eclIndex) * 8;
      const needed = 4 + ccBitsFor(segment.mode, opts.maxVersion) + bodyBits;
      throw new Error(
        'zqr: data too long - ' + segment.charCount + ' ' + segment.mode.name +
        ' units need ' + needed + ' bits but version ' + opts.maxVersion +
        ' at ECL ' + opts.eclName + ' holds only ' + capacity + ' bits'
      );
    }

    const data = buildDataCodewords(segment, version, eclIndex);
    const codewords = addEccAndInterleave(data, version, eclIndex);

    const m = new Matrix(version);
    drawFunctionPatterns(m);
    drawCodewords(m, codewords);

    // Try every mask, keep the lowest penalty score.
    let bestMask = 0;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(m, mask);
      drawFormatInfo(m, opts.ecl.formatBits, mask);
      const score = penaltyScore(m);
      if (score < bestScore) {
        bestScore = score;
        bestMask = mask;
      }
      applyMask(m, mask); // undo (XOR is its own inverse)
    }
    applyMask(m, bestMask);
    drawFormatInfo(m, opts.ecl.formatBits, bestMask);

    return {
      size: m.size,
      version: version,
      ecl: opts.eclName,
      mask: bestMask,
      modules: m.modules
    };
  }

  // Compact numeric formatting so no NaN/exponent noise reaches the markup.
  function fmt(n) {
    const r = Math.round(n * 1000) / 1000;
    if (!isFinite(r)) throw new Error('zqr: non-finite geometry value');
    return String(r);
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function svg(text, options) {
    const opts = normalizeOptions(options);
    const qr = encode(text, options);
    const dim = qr.size + opts.margin * 2;
    const pixels = fmt(dim * opts.scale);

    // One path built from unit squares: crisp at any scale, tiny output.
    let path = '';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (!qr.modules[y * qr.size + x]) continue;
        if (path) path += ' ';
        path += 'M' + (x + opts.margin) + ',' + (y + opts.margin) + 'h1v1h-1z';
      }
    }

    const transparent = opts.light === 'transparent' || opts.light === 'none';
    let out = '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" role="img"' +
      ' width="' + pixels + '" height="' + pixels + '"' +
      ' viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges">';
    out += '<title>QR Code</title>';
    if (!transparent) {
      out += '<rect width="' + dim + '" height="' + dim + '" fill="' + escapeXml(opts.light) + '"/>';
    }
    if (path) out += '<path d="' + path + '" fill="' + escapeXml(opts.dark) + '"/>';
    out += '</svg>';
    return out;
  }

  return {
    encode: encode,
    svg: svg,
    MIN_VERSION: MIN_VERSION,
    MAX_VERSION: MAX_VERSION
  };
});
