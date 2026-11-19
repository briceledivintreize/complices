import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError } from '../server/game.js';

const S10 = { min: 1, max: 10, minLabel: 'peu', maxLabel: 'beaucoup' };
const deck = [
  { id: 't1', level: 1, kind: 'truth', input: 'text', where: 'any', players: 'any', text: 'En un mot ?' },
  { id: 'b1', level: 1, kind: 'bet', input: 'scale', where: 'any', players: 'any', text: 'De 1 à 10 ?', scale: S10 },
  { id: 'b2', level: 2, kind: 'bet', input: 'choice', where: 'any', players: 'any', text: 'Mer ou montagne ?', choices: ['Mer', 'Montagne'] },
  { id: 'd1', level: 1, kind: 'dare', input: 'text', where: 'any', players: 'any', text: 'Imite-moi.' },
  { id: 'd2', level: 3, kind: 'dare', input: 'text', where: 'together', players: 'any', text: 'Regarde-moi 30 s.' },
  { id: 'd3', level: 1, kind: 'dare', input: 'text', where: 'remote', players: 'any', text: 'Envoie un vocal.' },
  { id: 'm1', level: 1, kind: 'mirror', input: 'scale', where: 'any', players: 'any', text: 'Ton énergie ?', scale: S10 },
  { id: 'm2', level: 2, kind: 'mirror', input: 'draw', where: 'any', players: 'duo', text: 'Dessine-nous.' },
  { id: 'm3', level: 3, kind: 'mirror', input: 'text', where: 'any', players: 'any', text: 'Un mot ?' },
  { id: 'v1', level: 1, kind: 'vote', input: 'player', where: 'any', players: 'group', text: 'Qui ici… ?' },
];

function makeGame({ mode = 'duo', orientation = 'friendship', where = 'together', n = 2 } = {}) {
  let now = 1_000_000;
  const g = new Game({ id: 'g1', orientation, where, deck, mode, rng: () => 0, clock: () => now });
  const names = ['Brice', 'Inès', 'Karim', 'Léa', 'Yanis'];
  for (let i = 0; i < n; i++) g.addPlayer({ id: `p${i}`, name: names[i] });
  for (const s of g.order) g.setConnected(s, true);
  return { g, tick: (ms) => { now += ms; } };
}

function duo(levels = [3, 2]) {
  const t = makeGame();
  t.g.setLevel('A', levels[0]);
  t.g.setLevel('B', levels[1]);
  return t;
}

function group(n = 3, level = 1) {
  const t = makeGame({ mode: 'group', n });
  t.g.start('A');
  for (const s of t.g.order) t.g.setLevel(s, level);
  return t;
}

const force = (g, id) => { g.round.options = [deck.find((c) => c.id === id)]; };

// ---------- duo ----------

test('duo : la partie démarre quand le 2e joueur arrive, niveau = minimum, secret', () => {
  const { g } = duo([3, 2]);
  assert.equal(g.level, 2);
  assert.equal(g.phase, 'pick');
  const v = g.view('B');
  assert.equal(v.players.find((p) => p.seat === 'A').levelSet, true);
  assert.equal('level' in v.players[0], false);
});

test('duo : seules les cartes duo ou communes sont tirées, au bon niveau et au bon lieu', () => {
  const { g } = duo([1, 1]);
  assert.ok(g.deck.every((c) => c.players !== 'group'));
  assert.ok(g.deck.every((c) => c.where !== 'remote'));
  for (const c of g.round.options) assert.ok(c.level <= 1);
});

test('duo : seul le Meneur choisit, la réponse reste cachée jusqu’au signal', () => {
  const { g, tick } = duo([1, 1]);
  assert.throws(() => g.pick('B', g.round.options[0].id), GameError);
  force(g, 'b1');
  g.pick('A', 'b1');
  g.pose('B', { type: 'scale', value: 8 });
  assert.equal(g.view('A').round.answers, null);
  g.pose('A', { type: 'scale', value: 8 });
  assert.equal(g.phase, 'signal');
  assert.deepEqual(g.view('A').round.answers.B, { type: 'scale', value: 8 });
  assert.equal(g.advance(), false);
  tick(3000);
  assert.equal(g.advance(), true);
  assert.equal(g.round.auto.A, 'exact');
  assert.equal(g.players.A.flair, 3);
  assert.equal(g.players.B.flair, 2);
});

test('duo : vérité écrite jugée par la Cible', () => {
  const { g, tick } = duo([1, 1]);
  force(g, 't1');
  g.pick('A', 't1');
  g.pose('B', { type: 'text', value: '  Un   fou rire ' });
  g.pose('A', { type: 'text', value: 'Fou rire' });
  tick(3000); g.advance();
  assert.equal(g.round.answers.B.value, 'Un fou rire');
  assert.deepEqual(g.round.judgeable, ['A']);
  assert.equal(g.view('B').round.canJudge, true);
  assert.throws(() => g.next('A'), GameError);
  assert.throws(() => g.judge('A', { A: 'exact' }), GameError);
  g.judge('B', { A: 'exact' });
  assert.equal(g.players.A.flair, 3);
  g.next('A');
  assert.equal(g.round.leader, 'B');
});

test('duo : action relevée, pari juste', () => {
  const { g, tick } = duo([1, 1]);
  force(g, 'd1');
  g.pick('A', 'd1');
  assert.equal(g.view('B').round.input, 'dare');
  g.pose('B', { type: 'choice', value: 0 });
  g.pose('A', { type: 'choice', value: 0 });
  tick(3000); g.advance();
  assert.equal(g.round.dareAccepted, true);
  assert.equal(g.players.A.flair, 3);
  assert.equal(g.players.B.flair, 2);
});

test('duo : miroir identique = âmes jumelles', () => {
  const { g, tick } = duo([1, 1]);
  force(g, 'm1');
  g.pick('A', 'm1');
  g.pose('A', { type: 'scale', value: 4 });
  g.pose('B', { type: 'scale', value: 4 });
  tick(3000); g.advance();
  assert.deepEqual(g.round.soulmates.sort(), ['A', 'B']);
  assert.equal(g.players.A.flair, 2);
  assert.equal(g.complicity, 2);
});

test('duo : miroir écrit jugé par la Cible, verdict appliqué aux deux', () => {
  const { g, tick } = duo([3, 3]);
  force(g, 'm3');
  g.pick('A', 'm3');
  g.pose('A', { type: 'text', value: 'mer' });
  g.pose('B', { type: 'text', value: 'mer' });
  tick(3000); g.advance();
  g.judge('B', { A: 'exact' });
  assert.equal(g.players.A.flair, 2);
  assert.equal(g.players.B.flair, 2);
});

test('duo : passer est gratuit et possible jusqu’au signal', () => {
  const { g } = duo([1, 1]);
  force(g, 't1');
  g.pick('A', 't1');
  g.pass('A');
  assert.equal(g.round.outcome, 'passed');
  g.next('A');
  force(g, 't1');
  g.pick('B', 't1');
  g.pose('A', { type: 'text', value: 'a' });
  g.pose('B', { type: 'text', value: 'b' });
  assert.throws(() => g.pass('A'), GameError);
});

test('duo : redescendre en Doux retire la carte trop intense', () => {
  const { g } = duo([3, 3]);
  force(g, 'm3');
  g.pick('A', 'm3');
  g.lower('B');
  assert.equal(g.level, 1);
  assert.equal(g.round.outcome, 'lowered');
  g.next('A');
  for (const c of g.round.options) assert.equal(c.level, 1);
});

test('duo : 10 tours puis revanche ; stop termine tout de suite', () => {
  const { g } = duo([1, 1]);
  for (let i = 0; i < 10; i++) { g.pass('A'); g.next('A'); }
  assert.equal(g.phase, 'end');
  g.rematch('B');
  assert.equal(g.phase, 'negotiate');
  g.setLevel('A', 1); g.setLevel('B', 1);
  g.stop('B');
  assert.equal(g.endReason, 'stopped');
});

test('validation des réponses : vide, trop long, mauvais type, dessin normalisé', () => {
  const { g } = duo([2, 2]);
  force(g, 't1');
  g.pick('A', 't1');
  assert.throws(() => g.pose('A', { type: 'text', value: '  ' }), GameError);
  assert.throws(() => g.pose('A', { type: 'text', value: 'x'.repeat(61) }), GameError);
  assert.throws(() => g.pose('A', { type: 'scale', value: 3 }), GameError);
  g.pass('A'); g.next('A');
  force(g, 'm2');
  g.pick('B', 'm2');
  g.pose('A', { type: 'draw', strokes: [[0.12345, 2, -1, 0.5]] });
  assert.deepEqual(g.round.answers.A.strokes, [[0.123, 1, 0, 0.5]]);
});

// ---------- questions perso ----------

test('question perso : le Meneur écrit sa carte, au niveau de la partie', () => {
  const { g, tick } = duo([2, 3]);
  const card = g.pickCustom('A', { text: '  Ton   souvenir préféré de nous ? ', kind: 'truth', input: 'text' });
  assert.equal(card.text, 'Ton souvenir préféré de nous ?');
  assert.equal(card.level, 2);
  assert.equal(card.custom, true);
  assert.equal(card.author, 'Brice');
  assert.equal(g.phase, 'write');
  g.pose('B', { type: 'text', value: 'La plage' });
  g.pose('A', { type: 'text', value: 'La plage' });
  tick(3000); g.advance();
  assert.equal(g.round.needsJudge, true);
});

test('question perso : choix et échelle normalisés, saisies incohérentes refusées', () => {
  const { g } = duo([1, 1]);
  assert.throws(() => g.pickCustom('A', { text: 'Ok ?', kind: 'truth', input: 'text' }), GameError);
  assert.throws(() => g.pickCustom('A', { text: 'Mer ou montagne ?', kind: 'bet', input: 'text' }), GameError);
  assert.throws(() => g.pickCustom('A', { text: 'Mer ou montagne ?', kind: 'bet', input: 'choice', choices: ['Mer'] }), GameError);
  assert.throws(() => g.pickCustom('A', { text: 'Qui ici est le plus drôle ?', kind: 'vote' }), GameError, 'pas de vote en duo');
  assert.throws(() => g.pickCustom('B', { text: 'Mer ou montagne ?', kind: 'mirror', input: 'scale' }), GameError, 'seul le Meneur');
  const c = g.pickCustom('A', { text: 'Ton envie de voyager ?', kind: 'bet', input: 'scale', scale: { minLabel: '', maxLabel: 'Partir demain' } });
  assert.deepEqual(c.scale, { min: 1, max: 10, minLabel: 'Pas du tout', maxLabel: 'Partir demain' });
});

// ---------- groupe ----------

test('groupe : la Drague / couple est réservée aux duos', () => {
  assert.throws(() => makeGame({ mode: 'group', orientation: 'romance' }), GameError);
});

test("groupe : on rejoint jusqu'à 8, l'hôte lance, plus personne n'entre ensuite", () => {
  const { g } = makeGame({ mode: 'group', n: 8 });
  assert.equal(g.order.length, 8);
  assert.throws(() => g.addPlayer({ id: 'x', name: 'X' }), GameError);
  assert.equal(g.phase, 'lobby');
  assert.throws(() => g.start('B'), GameError);
  g.start('A');
  assert.equal(g.phase, 'negotiate');
  assert.equal(g.roundsMax, 10);
  for (const s of g.order) g.setLevel(s, 2);
  assert.equal(g.roundsMax, 16);
});

test('groupe : niveau = minimum de tous les curseurs', () => {
  const { g } = makeGame({ mode: 'group', n: 4 });
  g.start('A');
  g.setLevel('A', 3); g.setLevel('B', 3); g.setLevel('C', 2);
  assert.equal(g.phase, 'negotiate');
  g.setLevel('D', 3);
  assert.equal(g.level, 2);
  assert.equal(g.phase, 'pick');
});

test('groupe : le Meneur choisit la Cible, tous les autres parient', () => {
  const { g, tick } = group(4);
  force(g, 'b1');
  assert.throws(() => g.pick('A', 'b1', 'A'), GameError);
  g.pick('A', 'b1', 'C');
  assert.equal(g.round.target, 'C');
  assert.equal(g.view('C').round.role, 'target');
  assert.equal(g.view('B').round.role, 'player');
  g.pose('C', { type: 'scale', value: 7 });
  g.pose('A', { type: 'scale', value: 7 });
  g.pose('B', { type: 'scale', value: 6 });
  assert.equal(g.phase, 'write');
  g.pose('D', { type: 'scale', value: 2 });
  assert.equal(g.phase, 'signal');
  tick(3000); g.advance();
  assert.deepEqual(g.round.gains, { C: 2, A: 3, B: 1 });
  assert.equal(g.round.auto.D, 'miss');
});

test('groupe : vérité écrite, la Cible juge chaque ardoise', () => {
  const { g, tick } = group(3);
  force(g, 't1');
  g.pick('A', 't1', 'B');
  g.pose('B', { type: 'text', value: 'Paris' });
  g.pose('A', { type: 'text', value: 'Paris' });
  g.pose('C', { type: 'text', value: 'Lyon' });
  tick(3000); g.advance();
  assert.deepEqual(g.round.judgeable.sort(), ['A', 'C']);
  assert.throws(() => g.judge('B', { A: 'exact' }), GameError, 'il faut juger chaque ardoise');
  g.judge('B', { A: 'exact', C: 'miss' });
  assert.equal(g.players.A.flair, 3);
  assert.equal(g.players.C.flair, 0);
  assert.equal(g.players.B.flair, 2);
});

test('groupe : vote, la majorité gagne', () => {
  const { g, tick } = group(4);
  force(g, 'v1');
  g.pick('A', 'v1');
  assert.equal(g.view('B').round.input, 'player');
  g.pose('A', { type: 'player', value: 'C' });
  g.pose('B', { type: 'player', value: 'C' });
  g.pose('C', { type: 'player', value: 'D' });
  assert.throws(() => g.pose('D', { type: 'player', value: 'Z' }), GameError);
  g.pose('D', { type: 'player', value: 'C' });
  tick(3000); g.advance();
  assert.deepEqual(g.round.vote.winners, ['C']);
  assert.equal(g.round.vote.counts.C, 3);
  assert.deepEqual(g.round.gains, { A: 1, B: 1, D: 1 });
});

test('groupe : miroir, chaque paire identique marque', () => {
  const { g, tick } = group(3);
  force(g, 'm1');
  g.pick('A', 'm1');
  g.pose('A', { type: 'scale', value: 5 });
  g.pose('B', { type: 'scale', value: 5 });
  g.pose('C', { type: 'scale', value: 6 });
  tick(3000); g.advance();
  assert.deepEqual(g.round.soulmates.sort(), ['A', 'B']);
  assert.equal(g.round.auto.C, 'close');
});

test("groupe : un parieur peut s'abstenir, la Cible qui passe passe la carte", () => {
  const { g, tick } = group(3);
  force(g, 'b1');
  g.pick('A', 'b1', 'B');
  g.pass('C');
  assert.equal(g.phase, 'write');
  assert.equal(g.round.answers.C.type, 'skip');
  g.pose('B', { type: 'scale', value: 3 });
  g.pose('A', { type: 'scale', value: 3 });
  tick(3000); g.advance();
  assert.equal(g.round.outcome, 'played');
  assert.equal(g.round.gains.C, undefined);
  g.next('A');
  force(g, 'b1');
  g.pick('B', 'b1', 'C');
  g.pass('C');
  assert.equal(g.round.outcome, 'passed');
});

test("groupe : un joueur déconnecté ne bloque pas le signal", () => {
  const { g } = group(3);
  force(g, 'm1');
  g.pick('A', 'm1');
  g.pose('A', { type: 'scale', value: 5 });
  g.pose('B', { type: 'scale', value: 5 });
  assert.equal(g.phase, 'write');
  g.setConnected('C', false);
  assert.equal(g.phase, 'signal');
});

test("groupe : quitter la partie, l'hôte passe la main, seul on s'arrête", () => {
  const { g } = group(3);
  g.leave('A');
  assert.equal(g.host, 'B');
  assert.equal(g.round.outcome, 'passed', 'le Meneur est parti : la carte est passée');
  g.next('B');
  assert.notEqual(g.round.leader, 'A');
  g.stop('C'); // pas l'hôte : quitte seulement
  assert.equal(g.players.C.left, true);
  assert.equal(g.phase, 'end');
  assert.equal(g.endReason, 'alone');
});

test('groupe : les Meneurs tournent dans l’ordre d’arrivée', () => {
  const { g } = group(3);
  const leaders = [];
  for (let i = 0; i < 4; i++) { leaders.push(g.round.leader); g.pass(g.round.leader); g.next('A'); }
  assert.deepEqual(leaders, ['A', 'B', 'C', 'A']);
});
