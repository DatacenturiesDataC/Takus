
// Generates QR codes in SVG format entirely in-browser with zero dependencies.
// Implements a minimal QR encoder supporting byte-mode, error correction level L.

/**
 * Generate a QR code SVG string for the given data.
 * @param {string} data  The string to encode
 * @param {object} [opts]
 * @param {number} [opts.size=200]   Pixel size of the SVG
 * @param {string} [opts.fg='#fff']  Foreground colour
 * @param {string} [opts.bg='transparent']  Background colour
 * @returns {string}  SVG markup
 */
export function generateQRSvg(data, opts = {}) {
  const { size = 200, fg = '#ffffff', bg = 'transparent' } = opts;
  const matrix = _encode(data);
  const n = matrix.length;
  const cellSize = size / n;

  let rects = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (matrix[y][x]) {
        rects += `<rect x="${x * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" fill="${fg}"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">
    <rect width="${size}" height="${size}" fill="${bg}"/>
    ${rects}
  </svg>`;
}

/**
 * Show a modal with a QR code for the given URL.
 * @param {string} url   The URL to encode in the QR code (should be compact)
 * @param {string} title Optional title shown above the QR code
 * @param {string} [clipboardUrl]  URL to copy to clipboard (defaults to url if not provided)
 */
export function showQRModal(url, title = '', clipboardUrl) {
  const copyUrl = clipboardUrl || url;
  document.getElementById('qr-overlay')?.remove();

  const svg = generateQRSvg(url, { size: 240, fg: '#ffffff', bg: 'rgba(0,0,0,0)' });

  const overlay = document.createElement('div');
  overlay.id = 'qr-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10001;display:flex;align-items:center;justify-content:center;padding:var(--space-4);';

  overlay.innerHTML = `
    <div style="background:var(--color-surface);border:1px solid rgba(255,255,255,0.1);border-radius:var(--radius-xl);padding:var(--space-6);max-width:340px;text-align:center;position:relative;">
      <button id="qr-close" style="position:absolute;top:var(--space-2);right:var(--space-2);background:none;border:none;color:var(--color-text-muted);cursor:pointer;font-size:16px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%;" title="Close">✕</button>
      ${title ? `<p style="font-weight:var(--weight-semi);color:var(--color-text-primary);font-size:var(--font-sm);margin-bottom:var(--space-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:var(--space-4);">${_esc(title)}</p>` : ''}
      <div style="background:#1a1a2e;border-radius:var(--radius-lg);padding:var(--space-4);display:inline-block;">
        ${svg}
      </div>
      <p style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:var(--space-3);word-break:break-all;max-height:60px;overflow:hidden;text-overflow:ellipsis;">${_esc(url)}</p>
      <button id="qr-copy-url" style="margin-top:var(--space-3);background:var(--color-primary);color:#fff;border:none;border-radius:var(--radius-md);padding:6px 16px;font-size:var(--font-xs);font-weight:var(--weight-semi);cursor:pointer;width:100%;">Copy Full Link</button>
    </div>
  `;

  document.body.appendChild(overlay);

  const cleanup = () => {
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  };
  const onEsc = (e) => { if (e.key === 'Escape') cleanup(); };
  overlay.querySelector('#qr-close').addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
  document.addEventListener('keydown', onEsc);

  overlay.querySelector('#qr-copy-url')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(copyUrl);
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = 'Copy Full Link'; }, 2000);
    } catch { /* non-critical */
      btn.textContent = 'Copy failed';
      setTimeout(() => { btn.textContent = 'Copy Full Link'; }, 2000);
    }
  });
}

// ── Minimal QR encoder ──────────────────────────────────────────────────────────
// Supports byte mode, ECC level L, auto version selection (1-10).
// Sufficient for URLs up to ~250 characters.

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

// Byte capacities for ECC level L, versions 1-10
const BYTE_CAPS = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271];

function _encode(data) {
  const bytes = new TextEncoder().encode(data);
  const len = bytes.length;

  if (len > BYTE_CAPS[BYTE_CAPS.length - 1]) {
    throw new Error(`Data too long for QR code (${len} bytes, max ${BYTE_CAPS[BYTE_CAPS.length - 1]})`);
  }

  // Select version
  let version = 1;
  for (let v = 0; v < BYTE_CAPS.length; v++) {
    if (len <= BYTE_CAPS[v]) { version = v + 1; break; }
  }

  const size = version * 4 + 17;

  // Build data bits: mode indicator (0100 = byte) + char count + data + terminator + padding
  let bits = '0100'; // byte mode
  const ccBits = version <= 9 ? 8 : 16;
  bits += len.toString(2).padStart(ccBits, '0');
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  bits += '0000'; // terminator

  // Pad to 8-bit boundary
  while (bits.length % 8 !== 0) bits += '0';

  // Get total data codewords for version + ECC L
  const totalCodewords = _getDataCodewords(version);
  while (bits.length < totalCodewords * 8) {
    bits += '11101100'; // 0xEC
    if (bits.length < totalCodewords * 8) bits += '00010001'; // 0x11
  }
  bits = bits.slice(0, totalCodewords * 8);

  // Convert to codeword array
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(parseInt(bits.slice(i, i + 8), 2));
  }

  // Add error correction with block splitting + interleaving (ISO 18004 §8.6)
  const allCodewords = _computeECInterleaved(codewords, version);

  // Build the matrix
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));

  // Place finder patterns
  _placeFinderPattern(matrix, reserved, 0, 0);
  _placeFinderPattern(matrix, reserved, size - 7, 0);
  _placeFinderPattern(matrix, reserved, 0, size - 7);

  // Place timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0 ? 1 : 0;
    matrix[i][6] = i % 2 === 0 ? 1 : 0;
    reserved[6][i] = true;
    reserved[i][6] = true;
  }

  // Alignment patterns (versions 2+)
  if (version >= 2) {
    const positions = _alignmentPositions(version);
    for (const r of positions) {
      for (const c of positions) {
        if (reserved[r]?.[c]) continue;
        _placeAlignmentPattern(matrix, reserved, r, c);
      }
    }
  }

  // Reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (i < size) { reserved[8][i] = true; reserved[i][8] = true; }
    if (size - 1 - i >= 0 && size - 1 - i < size) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
  }
  // Dark module
  matrix[size - 8][8] = 1;
  reserved[size - 8][8] = true;

  // Version info (versions 7+) — reserve and place 6×3 blocks
  if (version >= 7) {
    const versionInfo = _getVersionInfo(version);
    // Bottom-left block (6 rows × 3 cols)
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        const bit = (versionInfo >> (i * 3 + j)) & 1;
        matrix[size - 11 + j][i] = bit;
        reserved[size - 11 + j][i] = true;
        // Top-right block (3 rows × 6 cols)
        matrix[i][size - 11 + j] = bit;
        reserved[i][size - 11 + j] = true;
      }
    }
  }

  // Place data
  let bitIdx = 0;
  const dataBits = allCodewords.map(b => b.toString(2).padStart(8, '0')).join('');
  let upward = true;
  for (let col = size - 1; col >= 0; col -= 2) {
    if (col === 6) col = 5; // skip timing column
    const rows = upward ? _range(size - 1, -1) : _range(0, size);
    for (const row of rows) {
      for (const dx of [0, -1]) {
        const c = col + dx;
        if (c < 0 || c >= size || reserved[row][c]) continue;
        matrix[row][c] = bitIdx < dataBits.length ? parseInt(dataBits[bitIdx++], 10) : 0;
      }
    }
    upward = !upward;
  }

  // Apply mask 0 (checkerboard) and format info
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && (r + c) % 2 === 0) {
        matrix[r][c] ^= 1;
      }
    }
  }

  // Write format info (ECC L + mask 0 = 0b01_000, with BCH = 0x77C4)
  _placeFormatInfo(matrix, size, 0x77C4);

  return matrix;
}

function _range(start, end) {
  const arr = [];
  if (start < end) for (let i = start; i < end; i++) arr.push(i);
  else for (let i = start; i >= end + 1; i--) arr.push(i);
  return arr;
}

function _placeFinderPattern(matrix, reserved, row, col) {
  const pattern = [
    [1,1,1,1,1,1,1],
    [1,0,0,0,0,0,1],
    [1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1],
    [1,0,0,0,0,0,1],
    [1,1,1,1,1,1,1],
  ];
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const mr = row + r, mc = col + c;
      if (mr < 0 || mr >= matrix.length || mc < 0 || mc >= matrix.length) continue;
      if (r >= 0 && r < 7 && c >= 0 && c < 7) {
        matrix[mr][mc] = pattern[r][c];
      } else {
        matrix[mr][mc] = 0; // separator
      }
      reserved[mr][mc] = true;
    }
  }
}

function _placeAlignmentPattern(matrix, reserved, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const mr = row + r, mc = col + c;
      if (mr < 0 || mr >= matrix.length || mc < 0 || mc >= matrix.length) continue;
      if (reserved[mr][mc]) continue;
      matrix[mr][mc] = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) ? 1 : 0;
      reserved[mr][mc] = true;
    }
  }
}

function _alignmentPositions(version) {
  if (version === 1) return [];
  // ISO 18004 Table E.1 — alignment pattern center coordinates
  const table = [
    [],              // v0 (unused)
    [],              // v1
    [6, 18],         // v2
    [6, 22],         // v3
    [6, 26],         // v4
    [6, 30],         // v5
    [6, 34],         // v6
    [6, 22, 38],     // v7
    [6, 24, 42],     // v8
    [6, 26, 46],     // v9
    [6, 28, 50],     // v10
  ];
  return table[version] || table[10];
}

function _placeFormatInfo(matrix, size, info) {
  const bits = [];
  for (let i = 14; i >= 0; i--) bits.push((info >> i) & 1);

  // Around top-left finder
  const positions1 = [
    [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[7,8],[8,8],
    [8,7],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = positions1[i];
    matrix[r][c] = bits[i];
  }

  // Bottom-left + top-right
  const positions2 = [
    [size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],
    [8,size-8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1],
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = positions2[i];
    matrix[r][c] = bits[i];
  }
}

// Version information (BCH-encoded) for versions 7-10 (ISO 18004 Table D.1)
const VERSION_INFO = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };
function _getVersionInfo(v) { return VERSION_INFO[v] || 0; }

// Data codeword counts for ECC level L (versions 1-10)
const DATA_CODEWORDS = [19, 34, 55, 80, 108, 136, 156, 194, 232, 274];
function _getDataCodewords(v) { return DATA_CODEWORDS[v - 1] || DATA_CODEWORDS[9]; }

// Block structure for ECC level L (ISO 18004 Table 9)
// Each entry: { ecPerBlock, groups: [{ count, dataPerBlock }] }
const BLOCK_STRUCTURE = [
  { ecPerBlock:  7, groups: [{ count: 1, dataPerBlock: 19  }] },  // v1
  { ecPerBlock: 10, groups: [{ count: 1, dataPerBlock: 34  }] },  // v2
  { ecPerBlock: 15, groups: [{ count: 1, dataPerBlock: 55  }] },  // v3
  { ecPerBlock: 20, groups: [{ count: 1, dataPerBlock: 80  }] },  // v4
  { ecPerBlock: 26, groups: [{ count: 1, dataPerBlock: 108 }] },  // v5
  { ecPerBlock: 18, groups: [{ count: 2, dataPerBlock: 68  }] },  // v6
  { ecPerBlock: 20, groups: [{ count: 2, dataPerBlock: 78  }] },  // v7: 156 data
  { ecPerBlock: 24, groups: [{ count: 2, dataPerBlock: 97  }] },  // v8: 194 data
  { ecPerBlock: 30, groups: [{ count: 2, dataPerBlock: 116 }] },  // v9
  { ecPerBlock: 18, groups: [{ count: 2, dataPerBlock: 68 }, { count: 2, dataPerBlock: 69 }] }, // v10
];
function _getBlockStructure(v) { return BLOCK_STRUCTURE[v - 1] || BLOCK_STRUCTURE[9]; }

/**
 * Split data into RS blocks, compute EC for each, then interleave per ISO 18004 §8.6.
 * For v1-5 (single block), this is equivalent to the simple approach.
 * For v6+ (multiple blocks), the data and EC codewords are interleaved across blocks.
 */
function _computeECInterleaved(dataCodewords, version) {
  const bs = _getBlockStructure(version);
  const blocks = []; // array of { data: number[], ec: number[] }

  let offset = 0;
  for (const group of bs.groups) {
    for (let i = 0; i < group.count; i++) {
      const blockData = dataCodewords.slice(offset, offset + group.dataPerBlock);
      const blockEC = _reedSolomon(blockData, bs.ecPerBlock);
      blocks.push({ data: blockData, ec: blockEC });
      offset += group.dataPerBlock;
    }
  }

  // Interleave data codewords
  const maxDataLen = Math.max(...blocks.map(b => b.data.length));
  const interleaved = [];
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of blocks) {
      if (i < block.data.length) interleaved.push(block.data[i]);
    }
  }

  // Interleave EC codewords
  for (let i = 0; i < bs.ecPerBlock; i++) {
    for (const block of blocks) {
      if (i < block.ec.length) interleaved.push(block.ec[i]);
    }
  }

  return interleaved;
}

// Reed-Solomon error correction
function _reedSolomon(data, ecCount) {
  const gf = _initGF();
  const gen = _generatorPoly(ecCount, gf);
  const msg = [...data, ...Array(ecCount).fill(0)];

  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      msg[i + j] ^= _gfMul(gen[j], coef, gf);
    }
  }

  return msg.slice(data.length);
}

function _initGF() {
  const exp = new Uint8Array(512);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x >= 256) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log };
}

function _gfMul(a, b, gf) {
  if (a === 0 || b === 0) return 0;
  return gf.exp[gf.log[a] + gf.log[b]];
}

function _generatorPoly(n, gf) {
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const factor = [1, gf.exp[i]];
    const next = Array(gen.length + 1).fill(0);
    for (let g = 0; g < gen.length; g++) {
      for (let f = 0; f < factor.length; f++) {
        next[g + f] ^= _gfMul(gen[g], factor[f], gf);
      }
    }
    gen = next;
  }
  return gen;
}
