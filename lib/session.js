const crypto = require('crypto');

// Logins live in an encrypted cookie rather than server memory, so any
// serverless instance can handle any request.

const COOKIE = 'sn_auth';
const STATE_COOKIE = 'sn_state';
const MAX_AGE = 60 * 60 * 24 * 30; // seconds

const secret = process.env.SESSION_SECRET;
if (!secret && process.env.VERCEL) {
  throw new Error('SESSION_SECRET must be set in the Vercel project environment variables');
}
const KEY = crypto.createHash('sha256').update(secret || crypto.randomBytes(32)).digest();
const SECURE = Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';

function seal(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function unseal(value) {
  try {
    const raw = Buffer.from(value, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const body = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

const cookieOptions = maxAge => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: SECURE,
  path: '/',
  maxAge: maxAge * 1000
});

function getAuth(req) {
  const value = readCookie(req, COOKIE);
  return value ? unseal(value) : null;
}

function setAuth(res, auth) {
  const { accessToken, refreshToken, expiresAt, userId } = auth;
  res.cookie(COOKIE, seal({ accessToken, refreshToken, expiresAt, userId }), cookieOptions(MAX_AGE));
}

function clearAuth(res) {
  res.clearCookie(COOKIE, cookieOptions(0));
}

function setState(res, state) {
  res.cookie(STATE_COOKIE, state, cookieOptions(600));
}

function takeState(req, res) {
  res.clearCookie(STATE_COOKIE, cookieOptions(0));
  return readCookie(req, STATE_COOKIE);
}

module.exports = { getAuth, setAuth, clearAuth, setState, takeState };
