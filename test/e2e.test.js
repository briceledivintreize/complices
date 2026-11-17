// Partie complète à deux joueurs à travers le vrai serveur (HTTP + WebSocket).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

process.env.PUBLIC_URL = 'http://complices.test';
const { start, stop } = await import('../server/index.js');

let base, wsBase;
before(async () => {
  const server = await start(0);
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});
after(() => stop());

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function client(creds) {
  const ws = new WebSocket(wsBase);
  const inbox = [];
  const waiters = [];
  let last = null;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'state') last = m;
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const ready = new Promise((r) => ws.on('open', r)).then(() => ws.send(JSON.stringify({ t: 'hello', ...creds })));
  return {
    ws, ready, inbox,
    get last() { return last; },
    send: (m) => ws.send(JSON.stringify(m)),
    act: (a, extra = {}) => ws.send(JSON.stringify({ t: 'action', a, ...extra })),
    wait(pred, ms = 6000) {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error('timeout')), ms);
      });
    },
    phase: (p) => (m) => m.t === 'state' && m.view.phase === p,
  };
}

function answerFor(view) {
  const { input, card } = view.round;
  if (input === 'dare' || input === 'choice') return { type: 'choice', value: 0 };
  if (input === 'scale') return { type: 'scale', value: card.scale.min };
  if (input === 'draw') return { type: 'draw', strokes: [[0.1, 0.1, 0.9, 0.9]] };
  return { type: 'text', value: 'Un fou rire' };
}

test('créer, inviter, rejoindre, négocier et jouer un tour complet', async () => {
  // Page d'accueil et fichiers servis
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);

  // Garde d'âge
  const refused = await post('/api/rooms', { name: 'Brice', orientation: 'romance', where: 'remote', ageOk: false });
  assert.equal(refused.status, 400);

  const created = await (await post('/api/rooms', { name: 'Brice', orientation: 'romance', where: 'remote', ageOk: true })).json();
  assert.ok(created.roomId && created.secret);
  assert.match(created.invite.link, /^http:\/\/complices\.test\/j\/[0-9A-Z]{8}$/);
  const code = created.invite.link.split('/j/')[1];

  const A = client({ roomId: created.roomId, playerId: created.playerId, secret: created.secret });
  const lobby = await A.wait(A.phase('lobby'));
  assert.equal(lobby.invite.code.replace('-', ''), code);

  // QR code
  const qr = await fetch(`${base}/qr/${code}.svg`);
  assert.equal(qr.status, 200);
  assert.match(await qr.text(), /<svg/);

  // L'invité voit la partie avant d'accepter, code saisi en minuscules avec tiret
  const pretty = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
  const info = await (await fetch(`${base}/api/invite/${pretty}`)).json();
  assert.equal(info.hostName, 'Brice');
  assert.equal(info.minAge, 18);

  const joined = await (await post(`/api/invite/${code}/join`, { name: 'Inès', ageOk: true })).json();
  assert.ok(joined.roomId === created.roomId);

  // Lien à usage unique
  const again = await post(`/api/invite/${code}/join`, { name: 'Intrus', ageOk: true });
  assert.equal(again.status, 410);

  const B = client({ roomId: joined.roomId, playerId: joined.playerId, secret: joined.secret });
  await A.wait(A.phase('negotiate'));
  await B.wait(B.phase('negotiate'));

  // Mauvais secret refusé
  const bad = client({ roomId: joined.roomId, playerId: joined.playerId, secret: 'faux' });
  const err = await bad.wait((m) => m.t === 'error');
  assert.equal(err.code, 'unknown');

  // Curseurs secrets
  A.act('set_level', { level: 3 });
  const afterA = await B.wait((m) => m.t === 'state' && m.view.peer?.levelSet);
  assert.equal(afterA.view.phase, 'negotiate');
  B.act('set_level', { level: 2 });
  const pickA = await A.wait(A.phase('pick'));
  assert.equal(pickA.view.level, 2);
  assert.equal(pickA.view.round.role, 'leader');
  assert.ok(pickA.view.round.options.length >= 2);
  const pickB = await B.wait(B.phase('pick'));
  assert.equal(pickB.view.round.options, null);

  // Le Meneur choisit une carte
  const card = pickA.view.round.options[0];
  A.act('pick', { cardId: card.id });
  const wA = await A.wait(A.phase('write'));
  const wB = await B.wait(B.phase('write'));

  // Pendant l'écriture : l'autre voit la craie bouger, jamais le contenu
  B.send({ t: 'ink', state: 'writing' });
  const ink = await A.wait((m) => m.t === 'peer_ink');
  assert.equal(ink.state, 'writing');

  B.act('pose', { answer: answerFor(wB.view) });
  const seen = await A.wait((m) => m.t === 'state' && m.view.round?.peerPosed);
  assert.equal(seen.view.round.peerAnswer, null);

  // Les deux craies posées : signal avec heure de révélation, puis révélation
  const t0 = Date.now();
  A.act('pose', { answer: answerFor(wA.view) });
  const sig = await A.wait(A.phase('signal'));
  assert.ok(sig.view.round.revealAt > sig.view.serverNow);
  assert.ok(sig.view.round.peerAnswer, 'réponse pré-livrée pour une révélation sans décalage');
  const rev = await B.wait(B.phase('reveal'), 8000);
  assert.ok(Date.now() - t0 >= 2900, 'la révélation attend la fin du compte à rebours');
  assert.equal(rev.view.round.outcome, 'played');

  // Juger si nécessaire, puis tour suivant : les rôles s'inversent
  if (rev.view.round.canJudge) B.act('judge', { verdict: 'exact' });
  const revA = await A.wait((m) => m.t === 'state' && m.view.phase === 'reveal' && (!m.view.round.needsJudge || m.view.round.verdict));
  A.act('next');
  const p2 = await B.wait((m) => m.t === 'state' && m.view.phase === 'pick' && m.view.roundNo === 2);
  assert.equal(p2.view.round.role, 'leader');
  assert.ok(revA);

  // Réactions relayées
  A.send({ t: 'react', emoji: '❤️' });
  const react = await B.wait((m) => m.t === 'react');
  assert.equal(react.emoji, '❤️');

  // Redescendre en Doux, puis Stop
  A.act('lower');
  const low = await B.wait((m) => m.t === 'state' && m.view.level === 1);
  assert.equal(low.view.notice.type, 'lowered');
  B.act('stop');
  const end = await A.wait(A.phase('end'));
  assert.equal(end.view.endReason, 'stopped');

  // Déconnexion visible pour l'autre
  B.ws.close();
  const gone = await A.wait((m) => m.t === 'state' && m.view.peer && m.view.peer.connected === false);
  assert.ok(gone);

  A.ws.close(); bad.ws.close();
});

test('un code inconnu renvoie une erreur claire', async () => {
  const r = await fetch(`${base}/api/invite/ZZZZZZZZ`);
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /expiré|existe/);
});
