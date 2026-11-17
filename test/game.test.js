import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameError } from '../server/game.js';

const deck = [
  { id: 't1', level: 1, kind: 'truth', input: 'text', where: 'any', text: 'En un mot ?' },
  { id: 'b1', level: 1, kind: 'bet', input: 'scale', where: 'any', text: 'De 1 à 10 ?', scale: { min: 1, max: 10, minLabel: 'peu', maxLabel: 'beaucoup' } },
  { id: 'b2', level: 2, kind: 'bet', input: 'choice', where: 'any', text: 'Mer ou montagne ?', choices: ['Mer', 'Montagne'] },
  { id: 'd1', level: 1, kind: 'dare', input: 'text', where: 'any', text: 'Imite-moi.' },
  { id: 'd2', level: 3, kind: 'dare', input: 'text', where: 'together', text: 'Regarde-moi 30 s.' },
  { id: 'd3', level: 1, kind: 'dare', input: 'text', where: 'remote', text: 'Envoie un vocal.' },
  { id: 'm1', level: 1, kind: 'mirror', input: 'scale', where: 'any', text: 'Ton énergie ?', scale: { min: 1, max: 10, minLabel: 'a', maxLabel: 'b' } },
  { id: 'm2', level: 2, kind: 'mirror', input: 'draw', where: 'any', text: 'Dessine.' },
  { id: 'm3', level: 3, kind: 'mirror', input: 'text', where: 'any', text: 'Un mot ?' },
];

function setup({ where = 'together', levels = [3, 2] } = {}) {
  let now = 1_000_000;
  const clock = () => now;
  const g = new Game({ id: 'g1', orientation: 'romance', where, deck, rng: () => 0, clock });
  g.addPlayer('A', { id: 'pa', name: 'Brice' });
  g.addPlayer('B', { id: 'pb', name: 'Inès' });
  g.setLevel('A', levels[0]);
  g.setLevel('B', levels[1]);
  return { g, tick: (ms) => { now += ms; } };
}

function pickKind(g, kinds) {
  const card = g.round.options.find((c) => kinds.includes(c.kind));
  assert.ok(card, `pas de carte ${kinds} dans le tirage`);
  g.pick(g.round.leader, card.id);
  return card;
}

test('le niveau de la partie est le minimum des deux curseurs, sans révéler qui', () => {
  const { g } = setup({ levels: [3, 2] });
  assert.equal(g.level, 2);
  assert.equal(g.phase, 'pick');
  const vB = g.view('B');
  assert.equal(vB.peer.levelSet, true);
  assert.equal('level' in vB.peer, false);
});

test('le tirage respecte le niveau convenu et le lieu de jeu', () => {
  const { g } = setup({ where: 'remote', levels: [1, 3] });
  assert.equal(g.level, 1);
  for (const c of g.round.options) {
    assert.ok(c.level <= 1);
    assert.notEqual(c.where, 'together');
  }
  assert.equal(g.round.options.length, 3);
});

test('seul le Meneur voit et choisit les cartes', () => {
  const { g } = setup();
  assert.equal(g.round.leader, 'A');
  assert.ok(g.view('A').round.options.length > 0);
  assert.equal(g.view('B').round.options, null);
  assert.throws(() => g.pick('B', g.round.options[0].id), GameError);
});

test("l'ardoise de l'autre reste cachée jusqu'au signal, puis tout se révèle ensemble", () => {
  const { g, tick } = setup();
  pickKind(g, ['truth', 'bet']);
  const input = g.view('A').round.input;
  const ans = input === 'scale' ? { type: 'scale', value: 7 } : input === 'choice' ? { type: 'choice', value: 0 } : { type: 'text', value: 'Un fou rire' };
  g.pose('B', ans);
  assert.equal(g.view('A').round.peerPosed, true);
  assert.equal(g.view('A').round.peerAnswer, null);
  g.pose('A', ans);
  assert.equal(g.phase, 'signal');
  assert.ok(g.round.revealAt > 0);
  // les réponses sont pré-livrées pendant le compte à rebours pour une révélation sans décalage
  assert.deepEqual(g.view('A').round.peerAnswer, g.round.answers.B);
  assert.equal(g.advance(), false);
  tick(3000);
  assert.equal(g.advance(), true);
  assert.equal(g.phase, 'reveal');
});

test('pari sur une échelle : exact +3 pour le Meneur, +2 pour la Cible qui joue', () => {
  const { g, tick } = setup({ levels: [1, 1] });
  g.round.options = [deck[1]];
  g.pick('A', 'b1');
  g.pose('B', { type: 'scale', value: 8 });
  g.pose('A', { type: 'scale', value: 8 });
  tick(3000); g.advance();
  assert.equal(g.round.auto, 'exact');
  assert.equal(g.players.A.flair, 3);
  assert.equal(g.players.B.flair, 2);
});

test('pari à ±1 : +1', () => {
  const { g, tick } = setup({ levels: [1, 1] });
  g.round.options = [deck[1]];
  g.pick('A', 'b1');
  g.pose('B', { type: 'scale', value: 8 });
  g.pose('A', { type: 'scale', value: 7 });
  tick(3000); g.advance();
  assert.equal(g.round.auto, 'close');
  assert.equal(g.players.A.flair, 1);
});

test('vérité écrite : la Cible juge, puis on peut passer au tour suivant', () => {
  const { g, tick } = setup({ levels: [1, 1] });
  g.round.options = [deck[0]];
  g.pick('A', 't1');
  g.pose('B', { type: 'text', value: '  Un   fou rire ' });
  g.pose('A', { type: 'text', value: 'Fou rire' });
  tick(3000); g.advance();
  assert.equal(g.round.answers.B.value, 'Un fou rire');
  assert.equal(g.view('B').round.canJudge, true);
  assert.equal(g.view('A').round.canJudge, false);
  assert.throws(() => g.next('A'), GameError);
  assert.throws(() => g.judge('A', 'exact'), GameError);
  g.judge('B', 'exact');
  assert.equal(g.players.A.flair, 3);
  g.next('A');
  assert.equal(g.phase, 'pick');
  assert.equal(g.round.leader, 'B');
});

test('action : la Cible relève, le Meneur avait parié juste', () => {
  const { g, tick } = setup({ levels: [1, 1] });
  g.round.options = [deck[3]];
  g.pick('A', 'd1');
  assert.equal(g.view('B').round.input, 'dare');
  g.pose('B', { type: 'choice', value: 0 });
  g.pose('A', { type: 'choice', value: 0 });
  tick(3000); g.advance();
  assert.equal(g.round.dareAccepted, true);
  assert.equal(g.players.A.flair, 3);
  assert.equal(g.players.B.flair, 2);
});

test('miroir identique : âmes jumelles, +2 chacun et complicité bonus', () => {
  const { g, tick } = setup({ levels: [1, 1] });
  g.round.options = [deck[6]];
  g.pick('A', 'm1');
  g.pose('A', { type: 'scale', value: 4 });
  g.pose('B', { type: 'scale', value: 4 });
  tick(3000); g.advance();
  assert.equal(g.round.soulmates, true);
  assert.equal(g.players.A.flair, 2);
  assert.equal(g.players.B.flair, 2);
  assert.equal(g.complicity, 2);
});

test('dessin : validation et normalisation des traits', () => {
  const { g } = setup({ levels: [2, 2] });
  g.round.options = [deck[7]];
  g.pick('A', 'm2');
  assert.throws(() => g.pose('A', { type: 'draw', strokes: [] }), GameError);
  assert.throws(() => g.pose('A', { type: 'draw', strokes: [[0.1, 'x']] }), GameError);
  g.pose('A', { type: 'draw', strokes: [[0.12345, 2, -1, 0.5]] });
  assert.deepEqual(g.round.answers.A.strokes, [[0.123, 1, 0, 0.5]]);
});

test('réponse refusée si vide, trop longue ou du mauvais type', () => {
  const { g } = setup({ levels: [1, 1] });
  g.round.options = [deck[0]];
  g.pick('A', 't1');
  assert.throws(() => g.pose('A', { type: 'text', value: '   ' }), GameError);
  assert.throws(() => g.pose('A', { type: 'text', value: 'x'.repeat(61) }), GameError);
  assert.throws(() => g.pose('A', { type: 'scale', value: 3 }), GameError);
});

test('reprendre la craie annule la réponse posée', () => {
  const { g } = setup({ levels: [1, 1] });
  g.round.options = [deck[0]];
  g.pick('A', 't1');
  g.pose('A', { type: 'text', value: 'oui' });
  g.unpose('A');
  assert.equal(g.round.posed.A, false);
  assert.equal(g.round.answers.A, null);
});

test('passer est gratuit et possible jusqu’au signal, pas après', () => {
  const { g } = setup({ levels: [1, 1] });
  g.round.options = [deck[0]];
  g.pick('A', 't1');
  g.pass('B');
  assert.equal(g.phase, 'reveal');
  assert.equal(g.round.outcome, 'passed');
  assert.equal(g.players.A.flair + g.players.B.flair, 0);
  g.next('A');
  g.round.options = [deck[0]];
  g.pick('B', 't1');
  g.pose('A', { type: 'text', value: 'a' });
  g.pose('B', { type: 'text', value: 'b' });
  assert.throws(() => g.pass('A'), GameError);
});

test('redescendre en Doux retire la carte trop intense en cours', () => {
  const { g } = setup({ levels: [3, 3] });
  g.round.options = [deck[8]];
  g.pick('A', 'm3');
  g.lower('B');
  assert.equal(g.level, 1);
  assert.equal(g.round.outcome, 'lowered');
  assert.equal(g.notice.type, 'lowered');
  g.next('A');
  for (const c of g.round.options) assert.equal(c.level, 1);
});

test('fin de partie après 10 tours, puis revanche', () => {
  const { g } = setup({ levels: [1, 1] });
  for (let i = 0; i < 10; i++) {
    g.pass('A');
    g.next('A');
  }
  assert.equal(g.phase, 'end');
  assert.equal(g.endReason, 'complete');
  g.rematch('B');
  assert.equal(g.phase, 'negotiate');
  assert.equal(g.level, null);
});

test('stop termine la partie immédiatement, sans question', () => {
  const { g } = setup();
  g.stop('B');
  assert.equal(g.phase, 'end');
  assert.equal(g.endReason, 'stopped');
});
