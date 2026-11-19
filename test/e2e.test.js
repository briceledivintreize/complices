// Parties complètes à travers le vrai serveur (HTTP + WebSocket) : un duo, puis un groupe de 3.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createMemoryStore } from '../server/store.js';

process.env.PUBLIC_URL = 'http://complices.test';
process.env.ADMIN_TOKEN = 'jeton-de-test';
const { start, stop } = await import('../server/index.js');

const store = createMemoryStore();
let base, wsBase;
before(async () => {
  const server = await start(0, { store });
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});
after(() => stop());

const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const admin = { Authorization: 'Bearer jeton-de-test' };

function client(creds) {
  const ws = new WebSocket(wsBase);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); inbox.splice(inbox.indexOf(m), 1); w.resolve(m); }
  });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', ...creds })));
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    act: (a, extra = {}) => ws.send(JSON.stringify({ t: 'action', a, ...extra })),
    wait(pred, ms = 6000) {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise((resolve, reject) => {
        waiters.push({ pred, resolve });
        setTimeout(() => reject(new Error('timeout')), ms);
      });
    },
  };
}
const st = (pred) => (m) => m.t === 'state' && pred(m.view);

function answerFor(view) {
  const { input, card } = view.round;
  if (input === 'dare' || input === 'choice') return { type: 'choice', value: 0 };
  if (input === 'scale') return { type: 'scale', value: card.scale.min };
  if (input === 'draw') return { type: 'draw', strokes: [[0.1, 0.1, 0.9, 0.9]] };
  if (input === 'player') return { type: 'player', value: view.players[0].seat };
  return { type: 'text', value: 'Un fou rire' };
}

test('duo : créer, inviter, rejoindre, négocier, jouer un tour, réagir, arrêter', async () => {
  const home = await fetch(base + '/');
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await post('/api/rooms', { name: 'Brice', orientation: 'romance', where: 'remote', ageOk: false })).status, 400);
  assert.equal((await post('/api/rooms', { name: 'Brice', orientation: 'romance', where: 'remote', ageOk: true, mode: 'group' })).status, 400, 'drague en duo seulement');

  const created = await (await post('/api/rooms', { name: 'Brice', orientation: 'romance', where: 'remote', ageOk: true })).json();
  assert.match(created.invite.link, /^http:\/\/complices\.test\/j\/[0-9A-Z]{8}$/);
  const code = created.invite.link.split('/j/')[1];
  const A = client({ roomId: created.roomId, playerId: created.playerId, secret: created.secret });
  const lobby = await A.wait(st((v) => v.phase === 'lobby'));
  assert.equal(lobby.invite.code.replace('-', ''), code);
  assert.equal((await fetch(`${base}/qr/${code}.svg`)).status, 200);

  const info = await (await fetch(`${base}/api/invite/${code.slice(0, 4)}-${code.slice(4).toLowerCase()}`)).json();
  assert.equal(info.hostName, 'Brice');
  assert.equal(info.mode, 'duo');

  const joined = await (await post(`/api/invite/${code}/join`, { name: 'Inès', ageOk: true })).json();
  assert.equal((await post(`/api/invite/${code}/join`, { name: 'Intrus', ageOk: true })).status, 410, 'lien à usage unique en duo');

  const B = client({ roomId: joined.roomId, playerId: joined.playerId, secret: joined.secret });
  await A.wait(st((v) => v.phase === 'negotiate'));
  await B.wait(st((v) => v.phase === 'negotiate'));

  const bad = client({ roomId: joined.roomId, playerId: joined.playerId, secret: 'faux' });
  assert.equal((await bad.wait((m) => m.t === 'error')).code, 'unknown');

  A.act('set_level', { level: 3 });
  B.act('set_level', { level: 2 });
  const pickA = await A.wait(st((v) => v.phase === 'pick'));
  assert.equal(pickA.view.level, 2);
  assert.equal(pickA.view.round.role, 'leader');
  assert.equal((await B.wait(st((v) => v.phase === 'pick'))).view.round.options, null);

  A.act('pick', { cardId: pickA.view.round.options[0].id });
  const wA = await A.wait(st((v) => v.phase === 'write'));
  const wB = await B.wait(st((v) => v.phase === 'write'));

  B.send({ t: 'ink', state: 'writing' });
  const ink = await A.wait((m) => m.t === 'peer_ink');
  assert.deepEqual([ink.seat, ink.state], ['B', 'writing']);

  B.act('pose', { answer: answerFor(wB.view) });
  const seen = await A.wait(st((v) => v.round?.posed.B));
  assert.equal(seen.view.round.answers, null);

  const t0 = Date.now();
  A.act('pose', { answer: answerFor(wA.view) });
  const sig = await A.wait(st((v) => v.phase === 'signal'));
  assert.ok(sig.view.round.answers.B, 'réponse pré-livrée pour une révélation sans décalage');
  const rev = await B.wait(st((v) => v.phase === 'reveal'), 8000);
  assert.ok(Date.now() - t0 >= 2900);
  if (rev.view.round.canJudge) B.act('judge', { verdicts: Object.fromEntries(rev.view.round.judgeable.map((s) => [s, 'exact'])) });
  await A.wait(st((v) => v.phase === 'reveal' && (!v.round.needsJudge || v.round.judged)));
  A.act('next');
  assert.equal((await B.wait(st((v) => v.phase === 'pick' && v.roundNo === 2))).view.round.role, 'leader');

  A.send({ t: 'react', emoji: '❤️' });
  const react = await B.wait((m) => m.t === 'react');
  assert.deepEqual([react.seat, react.emoji], ['A', '❤️']);

  A.act('lower');
  assert.equal((await B.wait(st((v) => v.level === 1))).view.notice.type, 'lowered');
  B.act('stop');
  assert.equal((await A.wait(st((v) => v.phase === 'end'))).view.endReason, 'stopped');
  B.ws.close();
  await A.wait(st((v) => v.players.find((p) => p.seat === 'B').connected === false));
  A.ws.close(); bad.ws.close();
});

test('groupe de 3 : lien partagé, lancement par l’hôte, question perso, vote de la Cible, banque de questions', async () => {
  const created = await (await post('/api/rooms', { name: 'Brice', orientation: 'friendship', where: 'together', ageOk: true, mode: 'group' })).json();
  const code = created.invite.link.split('/j/')[1];
  const A = client({ roomId: created.roomId, playerId: created.playerId, secret: created.secret });
  await A.wait(st((v) => v.phase === 'lobby'));

  const people = [];
  for (const name of ['Inès', 'Karim']) {
    const r = await post(`/api/invite/${code}/join`, { name, ageOk: true });
    assert.equal(r.status, 201, 'le lien de groupe sert plusieurs fois');
    people.push(client({ ...(await r.json()) }));
  }
  assert.equal((await post(`/api/invite/${code}/join`, { name: 'inès', ageOk: true })).status, 409, 'pseudo déjà pris');
  const [B, C] = people;
  const lobbyB = await B.wait(st((v) => v.phase === 'lobby' && v.players.length === 3));
  assert.ok(lobbyB.invite, 'tout le groupe peut repartager le lien');
  const info = await (await fetch(`${base}/api/invite/${code}`)).json();
  assert.deepEqual(info.players, ['Brice', 'Inès', 'Karim']);

  B.act('start');
  assert.equal((await B.wait((m) => m.t === 'error')).code, 'not_host');
  A.act('start');
  for (const P of [A, B, C]) await P.wait(st((v) => v.phase === 'negotiate'));
  assert.equal((await post(`/api/invite/${code}/join`, { name: 'Tard', ageOk: true })).status, 410, 'plus personne après le lancement');

  A.act('set_level', { level: 2 }); B.act('set_level', { level: 3 }); C.act('set_level', { level: 2 });
  const pick = await A.wait(st((v) => v.phase === 'pick'));
  assert.equal(pick.view.round.leader, 'A');

  // Le Meneur écrit sa propre question, choisit Karim comme Cible et la partage à la banque.
  A.act('pick_custom', { card: { text: 'De 1 à 10, à quel point tu es du matin ?', kind: 'bet', input: 'scale', scale: { minLabel: 'Zombie', maxLabel: 'Coq' } }, target: 'C', share: true });
  const wC = await C.wait(st((v) => v.phase === 'write'));
  assert.equal(wC.view.round.role, 'target');
  assert.equal(wC.view.round.card.custom, true);
  assert.equal(wC.view.round.card.author, 'Brice');
  assert.equal((await B.wait(st((v) => v.phase === 'write'))).view.round.role, 'player');

  C.act('pose', { answer: { type: 'scale', value: 8 } });
  A.act('pose', { answer: { type: 'scale', value: 8 } });
  B.act('pose', { answer: { type: 'scale', value: 3 } });
  const sig = await B.wait(st((v) => v.phase === 'signal'));
  assert.deepEqual(Object.keys(sig.view.round.answers).sort(), ['A', 'C'], 'toutes les autres ardoises pré-livrées');
  const rev = await B.wait(st((v) => v.phase === 'reveal'), 8000);
  assert.deepEqual(rev.view.round.gains, { C: 2, A: 3 });

  // La banque a reçu la question, sans pseudo ni partie.
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].text, 'De 1 à 10, à quel point tu es du matin ?');
  assert.equal(store.rows[0].player_count, 3);
  assert.equal(JSON.stringify(store.rows[0]).includes('Brice'), false);

  // Administration : protégée, puis validation qui ajoute la question aux cartes.
  assert.equal((await fetch(`${base}/api/admin/questions`)).status, 404);
  const list = await (await fetch(`${base}/api/admin/questions?status=pending`, { headers: admin })).json();
  assert.equal(list.questions.length, 1);
  const ok = await post(`/api/admin/questions/${list.questions[0].id}`, { status: 'approved' }, admin);
  assert.equal(ok.status, 200);
  const stats = await (await fetch(`${base}/api/admin/stats`, { headers: admin })).json();
  assert.equal(stats.community.friendship, 1);

  // Un joueur quitte : la partie continue à deux.
  C.act('leave');
  const afterLeave = await A.wait(st((v) => v.players.find((p) => p.seat === 'C')?.left));
  assert.equal(afterLeave.view.phase, 'reveal');
  A.act('next');
  const p2 = await B.wait(st((v) => v.phase === 'pick' && v.roundNo === 2));
  assert.equal(p2.view.round.leader, 'B');
  assert.equal(p2.view.round.target, 'A');

  for (const P of [A, B, C]) P.ws.close();
});

test('un code inconnu renvoie une erreur claire', async () => {
  const r = await fetch(`${base}/api/invite/ZZZZZZZZ`);
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /expiré|existe/);
});
