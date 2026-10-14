// The HTTP API (accounts and the Scoreboard), written without any web
// framework so the Node server and the Cloudflare Worker can share it.
//
// handleApi(store, hub, req) with req = { method, path, body, contentType, cookie, huntToken, ip, secure }
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

const TOKEN_RE = /^[0-9a-f]{64}$/;

// The session token can arrive three ways: the cookie, an X-Hunt-Token
// header, or (for sockets) the WebSocket subprotocol list ["hunt", token].
// Hosts that drop cookies still work.
export function tokenFrom({ cookie, huntToken, protocols } = {}) {
  const fromCookie = parseCookies(cookie)[COOKIE];
  if (fromCookie && TOKEN_RE.test(fromCookie)) return fromCookie;
  const header = String(huntToken || '').trim().toLowerCase();
  if (TOKEN_RE.test(header)) return header;
  const list = String(protocols || '').split(',').map((s) => s.trim());
  if (list.includes(WS_PROTOCOL)) return list.find((s) => TOKEN_RE.test(s)) || null;
  return null;
}

export const WS_PROTOCOL = 'hunt';

export async function userFromAuth(store, auth) {
  const token = tokenFrom(auth);
  return token ? store.sessionUser(await sha256Hex(token)) : null;
}

export function userFromCookie(store, cookieHeader) {
  return userFromAuth(store, { cookie: cookieHeader });
}

// Over HTTPS the cookie also works when the game is shown inside another
// site's frame (Higgsfield embeds games). Cross-site requests still can't use
// it: the API only takes JSON (needs a CORS preflight we never grant) and
// sockets check the Origin header.
function sessionCookie(token, maxAgeSec, secure) {
  const base = `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSec}`;
  return secure ? `${base}; Secure; SameSite=None; Partitioned` : `${base}; SameSite=Lax`;
}

async function startSession(store, user, secure) {
  const token = randomHex(32);
  await store.createSession(await sha256Hex(token), user.id, Date.now() + SESSION_DAYS * 86400000);
  return { token, setCookie: sessionCookie(token, SESSION_DAYS * 86400, secure) };
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
  // Only JSON posts: a plain cross-site form can't send this content type.
  if (method === 'POST' && !/^application\/json\b/i.test(req.contentType || '')) return err(415, 'Send JSON.');
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
    const { token, setCookie } = await startSession(store, user, secure);
    hub?.boardChanged();
    return { status: 200, json: { me: publicProfile(user), token }, setCookie };
  }

  if (method === 'POST' && path === '/login') {
    if (limited(req.ip)) return err(429, 'Too many attempts. Try again in a few minutes.');
    const { username, password } = body;
    const user = typeof username === 'string' && USERNAME_RE.test(username) ? await store.userByName(username) : null;
    const ok = user && typeof password === 'string' && (await checkPassword(password, user.salt, user.pass_hash));
    if (!ok) return err(401, 'Wrong username or password.');
    const { token, setCookie } = await startSession(store, user, secure);
    return { status: 200, json: { me: profile(user), token }, setCookie };
  }

  if (method === 'POST' && path === '/logout') {
    const token = tokenFrom(req);
    if (token) await store.deleteSession(await sha256Hex(token));
    return { status: 200, json: { ok: true }, setCookie: sessionCookie('', 0, secure) };
  }

  if (method === 'GET' && path === '/me') {
    const user = await userFromAuth(store, req);
    const lockoutMinutes = hub ? hub.config.LOCKOUT_MINUTES : undefined;
    if (!user) return { status: 200, json: { me: null, lockoutMinutes } };
    return { status: 200, json: { me: profile(user), now: Date.now(), lockoutMinutes } };
  }

  if (method === 'GET' && path === '/board') {
    return { status: 200, json: hub ? hub.board : await store.board(1) };
  }

  return err(404, 'Not found.');
}
