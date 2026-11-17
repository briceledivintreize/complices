// Moteur de jeu « Double Jeu » — logique pure, sans réseau.
// Toute réponse passe par « Montrer sa carte » : chacun écrit en secret, pose la craie,
// puis les deux ardoises se révèlent ensemble au signal du Maître.

export const LEVELS = ['Doux', 'Piquant', 'Audacieux'];

export const ORIENTATIONS = {
  romance: { label: 'Drague / couple', minAge: 18 },
  friendship: { label: 'Amitié', minAge: 16 },
  interests: { label: "Centres d'intérêt", minAge: 16 },
};

export const WHERE = { together: 'Ensemble', remote: 'À distance' };

export const RULES = {
  roundsMax: 10,
  flairGoal: 20,
  countdownMs: 3000,
  textMax: 60,
  drawMaxStrokes: 200,
  drawMaxPoints: 3000,
};

const PHASES_WITH_PEER_ANSWER = new Set(['signal', 'reveal']);

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => { throw new GameError(code, message); };

export function otherSeat(seat) { return seat === 'A' ? 'B' : 'A'; }

/** Type de saisie réellement présenté sur l'ardoise pour une carte. */
export function inputOf(card) {
  return card.kind === 'dare' ? 'dare' : card.input;
}

export class Game {
  /**
   * @param {object} o
   * @param {string} o.id
   * @param {'romance'|'friendship'|'interests'} o.orientation
   * @param {'together'|'remote'} o.where
   * @param {Array} o.deck  cartes de l'orientation
   * @param {() => number} [o.rng]
   * @param {() => number} [o.clock]
   */
  constructor({ id, orientation, where, deck, rng = Math.random, clock = Date.now }) {
    if (!ORIENTATIONS[orientation]) fail('bad_orientation', 'Orientation inconnue.');
    if (!WHERE[where]) fail('bad_where', 'Lieu de jeu inconnu.');
    this.id = id;
    this.orientation = orientation;
    this.where = where;
    this.deck = deck.filter((c) => c.where === 'any' || c.where === where);
    this.rng = rng;
    this.clock = clock;
    this.players = { A: null, B: null };
    this.phase = 'lobby';
    this.level = null;
    this.round = null;
    this.roundNo = 0;
    this.leader = 'A';
    this.complicity = 0;
    this.soulmates = 0;
    this.used = new Set();
    this.endReason = null;
    this.notice = null;
    this.noticeSeq = 0;
    this.version = 0;
    this.updatedAt = clock();
  }

  // ---------- joueurs ----------

  addPlayer(seat, { id, name }) {
    if (this.players[seat]) fail('seat_taken', 'Cette place est déjà prise.');
    this.players[seat] = { id, name, connected: false, level: null, flair: 0 };
    if (this.players.A && this.players.B && this.phase === 'lobby') {
      this.phase = 'negotiate';
      this.notify('joined');
    }
    this.touch();
  }

  seatOf(playerId) {
    if (this.players.A?.id === playerId) return 'A';
    if (this.players.B?.id === playerId) return 'B';
    return null;
  }

  setConnected(seat, connected) {
    if (!this.players[seat]) return;
    this.players[seat].connected = connected;
    this.touch();
  }

  // ---------- actions ----------

  setLevel(seat, level) {
    this.expectPhase('negotiate');
    if (![1, 2, 3].includes(level)) fail('bad_level', 'Niveau inconnu.');
    this.players[seat].level = level;
    const { A, B } = this.players;
    if (A.level && B.level) {
      this.level = Math.min(A.level, B.level);
      this.notify('level_agreed');
      this.startRound();
    }
    this.touch();
  }

  pick(seat, cardId) {
    this.expectPhase('pick');
    const r = this.round;
    if (seat !== r.leader) fail('not_leader', "C'est au Meneur de choisir la carte.");
    const card = r.options.find((c) => c.id === cardId);
    if (!card) fail('bad_card', 'Cette carte ne fait pas partie du tirage.');
    r.card = card;
    r.options = [];
    this.used.add(card.id);
    this.phase = 'write';
    this.touch();
  }

  pose(seat, answer) {
    this.expectPhase('write');
    const r = this.round;
    r.answers[seat] = this.validateAnswer(r.card, answer);
    r.posed[seat] = true;
    if (r.posed.A && r.posed.B) {
      this.phase = 'signal';
      r.revealAt = this.clock() + RULES.countdownMs;
    }
    this.touch();
  }

  unpose(seat) {
    this.expectPhase('write');
    this.round.posed[seat] = false;
    this.round.answers[seat] = null;
    this.touch();
  }

  /** Passer : gratuit, illimité, possible jusqu'au signal. Personne ne sait qui a passé. */
  pass(seat) {
    if (!['pick', 'write'].includes(this.phase)) fail('too_late', 'Le signal est déjà donné.');
    this.closeAsPassed('passed');
    this.touch();
  }

  /** Appelé par le serveur quand l'heure du signal est atteinte. Retourne true si l'état change. */
  advance(now = this.clock()) {
    if (this.phase !== 'signal' || now < this.round.revealAt) return false;
    this.phase = 'reveal';
    this.score();
    this.touch();
    return true;
  }

  /** La Cible juge une réponse écrite ou dessinée : 'exact' | 'close' | 'miss'. */
  judge(seat, verdict) {
    this.expectPhase('reveal');
    const r = this.round;
    if (!r.needsJudge || r.verdict) fail('no_judge', "Il n'y a rien à juger.");
    if (seat !== r.target) fail('not_target', "C'est à la Cible de juger.");
    if (!['exact', 'close', 'miss'].includes(verdict)) fail('bad_verdict', 'Verdict inconnu.');
    r.verdict = verdict;
    if (r.card.kind === 'mirror') {
      const pts = verdict === 'exact' ? 2 : verdict === 'close' ? 1 : 0;
      this.give('A', pts); this.give('B', pts);
      if (verdict === 'exact') { r.soulmates = true; this.complicity += 1; this.soulmates += 1; }
    } else {
      this.give(r.leader, verdict === 'exact' ? 3 : verdict === 'close' ? 1 : 0);
    }
    this.touch();
  }

  next(seat) {
    this.expectPhase('reveal');
    const r = this.round;
    if (r.needsJudge && !r.verdict) fail('wait_judge', 'La Cible doit d’abord juger la réponse.');
    const maxFlair = Math.max(this.players.A.flair, this.players.B.flair);
    if (this.roundNo >= RULES.roundsMax || maxFlair >= RULES.flairGoal) {
      this.phase = 'end';
      this.endReason = 'complete';
    } else {
      this.leader = otherSeat(this.leader);
      this.startRound();
    }
    this.touch();
  }

  /** Redescendre en Doux : immédiat, anonyme. Une carte en cours plus intense disparaît. */
  lower(seat) {
    if (!['pick', 'write', 'signal', 'reveal'].includes(this.phase)) fail('bad_phase', 'Pas de partie en cours.');
    if (this.level === 1) return;
    this.level = 1;
    this.notify('lowered');
    const r = this.round;
    if (this.phase === 'pick') {
      r.options = this.drawOptions();
    } else if (['write', 'signal'].includes(this.phase) && r.card.level > 1) {
      this.closeAsPassed('lowered');
    }
    this.touch();
  }

  stop(seat) {
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.endReason = 'stopped';
    this.touch();
  }

  rematch(seat) {
    this.expectPhase('end');
    if (!this.players.A || !this.players.B) fail('alone', 'Il faut être deux.');
    for (const s of ['A', 'B']) { this.players[s].level = null; this.players[s].flair = 0; }
    this.level = null;
    this.round = null;
    this.roundNo = 0;
    this.leader = this.leader === 'A' ? 'B' : 'A';
    this.endReason = null;
    this.phase = 'negotiate';
    this.touch();
  }

  // ---------- interne ----------

  expectPhase(phase) {
    if (this.phase !== phase) fail('bad_phase', 'Action impossible à ce moment de la partie.');
  }

  touch() { this.version += 1; this.updatedAt = this.clock(); }

  notify(type) { this.notice = { id: ++this.noticeSeq, type }; }

  give(seat, pts) { if (pts) this.players[seat].flair += pts; }

  startRound() {
    this.roundNo += 1;
    const leader = this.leader;
    this.round = {
      n: this.roundNo,
      leader,
      target: otherSeat(leader),
      options: [],
      card: null,
      answers: { A: null, B: null },
      posed: { A: false, B: false },
      revealAt: null,
      outcome: null,
      needsJudge: false,
      verdict: null,
      auto: null,
      soulmates: false,
      dareAccepted: null,
    };
    this.round.options = this.drawOptions();
    this.phase = 'pick';
  }

  /** Tire 3 cartes : une Vérité ou un Pari, une Action, un Miroir, au niveau convenu ou en dessous. */
  drawOptions() {
    const groups = [['truth', 'bet'], ['dare'], ['mirror']];
    const options = [];
    for (const kinds of groups) {
      const card = this.drawOne(kinds, options);
      if (card) options.push(card);
    }
    return options;
  }

  drawOne(kinds, taken) {
    const ok = (c) => kinds.includes(c.kind) && c.level <= this.level && !taken.includes(c);
    let pool = this.deck.filter((c) => ok(c) && !this.used.has(c.id));
    if (!pool.length) pool = this.deck.filter(ok); // pioche épuisée : on recycle
    if (!pool.length) return null;
    const atLevel = pool.filter((c) => c.level === this.level);
    const source = atLevel.length && this.rng() < 0.7 ? atLevel : pool;
    return source[Math.floor(this.rng() * source.length)];
  }

  closeAsPassed(reason) {
    const r = this.round;
    r.outcome = reason; // 'passed' | 'lowered'
    r.answers = { A: null, B: null };
    r.revealAt = null;
    this.phase = 'reveal';
  }

  validateAnswer(card, answer) {
    if (!answer || typeof answer !== 'object') fail('bad_answer', 'Réponse vide.');
    const input = inputOf(card);
    if (answer.type !== (input === 'dare' ? 'choice' : input)) fail('bad_answer', 'Type de réponse inattendu.');
    switch (input) {
      case 'text': {
        const v = typeof answer.value === 'string' ? answer.value.replace(/\s+/g, ' ').trim() : '';
        if (!v) fail('empty', 'Ton ardoise est vide.');
        if (v.length > RULES.textMax) fail('too_long', `${RULES.textMax} caractères maximum.`);
        return { type: 'text', value: v };
      }
      case 'scale': {
        const { min = 1, max = 10 } = card.scale || {};
        const v = answer.value;
        if (!Number.isInteger(v) || v < min || v > max) fail('bad_answer', 'Chiffre hors échelle.');
        return { type: 'scale', value: v };
      }
      case 'choice':
      case 'dare': {
        const n = input === 'dare' ? 2 : card.choices.length;
        const v = answer.value;
        if (!Number.isInteger(v) || v < 0 || v >= n) fail('bad_answer', 'Choix inconnu.');
        return { type: 'choice', value: v };
      }
      case 'draw': {
        const strokes = answer.strokes;
        if (!Array.isArray(strokes) || !strokes.length) fail('empty', 'Ton ardoise est vide.');
        if (strokes.length > RULES.drawMaxStrokes) fail('too_long', 'Dessin trop chargé.');
        let points = 0;
        const clean = strokes.map((s) => {
          if (!Array.isArray(s) || s.length < 2 || s.length % 2) fail('bad_answer', 'Trait invalide.');
          points += s.length / 2;
          return s.map((x) => {
            if (typeof x !== 'number' || !Number.isFinite(x)) fail('bad_answer', 'Trait invalide.');
            return Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000;
          });
        });
        if (points > RULES.drawMaxPoints) fail('too_long', 'Dessin trop chargé.');
        return { type: 'draw', strokes: clean };
      }
      default:
        fail('bad_card', 'Carte invalide.');
    }
  }

  /** Calcule le résultat au moment de la révélation. */
  score() {
    const r = this.round;
    const { card, leader, target } = r;
    const a = r.answers;
    const input = inputOf(card);
    r.outcome = 'played';

    if (card.kind === 'dare') {
      const decision = a[target].value; // 0 = je relève, 1 = je passe
      r.dareAccepted = decision === 0;
      r.auto = a[leader].value === decision ? 'exact' : 'miss';
      if (r.auto === 'exact') this.give(leader, 3);
      if (r.dareAccepted) { this.give(target, 2); this.complicity += 1; }
      return;
    }

    this.complicity += 1;

    if (card.kind === 'mirror') {
      if (input === 'scale' || input === 'choice') {
        const d = Math.abs(a.A.value - a.B.value);
        r.auto = d === 0 ? 'exact' : (input === 'scale' && d === 1) ? 'close' : 'miss';
        const pts = r.auto === 'exact' ? 2 : r.auto === 'close' ? 1 : 0;
        this.give('A', pts); this.give('B', pts);
        if (r.auto === 'exact') { r.soulmates = true; this.complicity += 1; this.soulmates += 1; }
      } else {
        r.needsJudge = true;
      }
      return;
    }

    // truth / bet : la Cible a répondu pour de vrai, le Meneur a parié.
    this.give(target, 2);
    if (input === 'scale' || input === 'choice') {
      const d = Math.abs(a[leader].value - a[target].value);
      r.auto = d === 0 ? 'exact' : (input === 'scale' && d === 1) ? 'close' : 'miss';
      this.give(leader, r.auto === 'exact' ? 3 : r.auto === 'close' ? 1 : 0);
    } else {
      r.needsJudge = true;
    }
  }

  // ---------- vue par joueur ----------

  /** Ce que voit un joueur : jamais la réponse ni le niveau secret de l'autre avant le signal. */
  view(seat) {
    const me = this.players[seat];
    const peerSeat = otherSeat(seat);
    const peer = this.players[peerSeat];
    const r = this.round;
    let round = null;
    if (r) {
      const showPeer = PHASES_WITH_PEER_ANSWER.has(this.phase) && !['passed', 'lowered'].includes(r.outcome);
      round = {
        n: r.n,
        role: seat === r.leader ? 'leader' : 'target',
        options: this.phase === 'pick' && seat === r.leader ? r.options : null,
        card: r.card,
        input: r.card ? inputOf(r.card) : null,
        myPosed: r.posed[seat],
        peerPosed: r.posed[peerSeat],
        myAnswer: r.answers[seat],
        peerAnswer: showPeer ? r.answers[peerSeat] : null,
        revealAt: r.revealAt,
        outcome: r.outcome,
        needsJudge: r.needsJudge,
        verdict: r.verdict,
        auto: r.auto,
        canJudge: this.phase === 'reveal' && r.needsJudge && !r.verdict && seat === r.target,
        soulmates: r.soulmates,
        dareAccepted: r.dareAccepted,
      };
    }
    return {
      id: this.id,
      version: this.version,
      serverNow: this.clock(),
      orientation: this.orientation,
      orientationLabel: ORIENTATIONS[this.orientation].label,
      where: this.where,
      phase: this.phase,
      level: this.level,
      levelLabel: this.level ? LEVELS[this.level - 1] : null,
      rules: { roundsMax: RULES.roundsMax, flairGoal: RULES.flairGoal, countdownMs: RULES.countdownMs },
      roundNo: this.roundNo,
      complicity: this.complicity,
      soulmates: this.soulmates,
      you: me ? { seat, name: me.name, flair: me.flair, myLevel: me.level } : null,
      peer: peer ? { name: peer.name, connected: peer.connected, flair: peer.flair, levelSet: peer.level !== null } : null,
      round,
      endReason: this.endReason,
      notice: this.notice,
    };
  }
}
