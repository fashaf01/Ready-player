import crypto from 'node:crypto';
import express from 'express';
import { publicProfile } from './db.js';
import { CONFIG } from './config.js';
import { AVATAR_COLORS } from '../shared/constants.js';

export const COOKIE = 'hunt_session';

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`);
}

// Very small in-memory limiter for login/signup attempts per IP.
const attempts = new Map();
function limited(ip) {
  const now = Date.now();
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

export function authRouter(db, hub) {
  const r = express.Router();
  r.use(express.json({ limit: '4kb' }));

  r.post('/signup', (req, res) => {
    if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    const { username, password, displayName, color } = req.body ?? {};
    if (!USERNAME_RE.test(username ?? '')) return res.status(400).json({ error: 'Username must be 3–20 letters, numbers or _.' });
    if (typeof password !== 'string' || password.length < 6 || password.length > 100) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const name = cleanDisplayName(displayName);
    if (name.length < 2 || name.length > 16) return res.status(400).json({ error: 'Display name must be 2–16 characters.' });
    const col = AVATAR_COLORS.includes(color) ? color : AVATAR_COLORS[0];
    if (db.userByName(username)) return res.status(409).json({ error: 'That username is taken.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const user = db.createUser({ username, passHash: hashPassword(password, salt), salt, displayName: name, color: col });
    const token = crypto.randomBytes(32).toString('hex');
    db.createSession(token, user.id);
    setSessionCookie(req, res, token, CONFIG.SESSION_DAYS * 86400);
    hub?.boardChanged();
    res.json({ me: publicProfile(user) });
  });

  r.post('/login', (req, res) => {
    if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    const { username, password } = req.body ?? {};
    const user = typeof username === 'string' ? db.userByName(username) : null;
    const ok =
      user &&
      typeof password === 'string' &&
      crypto.timingSafeEqual(Buffer.from(hashPassword(password, user.salt), 'hex'), Buffer.from(user.pass_hash, 'hex'));
    if (!ok) return res.status(401).json({ error: 'Wrong username or password.' });
    const token = crypto.randomBytes(32).toString('hex');
    db.createSession(token, user.id);
    setSessionCookie(req, res, token, CONFIG.SESSION_DAYS * 86400);
    res.json({ me: publicProfile(user) });
  });

  r.post('/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.deleteSession(token);
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const user = token ? db.sessionUser(token) : null;
    if (!user) return res.json({ me: null });
    res.json({ me: publicProfile(user), now: Date.now() });
  });

  r.get('/board', (_req, res) => res.json(db.board(1)));

  return r;
}
