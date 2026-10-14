// The HTTP API (accounts and the Scoreboard), written without any web
// framework so the Node server and the Cloudflare Worker can share it.
//
// handleApi(store, hub, req) with req = { method, path, body, cookie, ip, secure }
// returns { status, json, setCookie? }.

import { AVATAR_COLORS } from '../../shared/constants.js';
import { randomHex, sha256Hex, hashPassword, checkPassword } from './crypto.js';
import { publicProfile } from './profile.js';

export const COOKIE = 'hunt_session';
const SESSION_DAYS = 30;

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header || '').split(';')) {
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
  return token ? store.sessionUser(await sha256Hex(token)) : null;
}

function sessionCookie(token, maxAgeSec, secure) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

async function startSession(store, user, secure) {
  const token = randomHex(32);
  await store.createSession(await sha256Hex(token), user.id, Date.now() + SESSION_DAYS * 86400000);
  return sessionCookie(token, SESSION_DAYS * 86400, secure);
}

// Small in-memory limiter for login/signup attempts per IP.
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
const err = (status, error) => ({ status, json: { error } });

function cleanDisplayName(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function handleApi(store, hub, req) {
  const { method, path, secure } = req;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const profile = (u) => publicProfile(hub ? hub.withPendingLock(u) : u);

  if (method === 'POST' && path === '/signup') {
    if (limited(req.ip)) return err(429, 'Too many attempts. Try again in a few minutes.');
    const { username, password, displayName, color } = body;
    if (!USERNAME_RE.test(username ?? '')) return err(400, 'Username must be 3–20 letters, numbers or _.');
    if (typeof password !== 'string' || password.length < 6 || password.length > 100) return err(400, 'Password must be at least 6 characters.');
    const name = cleanDisplayName(displayName);
    if (name.length < 2 || name.length > 16) return err(400, 'Display name must be 2–16 characters.');
    const col = AVATAR_COLORS.includes(color) ? color : AVATAR_COLORS[0];
    const salt = randomHex(16);
    let user;
    try {
      user = await store.createUser({ username, passHash: await hashPassword(password, salt), salt, displayName: name, color: col });
    } catch (e) {
      if (e.code === 'TAKEN') return err(409, 'That username is taken.');
      throw e;
    }
    const setCookie = await startSession(store, user, secure);
    hub?.boardChanged();
    return { status: 200, json: { me: publicProfile(user) }, setCookie };
  }

  if (method === 'POST' && path === '/login') {
    if (limited(req.ip)) return err(429, 'Too many attempts. Try again in a few minutes.');
    const { username, password } = body;
    const user = typeof username === 'string' && USERNAME_RE.test(username) ? await store.userByName(username) : null;
    const ok = user && typeof password === 'string' && (await checkPassword(password, user.salt, user.pass_hash));
    if (!ok) return err(401, 'Wrong username or password.');
    const setCookie = await startSession(store, user, secure);
    return { status: 200, json: { me: profile(user) }, setCookie };
  }

  if (method === 'POST' && path === '/logout') {
    const token = parseCookies(req.cookie)[COOKIE];
    if (token) await store.deleteSession(await sha256Hex(token));
    return { status: 200, json: { ok: true }, setCookie: sessionCookie('', 0, secure) };
  }

  if (method === 'GET' && path === '/me') {
    const user = await userFromCookie(store, req.cookie);
    if (!user) return { status: 200, json: { me: null } };
    return { status: 200, json: { me: profile(user), now: Date.now() } };
  }

  if (method === 'GET' && path === '/board') {
    return { status: 200, json: hub ? hub.board : await store.board(1) };
  }

  return err(404, 'Not found.');
}
