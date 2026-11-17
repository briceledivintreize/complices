// Serveur Complices : fichiers statiques, API d'invitation et salles temps réel (WebSocket).
// Le serveur fait autorité : le client propose une action, le moteur la valide puis l'état est diffusé.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { Game, GameError, ORIENTATIONS, WHERE, LEVELS } from './game.js';
import { loadDecks } from './deck.js';
import { newCode, normalizeCode, hashCode, prettyCode, newSecret, sameSecret } from './invite.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
// Derrière un hébergeur (Render, Railway, Fly…), l'IP réelle et le HTTPS arrivent dans des en-têtes du proxy.
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || Boolean(process.env.RENDER);
const INVITE_TTL_MS = 24 * 3600_000;
const ROOM_IDLE_MS = 6 * 3600_000;
const REACTIONS = new Set(['😂', '😳', '❤️', '🤯', '🔥', '👏']);
const INK_STATES = new Set(['writing', 'erasing', 'idle']);

const decks = loadDecks(path.join(ROOT, 'decks'));
/** @type {Map<string, {game: Game, secrets: {A?: string, B?: string}, sockets: {A?: any, B?: any}, invite: any, timer: any}>} */
const rooms = new Map();
/** hash du code → { roomId, expiresAt, usedAt } */
const invites = new Map();

// ---------- utilitaires HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

if (TRUST_PROXY) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000';

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || '?';
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const json = (res, status, obj) => send(res, status, obj, 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });

function readJson(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}

const hits = new Map();
function rateLimited(req, bucket, max) {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.resetAt < now) { hits.set(key, { n: 1, resetAt: now + 60_000 }); return false; }
  h.n += 1;
  return h.n > max;
}

function cleanName(raw) {
  const s = String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= 20 ? s : null;
}

function lanAddress() {
  const all = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  return (all.find((i) => i.address.startsWith('192.168.')) || all[0])?.address || null;
}

/** Lien d'invitation : si on joue depuis localhost, on donne l'adresse du PC sur le Wi-Fi pour que le téléphone de l'autre puisse l'ouvrir. */
function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = req.headers.host || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  if (/^(localhost|127\.|\[::1\])/.test(host)) {
    const lan = lanAddress();
    if (lan) return `http://${lan}:${PORT}`;
  }
  return `${proto}://${host}`;
}

// ---------- fichiers statiques ----------

const FONT_RE = /^(caveat|cabin-sketch|inter)-latin-\d{3}-normal\.woff2$/;

async function serveFile(res, file, cache = 'no-cache') {
  try {
    const data = await readFile(file);
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': cache });
  } catch {
    send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Page d'invitation avec un aperçu de lien qui donne envie (WhatsApp, Messenger, SMS). */
async function serveInvitePage(res, rawCode) {
  let html;
  try { html = await readFile(path.join(PUBLIC, 'index.html'), 'utf8'); } catch { return send(res, 500, 'Erreur', 'text/plain; charset=utf-8'); }
  const found = findInvite(rawCode);
  if (!found.error) {
    const host = escapeHtml(found.room.game.players.A.name);
    const label = escapeHtml(ORIENTATIONS[found.room.game.orientation].label);
    const meta = [
      `<meta property="og:title" content="${host} t'invite à jouer à Complices">`,
      `<meta property="og:description" content="${label}. Chacun écrit sur son ardoise, puis vous montrez vos cartes en même temps. Tu oses ?">`,
      '<meta property="og:type" content="website">',
    ].join('\n');
    html = html.replace('<!--OG-->', meta);
  }
  send(res, 200, html, MIME['.html'], { 'Cache-Control': 'no-store' });
}

async function serveStatic(req, res, pathname) {
  if (pathname.startsWith('/fonts/')) {
    const name = pathname.slice('/fonts/'.length);
    if (!FONT_RE.test(name)) return send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
    const pkg = name.match(FONT_RE)[1];
    return serveFile(res, path.join(ROOT, 'node_modules', '@fontsource', pkg, 'files', name), 'public, max-age=31536000, immutable');
  }
  const j = pathname.match(/^\/j\/([A-Za-z0-9-]{1,16})\/?$/);
  if (j) return serveInvitePage(res, j[1]);
  if (pathname === '/' || /^\/g\/[A-Za-z0-9_-]{1,40}\/?$/.test(pathname)) {
    return serveFile(res, path.join(PUBLIC, 'index.html'));
  }
  const file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC + path.sep) || !MIME[path.extname(file)] || !existsSync(file)) {
    return send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
  }
  return serveFile(res, file);
}

// ---------- salles ----------

function findInvite(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return { error: [404, "Ce code n'existe pas."] };
  const inv = invites.get(hashCode(code));
  if (!inv || inv.expiresAt < Date.now() || !rooms.has(inv.roomId)) return { error: [404, "Ce lien n'existe pas ou a expiré. Demande un nouveau lien."] };
  if (inv.usedAt) return { error: [410, 'Cette partie a déjà ses deux joueurs.'] };
  return { code, inv, room: rooms.get(inv.roomId) };
}

function broadcast(room) {
  const { game } = room;
  for (const seat of ['A', 'B']) {
    const ws = room.sockets[seat];
    if (!ws || ws.readyState !== 1) continue;
    const msg = { t: 'state', view: game.view(seat) };
    if (seat === 'A' && game.phase === 'lobby' && room.invite) msg.invite = room.invite;
    ws.send(JSON.stringify(msg));
  }
  // Le signal du Maître : à l'heure dite, les deux ardoises se retournent.
  if (game.phase === 'signal' && !room.timer) {
    const wait = Math.max(0, game.round.revealAt - Date.now()) + 5;
    room.timer = setTimeout(() => {
      room.timer = null;
      if (game.advance(Date.now())) broadcast(room);
    }, wait);
  }
}

function relay(room, fromSeat, msg) {
  const ws = room.sockets[fromSeat === 'A' ? 'B' : 'A'];
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ---------- API ----------

async function api(req, res, pathname) {
  try {
    if (req.method === 'POST' && pathname === '/api/rooms') {
      if (rateLimited(req, 'create', 15)) return json(res, 429, { error: 'Trop de parties créées. Réessaie dans une minute.' });
      const body = await readJson(req);
      const name = cleanName(body.name);
      if (!name) return json(res, 400, { error: 'Choisis un pseudo de 1 à 20 caractères.' });
      if (!ORIENTATIONS[body.orientation]) return json(res, 400, { error: 'Choisis une orientation.' });
      if (!WHERE[body.where]) return json(res, 400, { error: 'Dis-nous si vous jouez ensemble ou à distance.' });
      if (body.ageOk !== true) return json(res, 400, { error: `Cette orientation est réservée aux ${ORIENTATIONS[body.orientation].minAge} ans et plus.` });
      const deck = decks[body.orientation];
      if (!deck.length) return json(res, 503, { error: 'Les cartes de cette orientation ne sont pas encore chargées.' });

      const roomId = crypto.randomUUID();
      const playerId = crypto.randomUUID();
      const secret = newSecret();
      const game = new Game({ id: roomId, orientation: body.orientation, where: body.where, deck });
      game.addPlayer('A', { id: playerId, name });
      const code = newCode();
      const expiresAt = Date.now() + INVITE_TTL_MS;
      invites.set(hashCode(code), { roomId, expiresAt, usedAt: null });
      const invite = { code: prettyCode(code), link: `${baseUrl(req)}/j/${code}`, qr: `/qr/${code}.svg`, expiresAt };
      rooms.set(roomId, { game, secrets: { A: secret }, sockets: {}, invite, inviteHash: hashCode(code), timer: null });
      return json(res, 201, { roomId, playerId, secret, invite });
    }

    let m = pathname.match(/^\/api\/invite\/([A-Za-z0-9-]{1,16})$/);
    if (req.method === 'GET' && m) {
      if (rateLimited(req, 'invite', 40)) return json(res, 429, { error: 'Trop de tentatives. Réessaie dans une minute.' });
      const found = findInvite(m[1]);
      if (found.error) return json(res, found.error[0], { error: found.error[1] });
      const g = found.room.game;
      return json(res, 200, {
        hostName: g.players.A.name,
        orientation: g.orientation,
        orientationLabel: ORIENTATIONS[g.orientation].label,
        where: g.where,
        whereLabel: WHERE[g.where],
        minAge: ORIENTATIONS[g.orientation].minAge,
        levelMax: LEVELS[2],
      });
    }

    m = pathname.match(/^\/api\/invite\/([A-Za-z0-9-]{1,16})\/join$/);
    if (req.method === 'POST' && m) {
      if (rateLimited(req, 'invite', 40)) return json(res, 429, { error: 'Trop de tentatives. Réessaie dans une minute.' });
      const found = findInvite(m[1]);
      if (found.error) return json(res, found.error[0], { error: found.error[1] });
      const body = await readJson(req);
      const name = cleanName(body.name);
      if (!name) return json(res, 400, { error: 'Choisis un pseudo de 1 à 20 caractères.' });
      if (body.ageOk !== true) return json(res, 400, { error: `Cette partie est réservée aux ${ORIENTATIONS[found.room.game.orientation].minAge} ans et plus.` });
      const playerId = crypto.randomUUID();
      const secret = newSecret();
      found.inv.usedAt = Date.now();
      found.room.secrets.B = secret;
      found.room.invite = null;
      found.room.game.addPlayer('B', { id: playerId, name });
      broadcast(found.room);
      return json(res, 201, { roomId: found.inv.roomId, playerId, secret });
    }

    return json(res, 404, { error: 'Route inconnue.' });
  } catch (e) {
    if (e.message === 'too_large' || e.message === 'bad_json') return json(res, 400, { error: 'Requête invalide.' });
    if (e instanceof GameError) return json(res, 409, { error: e.message });
    console.error(e);
    return json(res, 500, { error: 'Erreur du serveur.' });
  }
}

async function qr(req, res, rawCode) {
  const found = findInvite(rawCode);
  if (found.error) return send(res, 404, 'Introuvable', 'text/plain; charset=utf-8');
  const svg = await QRCode.toString(found.room.invite.link, {
    type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#F1EEE4', light: '#00000000' },
  });
  send(res, 200, svg, MIME['.svg'], { 'Cache-Control': 'no-store' });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname.startsWith('/api/')) return api(req, res, pathname);
  const q = pathname.match(/^\/qr\/([A-Za-z0-9]{8})\.svg$/);
  if (q && req.method === 'GET') return qr(req, res, q[1]);
  if (pathname === '/health') return json(res, 200, { ok: true, rooms: rooms.size });
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée', 'text/plain; charset=utf-8');
  return serveStatic(req, res, pathname);
});

// ---------- WebSocket ----------

const ACTIONS = {
  set_level: (g, s, m) => g.setLevel(s, m.level),
  pick: (g, s, m) => g.pick(s, String(m.cardId)),
  pose: (g, s, m) => g.pose(s, m.answer),
  unpose: (g, s) => g.unpose(s),
  pass: (g, s) => g.pass(s),
  judge: (g, s, m) => g.judge(s, m.verdict),
  next: (g, s) => g.next(s),
  lower: (g, s) => g.lower(s),
  stop: (g, s) => g.stop(s),
  rematch: (g, s) => g.rematch(s),
};

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 128 * 1024 });

// Battement de cœur : un téléphone verrouillé ou sorti du réseau ne ferme pas toujours sa connexion.
// Sans réponse au ping, on coupe : l'autre joueur voit la pause au lieu d'attendre dans le vide.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* déjà fermé */ }
  }
}, 20_000);
heartbeat.unref();

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null;
  let seat = null;
  let budget = 40;
  const refill = setInterval(() => { budget = 40; }, 1000);
  const helloTimeout = setTimeout(() => { if (!room) ws.close(4001, 'hello attendu'); }, 5000);
  const reply = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  ws.on('message', (raw) => {
    if (--budget < 0) return;
    let m;
    try { m = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'ping') return reply({ t: 'pong', clientT: m.clientT, serverT: Date.now() });

    if (m.t === 'hello') {
      const r = rooms.get(String(m.roomId));
      const g = r?.game;
      const s = g?.seatOf(String(m.playerId));
      if (!r || !s || !sameSecret(r.secrets[s], m.secret)) {
        reply({ t: 'error', code: 'unknown', message: "Cette partie n'existe plus." });
        return ws.close(4004, 'inconnu');
      }
      clearTimeout(helloTimeout);
      const old = r.sockets[s];
      if (old && old !== ws) old.close(4000, 'remplacé');
      room = r; seat = s;
      r.sockets[s] = ws;
      g.setConnected(s, true);
      return broadcast(r);
    }

    if (!room) return;
    const g = room.game;

    if (m.t === 'ink') {
      if (g.phase === 'write' && INK_STATES.has(m.state)) relay(room, seat, { t: 'peer_ink', state: m.state });
      return;
    }
    if (m.t === 'react') {
      if (REACTIONS.has(m.emoji)) relay(room, seat, { t: 'react', emoji: m.emoji });
      return;
    }
    if (m.t === 'action') {
      const fn = ACTIONS[m.a];
      if (!fn) return;
      try {
        fn(g, seat, m);
        broadcast(room);
      } catch (e) {
        if (e instanceof GameError) reply({ t: 'error', code: e.code, message: e.message });
        else { console.error(e); reply({ t: 'error', code: 'server', message: 'Erreur du serveur.' }); }
      }
    }
  });

  ws.on('close', () => {
    clearInterval(refill);
    clearTimeout(helloTimeout);
    if (room && room.sockets[seat] === ws) {
      room.sockets[seat] = null;
      room.game.setConnected(seat, false);
      broadcast(room);
    }
  });
});

// Nettoyage : les réponses ne vivent qu'en mémoire et disparaissent avec la salle.
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) {
    const online = r.sockets.A || r.sockets.B;
    if (!online && now - r.game.updatedAt > ROOM_IDLE_MS) {
      clearTimeout(r.timer);
      rooms.delete(id);
      invites.delete(r.inviteHash);
    }
  }
  for (const [h, inv] of invites) if (inv.expiresAt < now && !inv.usedAt) invites.delete(h);
  for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
}, 10 * 60_000).unref();

export function start(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, HOST, () => {
      const p = server.address().port;
      const lan = lanAddress();
      const counts = Object.entries(decks).map(([k, v]) => `${k} ${v.length}`).join(', ');
      console.log(`\n  Complices est lancé.`);
      console.log(`  Sur ce PC :        http://localhost:${p}`);
      if (lan) console.log(`  Sur le Wi-Fi :     http://${lan}:${p}   (pour un téléphone connecté au même réseau)`);
      console.log(`  Cartes chargées :  ${counts}\n`);
      resolve(server);
    });
  });
}

export function stop() {
  for (const r of rooms.values()) clearTimeout(r.timer);
  wss.clients.forEach((c) => c.terminate());
  return new Promise((resolve) => server.close(resolve));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start();
  // Arrêt propre quand l'hébergeur redéploie ou arrête le service.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`\n  Arrêt demandé (${sig}).`);
      stop().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}
