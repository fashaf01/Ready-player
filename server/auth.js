import crypto from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import { publicProfile } from './store/index.js';
import { CONFIG } from './config.js';
import { AVATAR_COLORS } from '../shared/constants.js';

export const COOKIE = 'hunt_session';
const scrypt = promisify(crypto.scrypt);

// Password hashing runs off the main thread so races keep ticking.
async function hashPassword(password, salt) {
  return (await scrypt(password, salt, 64)).toString('hex');
}

// Only a hash of the session token is stored.
export function tokenKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {}
  }
  return out;
}

export async function userFromCookie(store, cookieHeader) {
  const token = parseCookies(cookieHeader)[COOKIE];
  return token ? store.sessionUser(tokenKey(token)) : null;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`);
}

async function startSession(store, req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(tokenKey(token), user.id, Date.now() + CONFIG.SESSION_DAYS * 86400000);
  setSessionCookie(req, res, token, CONFIG.SESSION_DAYS * 86400);
}

// Very small in-memory limiter for login/signup attempts per IP.
const attempts = new Map();
function limited(ip) {
  const now = Date.now();
  if (attempts.size > 5000) for (const [k, e] of attempts) if (e.reset < now) attempts.delete(k);
  const e = attempts.get(ip);
  if (!e || e.reset < now) {
    attempts.set(ip, { n: 1, reset: now + 10 * 60000 });
    return false;
  }
  e.n++;
  return e.n > 30;
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function cleanDisplayName(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error('[api]', e);
    if (!res.headersSent) res.status(500).json({ error: 'Server error. Try again.' });
  });

export function authRouter(store, hub) {
  const r = express.Router();
  r.use(express.json({ limit: '4kb' }));

  r.post(
    '/signup',
    wrap(async (req, res) => {
      if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
      const { username, password, displayName, color } = req.body ?? {};
      if (!USERNAME_RE.test(username ?? '')) return res.status(400).json({ error: 'Username must be 3–20 letters, numbers or _.' });
      if (typeof password !== 'string' || password.length < 6 || password.length > 100) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      const name = cleanDisplayName(displayName);
      if (name.length < 2 || name.length > 16) return res.status(400).json({ error: 'Display name must be 2–16 characters.' });
      const col = AVATAR_COLORS.includes(color) ? color : AVATAR_COLORS[0];
      const salt = crypto.randomBytes(16).toString('hex');
      let user;
      try {
        user = await store.createUser({ username, passHash: await hashPassword(password, salt), salt, displayName: name, color: col });
      } catch (e) {
        if (e.code === 'TAKEN') return res.status(409).json({ error: 'That username is taken.' });
        throw e;
      }
      await startSession(store, req, res, user);
      hub?.boardChanged();
      res.json({ me: publicProfile(user) });
    }),
  );

  r.post(
    '/login',
    wrap(async (req, res) => {
      if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
      const { username, password } = req.body ?? {};
      const user = typeof username === 'string' && USERNAME_RE.test(username) ? await store.userByName(username) : null;
      const ok =
        user &&
        typeof password === 'string' &&
        crypto.timingSafeEqual(Buffer.from(await hashPassword(password, user.salt), 'hex'), Buffer.from(user.pass_hash, 'hex'));
      if (!ok) return res.status(401).json({ error: 'Wrong username or password.' });
      await startSession(store, req, res, user);
      res.json({ me: publicProfile(hub ? hub.withPendingLock(user) : user) });
    }),
  );

  r.post(
    '/logout',
    wrap(async (req, res) => {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) await store.deleteSession(tokenKey(token));
      setSessionCookie(req, res, '', 0);
      res.json({ ok: true });
    }),
  );

  r.get(
    '/me',
    wrap(async (req, res) => {
      const user = await userFromCookie(store, req.headers.cookie);
      if (!user) return res.json({ me: null });
      res.json({ me: publicProfile(hub ? hub.withPendingLock(user) : user), now: Date.now() });
    }),
  );

  r.get(
    '/board',
    wrap(async (_req, res) => res.json(hub ? hub.board : await store.board(1))),
  );

  return r;
}
