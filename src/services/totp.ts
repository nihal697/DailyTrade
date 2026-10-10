/* RFC 6238 TOTP with zero dependencies (pure JS SHA-1 — no WebCrypto needed,
   so it works in every WebView). NOTE the parentheses around the mask:
   JS `%` binds tighter than `&`; without them you get a wrong-but-plausible
   6-digit code (we've been bitten by exactly this before). */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array {
  const clean = input.trim().replace(/=+$/, '').toUpperCase();
  const out: number[] = [];
  let bits = 0, acc = 0;
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('bad base32 secret');
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

export function sha1(msg: Uint8Array): Uint8Array {
  const ml = msg.length;
  const withOne = ml + 1;
  const padLen = (64 - ((withOne + 8) % 64)) % 64;
  const total = withOne + padLen + 8;
  const b = new Uint8Array(total);
  b.set(msg, 0);
  b[ml] = 0x80;
  const bitLenHi = Math.floor((ml * 8) / 0x100000000);
  const bitLenLo = (ml * 8) >>> 0;
  b[total - 8] = (bitLenHi >>> 24) & 0xff;
  b[total - 7] = (bitLenHi >>> 16) & 0xff;
  b[total - 6] = (bitLenHi >>> 8) & 0xff;
  b[total - 5] = bitLenHi & 0xff;
  b[total - 4] = (bitLenLo >>> 24) & 0xff;
  b[total - 3] = (bitLenLo >>> 16) & 0xff;
  b[total - 2] = (bitLenLo >>> 8) & 0xff;
  b[total - 1] = bitLenLo & 0xff;

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe,
      h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((b[off + i * 4] << 24) | (b[off + i * 4 + 1] << 16) |
              (b[off + i * 4 + 2] << 8) | b[off + i * 4 + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20)      { f = (bb & c) | (~bb & d); k = 0x5a827999; }
      else if (i < 40) { f = bb ^ c ^ d;           k = 0x6ed9eba1; }
      else if (i < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8f1bbcdc; }
      else             { f = bb ^ c ^ d;           k = 0xca62c1d6; }
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(bb, 30); bb = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  [h0, h1, h2, h3, h4].forEach((h, i) => {
    out[i * 4] = (h >>> 24) & 0xff; out[i * 4 + 1] = (h >>> 16) & 0xff;
    out[i * 4 + 2] = (h >>> 8) & 0xff; out[i * 4 + 3] = h & 0xff;
  });
  return out;
}

function hmacSha1(key: Uint8Array, msg: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > 64) k = sha1(k);
  const kp = new Uint8Array(64);
  kp.set(k, 0);
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ipad[i] = kp[i] ^ 0x36; opad[i] = kp[i] ^ 0x5c; }
  const inner = new Uint8Array(64 + msg.length);
  inner.set(ipad, 0); inner.set(msg, 64);
  const outer = new Uint8Array(64 + 20);
  const ih = sha1(inner);
  outer.set(opad, 0); outer.set(ih, 64);
  return sha1(outer);
}

export function totpNow(base32Secret: string, atMs = Date.now()): string {
  const key = base32Decode(base32Secret);
  const counter = Math.floor(atMs / 1000 / 30);
  const msg = new Uint8Array(8);
  for (let i = 0; i < 8; i++) msg[i] = Math.floor(counter / 2 ** (8 * (7 - i))) & 0xff;
  const h = hmacSha1(key, msg);
  const o = h[h.length - 1] & 15;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 10 ** 6;
  return String(code).padStart(6, '0');
}
