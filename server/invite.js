import crypto from 'node:crypto';

// Alphabet de Crockford : pas de I, L, O, U, donc pas de confusion à l'oral ou à l'écrit.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** Code d'invitation de 8 caractères (40 bits d'aléa). */
export function newCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += ALPHABET[b & 31];
  return s;
}

/** Accepte « k7f3-qm9x », « K7F3 QM9X », et corrige O→0, I/L→1. */
export function normalizeCode(raw) {
  const s = String(raw || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return CODE_RE.test(s) ? s : null;
}

export function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function prettyCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function newSecret() {
  return crypto.randomBytes(24).toString('base64url');
}

export function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
