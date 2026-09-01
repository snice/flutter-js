// base64 for the host boundary. Response and request bodies cross the v1
// C ABI as strings (docs/jsi-and-native-modules.md), so bytes travel
// base64-encoded; QuickJS ships neither atob/btoa nor Buffer.

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

let decodeTable: Int16Array | null = null;

function table(): Int16Array {
  if (decodeTable) return decodeTable;
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < CHARS.length; i++) t[CHARS.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62; // base64url
  t['_'.charCodeAt(0)] = 63;
  decodeTable = t;
  return t;
}

export function base64Encode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += CHARS[b0 >> 2];
    out += CHARS[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += i + 1 < bytes.length ? CHARS[(((b1 ?? 0) & 0x0f) << 2) | ((b2 ?? 0) >> 6)] : '=';
    out += i + 2 < bytes.length ? CHARS[(b2 ?? 0) & 0x3f] : '=';
    if (out.length >= 8192) {
      parts.push(out);
      out = '';
    }
  }
  parts.push(out);
  return parts.join('');
}

export function base64Decode(input: string): Uint8Array {
  const t = table();
  // Pre-size from the significant character count; padding and any stray
  // whitespace (some servers wrap base64 payloads) do not produce bytes.
  let n = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 128 && t[c] >= 0) n++;
  }
  const out = new Uint8Array((n * 3) >> 2);
  let p = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    const v = c < 128 ? t[c] : -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >> bits) & 0xff;
    }
  }
  return p === out.length ? out : out.subarray(0, p);
}
