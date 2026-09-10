/*
 * tests/qr.test.js - independent verification of public/js/vendor/zqr.js
 *
 * Everything in this file is re-derived from ISO/IEC 18004 rules and does not
 * import any table or helper from the encoder:
 *   1. BCH(15,5) format information vs. the published 32-entry table
 *   2. BCH(18,6) version information for versions 7..40
 *   3. A from-scratch decoder: format/version recovery, unmasking, zigzag
 *      codeword reading, de-interleaving, Reed-Solomon syndromes, and full
 *      data decoding back to the original string
 *   4. SVG sanity and geometry consistency
 *
 * Run: node tests/qr.test.js
 */
'use strict';

const path = require('path');
const ZQR = require(path.join(__dirname, '..', 'public', 'js', 'vendor', 'zqr.js'));

// ===========================================================================
// 0. Tiny assertion helpers
// ===========================================================================

let checks = 0;

function fail(msg) {
  console.error('FAIL: ' + msg);
  process.exit(1);
}

function assert(cond, msg) {
  checks++;
  if (!cond) fail(msg);
}

function assertEqual(actual, expected, msg) {
  checks++;
  if (actual !== expected) {
    fail(msg + '\n  expected: ' + JSON.stringify(expected) + '\n  actual:   ' + JSON.stringify(actual));
  }
}

function bin(value, width) {
  let s = (value >>> 0).toString(2);
  while (s.length < width) s = '0' + s;
  return s;
}

function popcount(v) {
  let c = 0;
  while (v) {
    v &= v - 1;
    c++;
  }
  return c;
}

// ===========================================================================
// 1. Format information: independent BCH(15,5), generator 0x537, mask 0x5412
// ===========================================================================

// Long-division based BCH remainder (deliberately written differently from a
// shift-register loop so it is an independent implementation).
function bchRemainder(data, dataWidth, genWidth, generator) {
  // Shift data left by (genWidth - 1) and reduce modulo the generator.
  const genDegree = genWidth - 1;
  let value = data << genDegree;
  for (let bit = dataWidth + genDegree - 1; bit >= genDegree; bit--) {
    if ((value >>> bit) & 1) value ^= generator << (bit - genDegree);
  }
  return value;
}

function formatInfoRef(eclBits, mask) {
  const data = (eclBits << 3) | mask;              // 5 data bits
  const rem = bchRemainder(data, 5, 11, 0x537);    // 10 check bits
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

// The published 32-entry format information table (ISO/IEC 18004 Annex C),
// hardcoded here as literal bit strings. ECL indicator order: L=01, M=00,
// Q=11, H=10; mask 0..7 within each level.
const PUBLISHED_FORMAT_INFO = {
  L: [
    '111011111000100', '111001011110011', '111110110101010', '111100010011101',
    '110011000101111', '110001100011000', '110110001000001', '110100101110110'
  ],
  M: [
    '101010000010010', '101000100100101', '101111001111100', '101101101001011',
    '100010111111001', '100000011001110', '100111110010111', '100101010100000'
  ],
  Q: [
    '011010101011111', '011000001101000', '011111100110001', '011101000000110',
    '010010010110100', '010000110000011', '010111011011010', '010101111101101'
  ],
  H: [
    '001011010001001', '001001110111110', '001110011100111', '001100111010000',
    '000011101100010', '000001001010101', '000110100001100', '000100000111011'
  ]
};

const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const ECL_BY_BITS = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };
const ECL_NAMES = ['L', 'M', 'Q', 'H'];

// All 32 valid format information code words, indexed by (eclBits << 3 | mask).
const FORMAT_CODES = new Array(32);
for (const name of ECL_NAMES) {
  for (let mask = 0; mask < 8; mask++) {
    const value = formatInfoRef(ECL_BITS[name], mask);
    FORMAT_CODES[(ECL_BITS[name] << 3) | mask] = value;
    assertEqual(
      bin(value, 15),
      PUBLISHED_FORMAT_INFO[name][mask],
      'format info mismatch for ECL ' + name + ' mask ' + mask
    );
  }
}

// A few hard constants from the standard.
assertEqual(formatInfoRef(ECL_BITS.M, 0), 0b101010000010010, 'format info (M, mask 0)');
assertEqual(formatInfoRef(ECL_BITS.L, 0), 0b111011111000100, 'format info (L, mask 0)');
assertEqual(formatInfoRef(ECL_BITS.H, 7), 0b000100000111011, 'format info (H, mask 7)');

// BCH decoding of the 15-bit format information by nearest code word.
function decodeFormatInfo(bits) {
  let bestIndex = -1;
  let bestDist = 99;
  for (let i = 0; i < 32; i++) {
    const dist = popcount(bits ^ FORMAT_CODES[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  return { eclBits: bestIndex >>> 3, mask: bestIndex & 7, distance: bestDist };
}

// Error-correction capability: 3 flipped bits must still decode correctly.
(function testFormatCorrection() {
  const clean = formatInfoRef(ECL_BITS.Q, 5);
  const corrupted = clean ^ 0b100000010000100; // 3 bit errors
  const dec = decodeFormatInfo(corrupted);
  assertEqual(dec.eclBits, ECL_BITS.Q, 'BCH(15,5) correction recovered wrong ECL');
  assertEqual(dec.mask, 5, 'BCH(15,5) correction recovered wrong mask');
  assertEqual(dec.distance, 3, 'BCH(15,5) correction reported wrong distance');
})();

// ===========================================================================
// 2. Version information: independent BCH(18,6), generator 0x1F25
// ===========================================================================

function versionInfoRef(version) {
  const rem = bchRemainder(version, 6, 13, 0x1f25); // 12 check bits
  return ((version << 12) | rem) & 0x3ffff;
}

// Known constants from the published version information table (18 bits:
// 6 version bits followed by 12 BCH check bits).
assertEqual(bin(versionInfoRef(7), 18), '000111110010010100', 'version info for version 7');
assertEqual(bin(versionInfoRef(8), 18), '001000010110111100', 'version info for version 8');
assertEqual(bin(versionInfoRef(40), 18), '101000110001101001', 'version info for version 40');

const VERSION_CODES = {};
for (let v = 7; v <= 40; v++) VERSION_CODES[v] = versionInfoRef(v);

// Structural properties of the two BCH codes: the format code corrects three
// bit errors (d >= 7) and the version code corrects three as well (d = 8).
(function testMinimumDistances() {
  let formatMin = 99;
  for (let i = 0; i < 32; i++) {
    for (let j = i + 1; j < 32; j++) {
      formatMin = Math.min(formatMin, popcount(FORMAT_CODES[i] ^ FORMAT_CODES[j]));
    }
  }
  assertEqual(formatMin, 7, 'BCH(15,5) format code minimum Hamming distance');
  let versionMin = 99;
  for (let a = 7; a <= 40; a++) {
    for (let b = a + 1; b <= 40; b++) {
      versionMin = Math.min(versionMin, popcount(VERSION_CODES[a] ^ VERSION_CODES[b]));
    }
  }
  assertEqual(versionMin, 8, 'BCH(18,6) version code minimum Hamming distance');
})();

function decodeVersionInfo(bits) {
  let bestVersion = -1;
  let bestDist = 99;
  for (let v = 7; v <= 40; v++) {
    const dist = popcount(bits ^ VERSION_CODES[v]);
    if (dist < bestDist) {
      bestDist = dist;
      bestVersion = v;
    }
  }
  return { version: bestVersion, distance: bestDist };
}

// ===========================================================================
// 3. Independent GF(256) arithmetic (primitive polynomial 0x11D)
// ===========================================================================

const EXP = new Array(255);
const LOG = new Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = x << 1;
    if (x & 0x100) x ^= 0x11d;
  }
})();

function mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

function alphaPow(k) {
  return EXP[((k % 255) + 255) % 255];
}

// ===========================================================================
// 4. Standard tables needed by the decoder (typed from the specification)
// ===========================================================================

// EC codewords per block, [version][eclIndex] with ecl order L, M, Q, H.
const EC_PER_BLOCK = {
  1: [7, 10, 13, 17], 2: [10, 16, 22, 28], 3: [15, 26, 18, 22], 4: [20, 18, 26, 16],
  5: [26, 24, 18, 22], 6: [18, 16, 24, 28], 7: [20, 18, 18, 26], 8: [24, 22, 22, 26],
  9: [30, 22, 20, 24], 10: [18, 26, 24, 28], 11: [20, 30, 28, 24], 12: [24, 22, 26, 28],
  13: [26, 22, 24, 22], 14: [30, 24, 20, 24], 15: [22, 24, 30, 24], 16: [24, 28, 24, 30],
  17: [28, 28, 28, 28], 18: [30, 26, 28, 28], 19: [28, 26, 26, 26], 20: [28, 26, 30, 28],
  21: [28, 26, 28, 30], 22: [28, 28, 30, 24], 23: [30, 28, 30, 30], 24: [30, 28, 30, 30],
  25: [26, 28, 30, 30], 26: [28, 28, 28, 30], 27: [30, 28, 30, 30], 28: [30, 28, 30, 30],
  29: [30, 28, 30, 30], 30: [30, 28, 30, 30], 31: [30, 28, 30, 30], 32: [30, 28, 30, 30],
  33: [30, 28, 30, 30], 34: [30, 28, 30, 30], 35: [30, 28, 30, 30], 36: [30, 28, 30, 30],
  37: [30, 28, 30, 30], 38: [30, 28, 30, 30], 39: [30, 28, 30, 30], 40: [30, 28, 30, 30]
};

// Number of EC blocks, [version][eclIndex] with ecl order L, M, Q, H.
const EC_BLOCKS = {
  1: [1, 1, 1, 1], 2: [1, 1, 1, 1], 3: [1, 1, 2, 2], 4: [1, 2, 2, 4],
  5: [1, 2, 4, 4], 6: [2, 4, 4, 4], 7: [2, 4, 6, 5], 8: [2, 4, 6, 6],
  9: [2, 5, 8, 8], 10: [4, 5, 8, 8], 11: [4, 5, 8, 11], 12: [4, 8, 10, 11],
  13: [4, 9, 12, 16], 14: [4, 9, 16, 16], 15: [6, 10, 12, 18], 16: [6, 10, 17, 16],
  17: [6, 11, 16, 19], 18: [6, 13, 18, 21], 19: [7, 14, 21, 25], 20: [8, 16, 20, 25],
  21: [8, 17, 23, 25], 22: [9, 17, 23, 34], 23: [9, 18, 25, 30], 24: [10, 20, 27, 32],
  25: [12, 21, 29, 35], 26: [12, 23, 34, 37], 27: [12, 25, 34, 40], 28: [13, 26, 35, 42],
  29: [14, 28, 38, 45], 30: [15, 29, 40, 48], 31: [16, 31, 43, 51], 32: [17, 33, 45, 54],
  33: [18, 35, 48, 57], 34: [19, 37, 51, 60], 35: [19, 38, 53, 63], 36: [20, 40, 56, 66],
  37: [21, 43, 59, 70], 38: [22, 45, 62, 74], 39: [24, 47, 65, 77], 40: [25, 49, 68, 81]
};

// Alignment pattern centres, derived from the spec rule (evenly spaced, first
// at 6, last at size-7, spacing rounded up to an even number) instead of being
// copied from the encoder's table. Version 32 is the documented exception.
function alignPositions(version) {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((size - 13) / (2 * (count - 1))) * 2;
  const out = new Array(count);
  out[0] = 6;
  for (let i = count - 1, pos = size - 7; i >= 1; i--, pos -= step) out[i] = pos;
  return out;
}

// Map of function modules (everything that is not data/EC).
function functionMap(version) {
  const size = version * 4 + 17;
  const fn = new Uint8Array(size * size);
  const mark = (x, y) => {
    if (x >= 0 && y >= 0 && x < size && y < size) fn[y * size + x] = 1;
  };
  // Finder patterns with their separators (8x8 corners).
  for (let dy = 0; dy < 8; dy++) {
    for (let dx = 0; dx < 8; dx++) {
      mark(dx, dy);
      mark(size - 1 - dx, dy);
      mark(dx, size - 1 - dy);
    }
  }
  // Timing patterns.
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  // Format information areas plus the dark module.
  for (let i = 0; i < 9; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  // Version information blocks.
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        mark(size - 11 + j, i);
        mark(i, size - 11 + j);
      }
    }
  }
  // Alignment patterns, skipping the three that overlap finder patterns.
  const pos = alignPositions(version);
  const last = pos.length - 1;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) mark(pos[j] + dx, pos[i] + dy);
      }
    }
  }
  return fn;
}

// Data mask conditions (ISO/IEC 18004 table 10).
function maskCondition(mask, x, y) {
  switch (mask) {
    case 0: return (y + x) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (y + x) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((y * x) % 2) + ((y * x) % 3) === 0;
    case 6: return (((y * x) % 2) + ((y * x) % 3)) % 2 === 0;
    case 7: return (((y + x) % 2) + ((y * x) % 3)) % 2 === 0;
    default: throw new Error('bad mask ' + mask);
  }
}

// ===========================================================================
// 5. From-scratch decoder
// ===========================================================================

function readFormatBits(qr) {
  const size = qr.size;
  const get = (x, y) => qr.modules[y * size + x];
  // Copy 1: down the left of the top-left finder, then right along row 8.
  let a = 0;
  const setA = (i, v) => { a |= v << i; };
  for (let i = 0; i <= 5; i++) setA(i, get(8, i));
  setA(6, get(8, 7));
  setA(7, get(8, 8));
  setA(8, get(7, 8));
  for (let i = 9; i < 15; i++) setA(i, get(14 - i, 8));
  // Copy 2: along row 8 from the right edge, then up the bottom-left column.
  let b = 0;
  const setB = (i, v) => { b |= v << i; };
  for (let i = 0; i < 8; i++) setB(i, get(size - 1 - i, 8));
  for (let i = 8; i < 15; i++) setB(i, get(8, size - 15 + i));
  return { copy1: a, copy2: b };
}

function readVersionBits(qr) {
  const size = qr.size;
  let bits = 0;
  for (let i = 0; i < 18; i++) {
    const x = size - 11 + (i % 3);
    const y = Math.floor(i / 3);
    bits |= qr.modules[y * size + x] << i;
  }
  return bits;
}

// Standard zigzag traversal, unmasking on the fly.
function readRawBits(qr, mask, fn) {
  const size = qr.size;
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fn[y * size + x]) continue;
        let bit = qr.modules[y * size + x];
        if (maskCondition(mask, x, y)) bit ^= 1;
        bits.push(bit);
      }
    }
  }
  return bits;
}

function syndromesAreZero(codewords, ecLen) {
  const n = codewords.length;
  for (let j = 0; j < ecLen; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum ^= mul(codewords[i], alphaPow(j * (n - 1 - i)));
    }
    if (sum !== 0) return false;
  }
  return true;
}

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function decodeQr(qr, label) {
  const size = qr.size;
  assert((size - 17) % 4 === 0 && size >= 21 && size <= 177, label + ': bad matrix size ' + size);
  const version = (size - 17) / 4;

  // (a) format information from both copies.
  const raw = readFormatBits(qr);
  const dec1 = decodeFormatInfo(raw.copy1);
  const dec2 = decodeFormatInfo(raw.copy2);
  assertEqual(dec1.distance, 0, label + ': format info copy 1 is not a valid code word');
  assertEqual(dec2.distance, 0, label + ': format info copy 2 is not a valid code word');
  assertEqual(dec2.eclBits, dec1.eclBits, label + ': format copies disagree on ECL');
  assertEqual(dec2.mask, dec1.mask, label + ': format copies disagree on mask');
  const eclName = ECL_BY_BITS[dec1.eclBits];
  const mask = dec1.mask;
  assertEqual(
    raw.copy1,
    FORMAT_CODES[(ECL_BITS[eclName] << 3) | mask],
    label + ': format bits do not match the published code word'
  );

  // (b) version information for versions 7 and up.
  if (version >= 7) {
    const vdec = decodeVersionInfo(readVersionBits(qr));
    assertEqual(vdec.distance, 0, label + ': version info is not a valid code word');
    assertEqual(vdec.version, version, label + ': version info disagrees with matrix size');
  }

  // (c)+(d) unmask the data region and read the codeword bit stream.
  const fn = functionMap(version);
  let functionModules = 0;
  for (let i = 0; i < fn.length; i++) functionModules += fn[i];
  const rawModules = size * size - functionModules;
  const bits = readRawBits(qr, mask, fn);
  assertEqual(bits.length, rawModules, label + ': traversal visited the wrong module count');

  const totalCodewords = Math.floor(rawModules / 8);
  for (let i = totalCodewords * 8; i < bits.length; i++) {
    assertEqual(bits[i], 0, label + ': remainder bit ' + i + ' is not zero');
  }
  const codewords = new Array(totalCodewords);
  for (let i = 0; i < totalCodewords; i++) {
    let byte = 0;
    for (let k = 0; k < 8; k++) byte = (byte << 1) | bits[i * 8 + k];
    codewords[i] = byte;
  }

  // (e) de-interleave into blocks.
  const eclIndex = ECL_NAMES.indexOf(eclName);
  const ecLen = EC_PER_BLOCK[version][eclIndex];
  const numBlocks = EC_BLOCKS[version][eclIndex];
  const shortLen = Math.floor(totalCodewords / numBlocks);
  const numShort = numBlocks - (totalCodewords % numBlocks);
  const blockDataLen = [];
  let dataCodewordCount = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = (shortLen + (b < numShort ? 0 : 1)) - ecLen;
    assert(len > 0, label + ': non-positive data length for block ' + b);
    blockDataLen.push(len);
    dataCodewordCount += len;
  }
  const maxDataLen = Math.max.apply(null, blockDataLen);

  const blocks = [];
  for (let b = 0; b < numBlocks; b++) blocks.push([]);
  let k = 0;
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < blockDataLen[b]) blocks[b].push(codewords[k++]);
    }
  }
  const ecc = [];
  for (let b = 0; b < numBlocks; b++) ecc.push([]);
  for (let i = 0; i < ecLen; i++) {
    for (let b = 0; b < numBlocks; b++) ecc[b].push(codewords[k++]);
  }
  assertEqual(k, totalCodewords, label + ': de-interleaving consumed the wrong codeword count');

  // (f) Reed-Solomon syndromes for every block must vanish.
  for (let b = 0; b < numBlocks; b++) {
    const full = blocks[b].concat(ecc[b]);
    assert(
      syndromesAreZero(full, ecLen),
      label + ': non-zero Reed-Solomon syndrome in block ' + b + ' (v' + version + ' ' + eclName + ')'
    );
  }

  // (g) decode the data codewords back into text.
  const dataBytes = [];
  for (let b = 0; b < numBlocks; b++) {
    for (let i = 0; i < blocks[b].length; i++) dataBytes.push(blocks[b][i]);
  }
  assertEqual(dataBytes.length, dataCodewordCount, label + ': data codeword count mismatch');

  const totalBits = dataBytes.length * 8;
  let pos = 0;
  const readBits = (n) => {
    assert(pos + n <= totalBits, label + ': bit stream overrun');
    let value = 0;
    for (let i = 0; i < n; i++) {
      const idx = pos + i;
      value = (value << 1) | ((dataBytes[idx >>> 3] >>> (7 - (idx & 7))) & 1);
    }
    pos += n;
    return value;
  };

  const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  const modeBits = readBits(4);
  let text = '';
  let modeName;
  if (modeBits === 1) {
    modeName = 'numeric';
    const count = readBits([10, 12, 14][group]);
    let remaining = count;
    while (remaining >= 3) {
      const v = readBits(10);
      assert(v <= 999, label + ': numeric triple out of range');
      text += String(v).padStart(3, '0');
      remaining -= 3;
    }
    if (remaining === 2) {
      const v = readBits(7);
      assert(v <= 99, label + ': numeric pair out of range');
      text += String(v).padStart(2, '0');
    } else if (remaining === 1) {
      const v = readBits(4);
      assert(v <= 9, label + ': numeric single out of range');
      text += String(v);
    }
  } else if (modeBits === 2) {
    modeName = 'alphanumeric';
    const count = readBits([9, 11, 13][group]);
    let remaining = count;
    while (remaining >= 2) {
      const v = readBits(11);
      assert(v < 45 * 45, label + ': alphanumeric pair out of range');
      text += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45];
      remaining -= 2;
    }
    if (remaining === 1) {
      const v = readBits(6);
      assert(v < 45, label + ': alphanumeric single out of range');
      text += ALNUM[v];
    }
  } else if (modeBits === 4) {
    modeName = 'byte';
    const count = readBits([8, 16, 16][group]);
    const bytes = Buffer.alloc(count);
    for (let i = 0; i < count; i++) bytes[i] = readBits(8);
    text = bytes.toString('utf8');
  } else {
    fail(label + ': unsupported mode indicator ' + modeBits);
  }

  // Terminator, bit padding and 0xEC/0x11 pad codewords.
  const termLen = Math.min(4, totalBits - pos);
  assertEqual(readBits(termLen), 0, label + ': terminator bits are not zero');
  const toBoundary = (8 - (pos % 8)) % 8;
  if (toBoundary > 0) assertEqual(readBits(toBoundary), 0, label + ': bit padding is not zero');
  let expectPad = 0xec;
  while (pos < totalBits) {
    assertEqual(readBits(8), expectPad, label + ': wrong pad codeword');
    expectPad = expectPad === 0xec ? 0x11 : 0xec;
  }

  return { version: version, ecl: eclName, mask: mask, mode: modeName, text: text };
}

// ===========================================================================
// 6. Corpus
// ===========================================================================

function digits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += String((i * 7 + 3) % 10);
  return s;
}

function alnumText(n) {
  const set = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $%*+-./:';
  let s = '';
  for (let i = 0; i < n; i++) s += set[(i * 11 + 5) % set.length];
  return s;
}

function asciiText(n) {
  const set = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ,.;!?()[]{}<>@#_=~^|';
  let s = '';
  for (let i = 0; i < n; i++) s += set[(i * 13 + 2) % set.length];
  return s;
}

function base64Text(n) {
  const set = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < n; i++) s += set[(i * 17 + 9) % 64];
  while (s.length % 4 !== 0) s += '=';
  return s;
}

function arabicText(repeat) {
  const base = 'فاتورة رقم ١٢٣٤٥ بمبلغ ٩٩٩ ريال شاملة الضريبة. ';
  let s = '';
  for (let i = 0; i < repeat; i++) s += base;
  return s.trim();
}

const CORPUS = [
  '0',
  '12345',
  digits(17),
  digits(41),
  digits(120),
  digits(400),
  digits(1100),
  'A',
  'HELLO WORLD',
  'AC-42',
  'INV:2024-000123 SAR 1.234,56',
  alnumText(25),
  alnumText(90),
  alnumText(300),
  'a',
  'lowercase ascii text with punctuation, 2024-05-01.',
  'https://example.com/z-system/invoice?id=42&hash=abcdef0123456789',
  'Invoice #1024 \u2014 total: 1,234.56 \u20ac',
  asciiText(200),
  asciiText(700),
  arabicText(1),
  arabicText(4),
  '\u0669\u0669\u0669',
  base64Text(60),
  base64Text(300),
  base64Text(700),
  base64Text(1200),
  base64Text(1272) // fills version 40 at ECL H (1276 data codewords)
];

// ===========================================================================
// 7. Round-trip over the corpus x all four ECLs
// ===========================================================================

let passed = 0;
let total = 0;
let minVersion = 41;
let maxVersion = 0;
const seenEcl = new Set();
const seenModes = new Set();
const seenMasks = new Set();
const seenVersionEcl = new Set();

// Checks every function-pattern module value directly against the spec shapes.
function verifyFunctionPatterns(qr, version, label) {
  const size = qr.size;
  const get = (x, y) => qr.modules[y * size + x];
  const expect = (x, y, dark, what) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    assertEqual(get(x, y), dark ? 1 : 0, label + ': ' + what + ' at (' + x + ',' + y + ')');
  };

  // Finder patterns (7x7 concentric rings) and their one-module separators.
  const centres = [[3, 3], [size - 4, 3], [3, size - 4]];
  for (const c of centres) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        expect(c[0] + dx, c[1] + dy, dist !== 2 && dist !== 4, 'finder/separator module');
      }
    }
  }

  // Timing patterns between the finder patterns.
  for (let i = 8; i <= size - 9; i++) {
    expect(6, i, i % 2 === 0, 'vertical timing module');
    expect(i, 6, i % 2 === 0, 'horizontal timing module');
  }

  // Alignment patterns (5x5, dark ring, light ring, dark centre).
  const pos = alignPositions(version);
  const last = pos.length - 1;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          expect(pos[j] + dx, pos[i] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1, 'alignment module');
        }
      }
    }
  }

  // The dark module next to the lower format information block.
  expect(8, size - 8, true, 'dark module');
}

function runCase(text, ecl, extraOptions) {
  total++;
  const options = Object.assign({ ecl: ecl }, extraOptions || {});
  const label = 'case ' + total + ' [' + ecl + ', ' + text.length + ' chars' +
    (extraOptions && extraOptions.minVersion ? ', forced v' + extraOptions.minVersion : '') + ']';
  const qr = ZQR.encode(text, options);

  assertEqual(qr.modules.length, qr.size * qr.size, label + ': module array length');
  assertEqual(qr.ecl, ecl, label + ': reported ECL');
  assert(qr.mask >= 0 && qr.mask <= 7, label + ': reported mask out of range');
  assertEqual(qr.size, qr.version * 4 + 17, label + ': size/version mismatch');
  for (let i = 0; i < qr.modules.length; i++) {
    if (qr.modules[i] !== 0 && qr.modules[i] !== 1) fail(label + ': module value not 0/1');
  }

  verifyFunctionPatterns(qr, (qr.size - 17) / 4, label);
  const decoded = decodeQr(qr, label);
  assertEqual(decoded.version, qr.version, label + ': decoded version');
  assertEqual(decoded.ecl, ecl, label + ': decoded ECL');
  assertEqual(decoded.mask, qr.mask, label + ': decoded mask');
  assertEqual(decoded.text, text, label + ': decoded text differs from input');

  minVersion = Math.min(minVersion, qr.version);
  maxVersion = Math.max(maxVersion, qr.version);
  seenEcl.add(ecl);
  seenModes.add(decoded.mode);
  seenMasks.add(qr.mask);
  seenVersionEcl.add(qr.version + ecl);
  passed++;
  return qr;
}

for (const text of CORPUS) {
  for (const ecl of ECL_NAMES) {
    const qr = runCase(text, ecl);
    // Smallest-version check: one version lower must not have enough capacity.
    if (qr.version > 1) {
      let threw = false;
      try {
        ZQR.encode(text, { ecl: ecl, maxVersion: qr.version - 1 });
      } catch (e) {
        threw = true;
      }
      assert(threw, 'case ' + total + ': version ' + qr.version + ' is not the smallest that fits');
    }
  }
}

assert(total >= 60, 'corpus must contain at least 60 cases, got ' + total);
assertEqual(seenEcl.size, 4, 'all four ECLs must be exercised');
assertEqual(seenModes.size, 3, 'numeric, alphanumeric and byte modes must all be exercised');

// ===========================================================================
// 7b. Exhaustive sweep: every version 1..40 x every ECL, filled to capacity
//     so that each entry of the block/EC tables is exercised at least once.
// ===========================================================================

function rawModuleCount(version) {
  const size = version * 4 + 17;
  const fn = functionMap(version);
  let functionModules = 0;
  for (let i = 0; i < fn.length; i++) functionModules += fn[i];
  return size * size - functionModules;
}

function dataCodewordCapacity(version, eclIndex) {
  const totalCodewords = Math.floor(rawModuleCount(version) / 8);
  return totalCodewords - EC_BLOCKS[version][eclIndex] * EC_PER_BLOCK[version][eclIndex];
}

// Total codeword counts published in the standard.
assertEqual(Math.floor(rawModuleCount(1) / 8), 26, 'total codewords for version 1');
assertEqual(Math.floor(rawModuleCount(7) / 8), 196, 'total codewords for version 7');
assertEqual(Math.floor(rawModuleCount(26) / 8), 1706, 'total codewords for version 26');
assertEqual(Math.floor(rawModuleCount(40) / 8), 3706, 'total codewords for version 40');

// Published byte-mode character capacities (the four corners of the table).
function availableBits(version, eclIndex, ccBits) {
  return dataCodewordCapacity(version, eclIndex) * 8 - 4 - ccBits;
}

function maxByteChars(version, eclIndex) {
  return Math.floor(availableBits(version, eclIndex, version <= 9 ? 8 : 16) / 8);
}

function maxAlnumChars(version, eclIndex) {
  const bits = availableBits(version, eclIndex, version <= 9 ? 9 : version <= 26 ? 11 : 13);
  const pairs = Math.floor(bits / 11);
  return pairs * 2 + (bits - pairs * 11 >= 6 ? 1 : 0);
}

function maxNumericChars(version, eclIndex) {
  const bits = availableBits(version, eclIndex, version <= 9 ? 10 : version <= 26 ? 12 : 14);
  const triples = Math.floor(bits / 10);
  const rest = bits - triples * 10;
  return triples * 3 + (rest >= 7 ? 2 : rest >= 4 ? 1 : 0);
}

assertEqual(maxByteChars(1, 0), 17, 'byte capacity v1-L');
assertEqual(maxByteChars(1, 1), 14, 'byte capacity v1-M');
assertEqual(maxByteChars(1, 2), 11, 'byte capacity v1-Q');
assertEqual(maxByteChars(1, 3), 7, 'byte capacity v1-H');
assertEqual(maxByteChars(40, 0), 2953, 'byte capacity v40-L');
assertEqual(maxByteChars(40, 1), 2331, 'byte capacity v40-M');
assertEqual(maxByteChars(40, 2), 1663, 'byte capacity v40-Q');
assertEqual(maxByteChars(40, 3), 1273, 'byte capacity v40-H');
assertEqual(maxNumericChars(1, 0), 41, 'numeric capacity v1-L');
assertEqual(maxAlnumChars(1, 0), 25, 'alphanumeric capacity v1-L');
assertEqual(maxNumericChars(40, 0), 7089, 'numeric capacity v40-L');
assertEqual(maxAlnumChars(40, 0), 4296, 'alphanumeric capacity v40-L');
assertEqual(maxNumericChars(40, 3), 3057, 'numeric capacity v40-H');
assertEqual(maxAlnumChars(40, 3), 1852, 'alphanumeric capacity v40-H');

for (let version = 1; version <= 40; version++) {
  for (let eclIndex = 0; eclIndex < 4; eclIndex++) {
    const ecl = ECL_NAMES[eclIndex];
    const forced = { minVersion: version, maxVersion: version };
    // Each mode filled exactly to capacity: no pad codewords at all, and every
    // character count indicator width is exercised at every version group.
    runCase(asciiText(maxByteChars(version, eclIndex)), ecl, forced);
    runCase(alnumText(maxAlnumChars(version, eclIndex)), ecl, forced);
    runCase(digits(maxNumericChars(version, eclIndex)), ecl, forced);
    // A short payload at the same version exercises maximal padding.
    runCase(version % 2 === 0 ? 'Z-System ' + version : digits(version), ecl, forced);
  }
}

assertEqual(seenVersionEcl.size, 160, 'every version x ECL combination must be round-tripped');

// ===========================================================================
// 8. Capacity limits and option handling
// ===========================================================================

(function testTooLong() {
  let message = '';
  try {
    ZQR.encode(base64Text(4000), { ecl: 'H' });
  } catch (e) {
    message = e.message;
  }
  assert(/too long/.test(message), 'expected a clear "too long" error, got: ' + message);
  // Version 40 at L holds 2956 data codewords; 2953 bytes is the documented max.
  ZQR.encode(base64Text(2952), { ecl: 'L' });
  let threw = false;
  try {
    ZQR.encode(base64Text(2960), { ecl: 'L' });
  } catch (e) {
    threw = true;
  }
  assert(threw, 'expected byte mode overflow past 2953 bytes at ECL L');
})();

(function testBadOptions() {
  let threw = 0;
  try { ZQR.encode('x', { ecl: 'Z' }); } catch (e) { threw++; }
  try { ZQR.encode('x', { margin: -1 }); } catch (e) { threw++; }
  try { ZQR.encode('x', { scale: 0 }); } catch (e) { threw++; }
  try { ZQR.encode('x', { minVersion: 5, maxVersion: 2 }); } catch (e) { threw++; }
  assertEqual(threw, 4, 'invalid options must throw');
})();

// ===========================================================================
// 9. SVG output
// ===========================================================================

(function testSvg() {
  const samples = [
    { text: 'HELLO WORLD', opts: {} },
    { text: digits(200), opts: { ecl: 'H', margin: 0, scale: 8, dark: '#123456', light: 'transparent' } },
    { text: arabicText(2), opts: { ecl: 'Q', margin: 2, scale: 2.5 } }
  ];
  for (const s of samples) {
    const out = ZQR.svg(s.text, s.opts);
    const qr = ZQR.encode(s.text, s.opts);
    assert(out.indexOf('<svg') === 0, 'svg output must start with <svg');
    assert(out.slice(-6) === '</svg>', 'svg output must end with </svg>');
    assert(out.indexOf('NaN') < 0, 'svg output contains NaN');
    assert(out.indexOf('undefined') < 0, 'svg output contains undefined');
    assert(out.indexOf('shape-rendering="crispEdges"') > 0, 'svg must set crispEdges');

    const margin = s.opts.margin === undefined ? 4 : s.opts.margin;
    const scale = s.opts.scale === undefined ? 4 : s.opts.scale;
    const dim = qr.size + margin * 2;
    assert(
      out.indexOf('viewBox="0 0 ' + dim + ' ' + dim + '"') > 0,
      'svg viewBox must match module count plus quiet zone'
    );
    assert(
      out.indexOf('width="' + (Math.round(dim * scale * 1000) / 1000) + '"') > 0,
      'svg width must be modules x scale'
    );

    let dark = 0;
    for (let i = 0; i < qr.modules.length; i++) dark += qr.modules[i];
    const squares = out.split('h1v1h-1z').length - 1;
    assertEqual(squares, dark, 'svg square count must equal the number of dark modules');

    const transparent = s.opts.light === 'transparent';
    assertEqual(
      out.indexOf('<rect') >= 0,
      !transparent,
      'background rect presence must follow the light option'
    );
  }
})();

// ===========================================================================
// 10. Summary
// ===========================================================================

const masks = Array.from(seenMasks).sort((a, b) => a - b).join(',');
console.log(
  'QR OK: ' + passed + '/' + total + ' cases passed (versions ' + minVersion + '..' + maxVersion +
  ', ECL ' + ECL_NAMES.join('/') + ')'
);
console.log(
  '  ' + checks + ' assertions, modes: ' + Array.from(seenModes).sort().join('/') +
  ', masks used: ' + masks
);
process.exit(0);
