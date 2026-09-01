// UTF-8 encode without TextEncoder (QuickJS doesn't ship one).
// Handles surrogate pairs; lone surrogates encode as replacement char.
// Two passes over the string into a pre-sized buffer — allocating number[]
// per byte showed up as a top mount cost under QuickJS.
export function utf8Encode(input: string): Uint8Array {
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  if (enc) return enc.encode(input);

  let outLen = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x80) outLen += 1;
    else if (code < 0x800) outLen += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) outLen += 4;
    else outLen += 3; // BMP non-surrogate, or lone surrogate -> replacement (3 bytes)
  }
  const out = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const lo = input.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code < 0x80) {
      out[p++] = code;
    } else if (code < 0x800) {
      out[p++] = 0xc0 | (code >> 6);
      out[p++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      out[p++] = 0xe0 | (code >> 12);
      out[p++] = 0x80 | ((code >> 6) & 0x3f);
      out[p++] = 0x80 | (code & 0x3f);
    } else {
      out[p++] = 0xf0 | (code >> 18);
      out[p++] = 0x80 | ((code >> 12) & 0x3f);
      out[p++] = 0x80 | ((code >> 6) & 0x3f);
      out[p++] = 0x80 | (code & 0x3f);
    }
  }
  return out;
}

// UTF-8 decode without TextDecoder (same reason as above). Malformed
// sequences decode to U+FFFD rather than throwing — a truncated response
// body should still be readable text, not an exception.
export function utf8Decode(bytes: Uint8Array): string {
  const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  if (dec) return dec.decode(bytes);

  // Chunked so String.fromCharCode never sees a huge argument list.
  const parts: string[] = [];
  let chunk: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i];
    let code: number;
    if (b0 < 0x80) {
      code = b0;
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      code = ((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      code = ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else if ((b0 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      code =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      i += 4;
    } else {
      code = 0xfffd;
      i += 1;
    }
    if (code > 0xffff) {
      code -= 0x10000;
      chunk.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      chunk.push(code);
    }
    if (chunk.length >= 4096) {
      parts.push(String.fromCharCode(...chunk));
      chunk = [];
    }
  }
  if (chunk.length) parts.push(String.fromCharCode(...chunk));
  return parts.join('');
}
