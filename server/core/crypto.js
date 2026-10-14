// Randomness and hashing on the Web Crypto API, which both Node and
// Cloudflare Workers provide, so the game core runs on either.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// Uniform integer in [0, n).
export function randomInt(n) {
  if (n <= 1) return 0;
  const limit = Math.floor(0x100000000 / n) * n;
  const u = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(u);
  while (u[0] >= limit);
  return u[0] % n;
}

export function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return toHex(a);
}

export async function sha256Hex(text) {
  return toHex(await subtle.digest('SHA-256', enc.encode(text)));
}

const PBKDF2_ITER = 120000;

// Stored as "pbkdf2$<iterations>$<hex>" so the cost can be raised later.
export async function hashPassword(password, salt, iterations = PBKDF2_ITER) {
  const key = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, key, 256);
  return `pbkdf2$${iterations}$${toHex(bits)}`;
}

export async function checkPassword(password, salt, stored) {
  const m = /^pbkdf2\$(\d+)\$([0-9a-f]+)$/.exec(stored || '');
  if (!m) return false;
  const fresh = await hashPassword(password, salt, Number(m[1]));
  // Constant-time compare.
  if (fresh.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < fresh.length; i++) diff |= fresh.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}
