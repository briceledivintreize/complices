// Moteur de jeu « Double Jeu » — logique pure, sans réseau.
// Toute réponse passe par « Montrer sa carte » : chacun écrit en secret, pose la craie,
// puis toutes les ardoises se révèlent ensemble au signal du Maître.
// Deux modes : duo (2 joueurs) et groupe (2 à 8 joueurs, lancé par l'hôte).

export const LEVELS = ['Doux', 'Piquant', 'Audacieux'];

export const ORIENTATIONS = {
  romance: { label: 'Drague / couple', minAge: 18, group: false },
  friendship: { label: 'Amitié', minAge: 16, group: true },
  interests: { label: "Centres d'intérêt", minAge: 16, group: true },
};

export const WHERE = { together: 'Ensemble', remote: 'À distance' };
export const SEATS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
export const MAX_GROUP = SEATS.length;

export const RULES = {
  flairGoal: 20,
  countdownMs: 3000,
  textMax: 60,
  customMin: 5,
  customMax: 140,
  drawMaxStrokes: 200,
  drawMaxPoints: 3000,
};

/** Saisies autorisées pour une question perso, selon le type de carte. */
export const CUSTOM_INPUTS = {
  truth: ['text', 'choice'],
  bet: ['scale', 'choice'],
  mirror: ['text', 'scale', 'choice', 'draw'],
  dare: ['text'],
  vote: ['player'],
};

const PREDICTION_KINDS = new Set(['truth', 'bet', 'dare']);

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => { throw new GameError(code, message); };

export function roundsFor(mode, n) {
  return mode === 'duo' ? 10 : Math.min(16, Math.max(10, 2 * n));
}

export class Game {
  /**
   * @param {object} o
   * @param {string} o.id
   * @param {'romance'|'friendship'|'interests'} o.orientation
   * @param {'together'|'remote'} o.where
   * @param {'duo'|'group'} [o.mode]
   * @param {Array} o.deck  cartes de l'orientation
   */
  constructor({ id, orientation, where, deck, mode = 'duo', rng = Math.random, clock = Date.now }) {
    if (!ORIENTATIONS[orientation]) fail('bad_orientation', 'Orientation inconnue.');
    if (!WHERE[where]) fail('bad_where', 'Lieu de jeu inconnu.');
    if (!['duo', 'group'].includes(mode)) fail('bad_mode', 'Mode de jeu inconnu.');
    if (mode === 'group' && !ORIENTATIONS[orientation].group) fail('duo_only', 'Cette orientation se joue uniquement à deux.');
    this.id = id;
    this.orientation = orientation;
    this.where = where;
    this.mode = mode;
    this.maxPlayers = mode === 'duo' ? 2 : MAX_GROUP;
    const fits = (c) => (mode === 'duo' ? c.players !== 'group' : c.players !== 'duo');
    this.deck = deck.filter((c) => (c.where === 'any' || c.where === where) && fits(c));
    this.rng = rng;
    this.clock = clock;
    this.players = {};
    this.order = [];
    this.host = null;
    this.phase = 'lobby';
    this.level = null;
    this.round = null;
    this.roundNo = 0;
    this.roundsMax = 10;
    this.leader = null;
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

  active() { return this.order.filter((s) => !this.players[s].left); }
  present() { return this.active().filter((s) => this.players[s].connected); }
  isFull() { return this.order.length >= this.maxPlayers; }

  /** Ajoute un joueur à la première place libre. Retourne sa place. */
  addPlayer({ id, name }) {
    if (this.phase !== 'lobby') fail('started', 'La partie a déjà commencé.');
    if (this.isFull()) fail('full', 'La partie est complète.');
    const seat = SEATS.find((s) => !this.players[s]);
    this.players[seat] = { id, name, connected: false, level: null, flair: 0, left: false };
    this.order.push(seat);
    if (!this.host) this.host = seat;
    if (this.order.length > 1) this.notify('joined', { seat });
    if (this.mode === 'duo' && this.order.length === 2) this.phase = 'negotiate';
    this.touch();
    return seat;
  }

  seatOf(playerId) {
    return this.order.find((s) => this.players[s].id === playerId) || null;
  }

  nameOf(seat) { return this.players[seat]?.name; }

  setConnected(seat, connected) {
    const p = this.players[seat];
    if (!p) return;
    p.connected = connected;
    if (!connected) this.checkSignal();
    this.touch();
  }

  /** Groupe : l'hôte lance la partie quand tout le monde est là. */
  start(seat) {
    this.expectPhase('lobby');
    if (this.mode !== 'group') fail('bad_mode', 'Une partie à deux démarre toute seule.');
    if (seat !== this.host) fail('not_host', "Seul l'hôte peut lancer la partie.");
    if (this.active().length < 2) fail('alone', 'Il faut au moins deux joueurs.');
    this.phase = 'negotiate';
    this.notify('started');
    this.touch();
  }

  /** Quitter une partie de groupe. En duo, quitter revient à arrêter. */
  leave(seat) {
    if (this.mode === 'duo') return this.stop(seat);
    const p = this.players[seat];
    if (!p || p.left) return;
    if (this.phase === 'lobby') {
      delete this.players[seat];
      this.order = this.order.filter((s) => s !== seat);
      if (this.host === seat) this.host = this.order[0] || null;
      this.touch();
      return;
    }
    p.left = true;
    p.connected = false;
    this.notify('left', { seat });
    if (this.host === seat) this.host = this.active()[0] || null;
    if (this.phase !== 'end' && this.active().length < 2) {
      this.phase = 'end';
      this.endReason = 'alone';
    } else if (this.phase === 'negotiate') {
      this.checkLevels();
    } else if (this.round && ['pick', 'write', 'signal'].includes(this.phase)) {
      const r = this.round;
      if (seat === r.leader || (seat === r.target && r.card && PREDICTION_KINDS.has(r.card.kind))) this.closeAsPassed('passed');
      else if (this.phase === 'pick' && seat === r.target) r.target = this.nextAfter(r.leader);
      else if (this.phase === 'write') this.checkSignal();
    }
    this.touch();
  }

  // ---------- actions ----------

  setLevel(seat, level) {
    this.expectPhase('negotiate');
    if (![1, 2, 3].includes(level)) fail('bad_level', 'Niveau inconnu.');
    this.players[seat].level = level;
    this.checkLevels();
    this.touch();
  }

  checkLevels() {
    const act = this.active();
    if (act.length >= 2 && act.every((s) => this.players[s].level)) {
      this.level = Math.min(...act.map((s) => this.players[s].level));
      this.roundsMax = roundsFor(this.mode, act.length);
      this.notify('level_agreed');
      this.leader = this.leader && !this.players[this.leader].left ? this.leader : null;
      this.startRound();
    }
  }

  /** Le Meneur choisit une carte du tirage (et, en groupe, la Cible). */
  pick(seat, cardId, target) {
    this.expectPhase('pick');
    const r = this.round;
    if (seat !== r.leader) fail('not_leader', "C'est au Meneur de choisir la carte.");
    const card = r.options.find((c) => c.id === cardId);
    if (!card) fail('bad_card', 'Cette carte ne fait pas partie du tirage.');
    this.setTarget(target);
    r.card = card;
    r.options = [];
    this.used.add(card.id);
    this.phase = 'write';
    this.touch();
  }

  /**
   * Le Meneur écrit sa propre question. Retourne la carte normalisée
   * (le serveur peut la proposer à la banque de questions si le Meneur l'a accepté).
   */
  pickCustom(seat, spec, target) {
    this.expectPhase('pick');
    const r = this.round;
    if (seat !== r.leader) fail('not_leader', "C'est au Meneur de choisir la carte.");
    const card = this.normalizeCustom(spec);
    this.setTarget(target);
    r.card = card;
    r.options = [];
    this.phase = 'write';
    this.touch();
    return card;
  }

  normalizeCustom(spec) {
    if (!spec || typeof spec !== 'object') fail('bad_custom', 'Question invalide.');
    const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max + 1);
    const text = clean(spec.text, RULES.customMax);
    if (text.length < RULES.customMin) fail('bad_custom', 'Ta question est trop courte.');
    if (text.length > RULES.customMax) fail('bad_custom', `${RULES.customMax} caractères maximum.`);
    const kind = spec.kind;
    if (!CUSTOM_INPUTS[kind]) fail('bad_custom', 'Type de carte inconnu.');
    if (kind === 'vote' && this.mode !== 'group') fail('bad_custom', 'Les votes se jouent en groupe.');
    const input = kind === 'dare' ? 'text' : kind === 'vote' ? 'player' : spec.input;
    if (!CUSTOM_INPUTS[kind].includes(input)) fail('bad_custom', 'Type de réponse incompatible avec cette carte.');
    const card = { id: `custom-${this.roundNo}`, level: this.level, kind, input, where: 'any', players: 'any', text, custom: true, author: this.nameOf(this.round.leader) };
    if (input === 'choice') {
      const choices = Array.isArray(spec.choices) ? spec.choices.map((c) => clean(c, 24)).filter(Boolean) : [];
      if (choices.length < 2 || choices.length > 4) fail('bad_custom', 'Propose de 2 à 4 choix.');
      if (choices.some((c) => c.length > 24)) fail('bad_custom', '24 caractères maximum par choix.');
      if (new Set(choices.map((c) => c.toLowerCase())).size !== choices.length) fail('bad_custom', 'Deux choix sont identiques.');
      card.choices = choices;
    }
    if (input === 'scale') {
      card.scale = {
        min: 1, max: 10,
        minLabel: clean(spec.scale?.minLabel, 20).slice(0, 20) || 'Pas du tout',
        maxLabel: clean(spec.scale?.maxLabel, 20).slice(0, 20) || 'Énormément',
      };
    }
    return card;
  }

  setTarget(target) {
    const r = this.round;
    if (target === undefined || target === null || this.mode === 'duo') return;
    if (!this.players[target] || this.players[target].left || target === r.leader) fail('bad_target', 'Cible invalide.');
    r.target = target;
  }

  pose(seat, answer) {
    this.expectPhase('write');
    this.expectActive(seat);
    const r = this.round;
    r.answers[seat] = this.validateAnswer(r.card, answer, seat);
    r.posed[seat] = true;
    this.checkSignal();
    this.touch();
  }

  unpose(seat) {
    this.expectPhase('write');
    this.round.posed[seat] = false;
    this.round.answers[seat] = null;
    this.touch();
  }

  /**
   * Passer : gratuit, illimité, possible jusqu'au signal, personne ne sait qui.
   * En duo, la carte est passée. En groupe, la Cible passe la carte ; les autres s'abstiennent.
   */
  pass(seat) {
    if (!['pick', 'write'].includes(this.phase)) fail('too_late', 'Le signal est déjà donné.');
    this.expectActive(seat);
    const r = this.round;
    const wholeCard = this.mode === 'duo'
      || this.phase === 'pick'
      || (seat === r.target && PREDICTION_KINDS.has(r.card.kind));
    if (wholeCard) {
      this.closeAsPassed('passed');
    } else {
      r.answers[seat] = { type: 'skip' };
      r.posed[seat] = true;
      this.checkSignal();
    }
    this.touch();
  }

  /** Le signal part quand chaque joueur présent a posé sa craie. */
  checkSignal() {
    if (this.phase !== 'write') return;
    const r = this.round;
    const here = this.present();
    const posed = this.active().filter((s) => r.posed[s]);
    if (here.length && here.every((s) => r.posed[s]) && posed.length >= 2) {
      this.phase = 'signal';
      r.revealAt = this.clock() + RULES.countdownMs;
    }
  }

  /** Appelé par le serveur quand l'heure du signal est atteinte. Retourne true si l'état change. */
  advance(now = this.clock()) {
    if (this.phase !== 'signal' || now < this.round.revealAt) return false;
    this.phase = 'reveal';
    this.score();
    this.touch();
    return true;
  }

  /**
   * La Cible juge les réponses écrites ou dessinées : { place: 'exact' | 'close' | 'miss' }.
   * En duo, un seul verdict ; pour un Miroir, il s'applique aux deux joueurs.
   */
  judge(seat, verdicts) {
    this.expectPhase('reveal');
    const r = this.round;
    if (!r.needsJudge || r.judged) fail('no_judge', "Il n'y a rien à juger.");
    if (seat !== r.target) fail('not_target', "C'est à la Cible de juger.");
    if (!verdicts || typeof verdicts !== 'object') fail('bad_verdict', 'Verdict manquant.');
    const ok = (v) => ['exact', 'close', 'miss'].includes(v);
    const pts = { exact: 3, close: 1, miss: 0 };
    if (r.card.kind === 'mirror') {
      const v = verdicts[r.judgeable[0]];
      if (!ok(v)) fail('bad_verdict', 'Verdict inconnu.');
      const p = { exact: 2, close: 1, miss: 0 }[v];
      for (const s of [r.target, ...r.judgeable]) this.gain(s, p);
      r.auto = Object.fromEntries([r.target, ...r.judgeable].map((s) => [s, v]));
      if (v === 'exact') { r.soulmates = [r.target, ...r.judgeable]; this.complicity += 1; this.soulmates += 1; }
    } else {
      for (const s of r.judgeable) if (!ok(verdicts[s])) fail('bad_verdict', 'Juge chaque ardoise.');
      for (const s of r.judgeable) { r.auto[s] = verdicts[s]; this.gain(s, pts[verdicts[s]]); }
    }
    r.judged = true;
    this.touch();
  }

  next(seat) {
    this.expectPhase('reveal');
    this.expectActive(seat);
    const r = this.round;
    if (r.needsJudge && !r.judged) fail('wait_judge', 'La Cible doit d’abord juger les ardoises.');
    const maxFlair = Math.max(...this.active().map((s) => this.players[s].flair));
    if (this.roundNo >= this.roundsMax || maxFlair >= RULES.flairGoal) {
      this.phase = 'end';
      this.endReason = 'complete';
    } else {
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

  /** En duo, n'importe qui arrête. En groupe, l'hôte arrête pour tous ; les autres quittent. */
  stop(seat) {
    if (this.phase === 'end') return;
    if (this.mode === 'group' && seat !== this.host) return this.leave(seat);
    this.phase = 'end';
    this.endReason = 'stopped';
    this.touch();
  }

  rematch(seat) {
    this.expectPhase('end');
    this.expectActive(seat);
    if (this.active().length < 2) fail('alone', 'Il faut être au moins deux.');
    for (const s of this.active()) { this.players[s].level = null; this.players[s].flair = 0; }
    this.level = null;
    this.round = null;
    this.roundNo = 0;
    this.endReason = null;
    this.phase = 'negotiate';
    this.touch();
  }

  // ---------- interne ----------

  expectPhase(phase) {
    if (this.phase !== phase) fail('bad_phase', 'Action impossible à ce moment de la partie.');
  }

  expectActive(seat) {
    if (!this.players[seat] || this.players[seat].left) fail('not_player', "Tu ne fais plus partie de cette partie.");
  }

  touch() { this.version += 1; this.updatedAt = this.clock(); }

  notify(type, extra = {}) { this.notice = { id: ++this.noticeSeq, type, ...extra }; }

  gain(seat, pts) {
    if (!pts) return;
    this.round.gains[seat] = (this.round.gains[seat] || 0) + pts;
    this.players[seat].flair += pts;
  }

  nextAfter(seat) {
    const act = this.active();
    if (!act.length) return null;
    const i = seat ? this.order.indexOf(seat) : -1;
    for (let k = 1; k <= this.order.length; k++) {
      const s = this.order[(i + k) % this.order.length];
      if (s !== seat && act.includes(s)) return s;
    }
    return act[0];
  }

  startRound() {
    this.roundNo += 1;
    this.leader = this.leader ? this.nextAfter(this.leader) : this.active()[0];
    const leader = this.leader;
    this.round = {
      n: this.roundNo,
      leader,
      target: this.nextAfter(leader),
      options: [],
      card: null,
      answers: {},
      posed: {},
      revealAt: null,
      outcome: null,
      needsJudge: false,
      judged: false,
      judgeable: [],
      auto: {},
      gains: {},
      soulmates: [],
      dareAccepted: null,
      vote: null,
    };
    this.round.options = this.drawOptions();
    this.phase = 'pick';
  }

  /** Tire 3 cartes : une Vérité ou un Pari, une Action, un Miroir (ou un Vote en groupe). */
  drawOptions() {
    const third = this.mode === 'group' && this.rng() < 0.5 ? ['vote', 'mirror'] : ['mirror'];
    const groups = [['truth', 'bet'], ['dare'], third];
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
    r.answers = {};
    r.revealAt = null;
    this.phase = 'reveal';
  }

  /** Type de saisie présenté sur l'ardoise d'un joueur pour une carte. */
  inputFor(card) {
    if (card.kind === 'dare') return 'dare';
    if (card.kind === 'vote') return 'player';
    return card.input;
  }

  validateAnswer(card, answer, seat) {
    if (!answer || typeof answer !== 'object') fail('bad_answer', 'Réponse vide.');
    const input = this.inputFor(card);
    const expected = input === 'dare' ? 'choice' : input;
    if (answer.type !== expected) fail('bad_answer', 'Type de réponse inattendu.');
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
      case 'player': {
        const v = answer.value;
        if (!this.players[v] || this.players[v].left) fail('bad_answer', 'Ce joueur ne fait pas partie de la partie.');
        return { type: 'player', value: v };
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
    const { card, target } = r;
    const input = this.inputFor(card);
    const given = (s) => r.answers[s] && r.answers[s].type !== 'skip';
    const answered = this.active().filter(given);
    r.outcome = 'played';

    if (PREDICTION_KINDS.has(card.kind) && !given(target)) { r.outcome = 'absent'; return; }
    const predictors = answered.filter((s) => s !== target);

    if (card.kind === 'dare') {
      const decision = r.answers[target].value; // 0 = je relève, 1 = je passe
      r.dareAccepted = decision === 0;
      for (const s of predictors) {
        r.auto[s] = r.answers[s].value === decision ? 'exact' : 'miss';
        if (r.auto[s] === 'exact') this.gain(s, 3);
      }
      if (r.dareAccepted) { this.gain(target, 2); this.complicity += 1; }
      return;
    }

    this.complicity += 1;

    if (card.kind === 'vote') {
      const counts = {};
      for (const s of answered) counts[r.answers[s].value] = (counts[r.answers[s].value] || 0) + 1;
      const top = Math.max(0, ...Object.values(counts));
      const winners = Object.keys(counts).filter((k) => counts[k] === top);
      r.vote = { counts, winners };
      for (const s of answered) if (winners.includes(r.answers[s].value)) { r.auto[s] = 'exact'; this.gain(s, 1); }
      return;
    }

    if (card.kind === 'mirror') {
      if (input === 'scale' || input === 'choice') {
        for (const s of answered) {
          const others = answered.filter((o) => o !== s).map((o) => r.answers[o].value);
          const v = r.answers[s].value;
          if (others.includes(v)) { r.auto[s] = 'exact'; this.gain(s, 2); r.soulmates.push(s); }
          else if (input === 'scale' && others.some((o) => Math.abs(o - v) === 1)) { r.auto[s] = 'close'; this.gain(s, 1); }
          else r.auto[s] = 'miss';
        }
        if (r.soulmates.length) { this.complicity += 1; this.soulmates += 1; }
      } else if (this.mode === 'duo' && answered.length === 2 && given(target)) {
        r.needsJudge = true;
        r.judgeable = answered.filter((s) => s !== target);
      } else {
        for (const s of answered) this.gain(s, 1); // en groupe : on compare et on en parle
      }
      return;
    }

    // truth / bet : la Cible a répondu pour de vrai, les autres ont parié.
    this.gain(target, 2);
    if (input === 'scale' || input === 'choice') {
      const truth = r.answers[target].value;
      for (const s of predictors) {
        const d = Math.abs(r.answers[s].value - truth);
        r.auto[s] = d === 0 ? 'exact' : (input === 'scale' && d === 1) ? 'close' : 'miss';
        this.gain(s, r.auto[s] === 'exact' ? 3 : r.auto[s] === 'close' ? 1 : 0);
      }
    } else if (predictors.length) {
      r.needsJudge = true;
      r.judgeable = predictors;
    }
  }

  // ---------- vue par joueur ----------

  /** Ce que voit un joueur : jamais les réponses ni les niveaux secrets des autres avant le signal. */
  view(seat) {
    const me = this.players[seat];
    const r = this.round;
    const reveal = r && ['signal', 'reveal'].includes(this.phase) && r.outcome !== 'passed' && r.outcome !== 'lowered';
    let round = null;
    if (r) {
      const role = seat === r.leader ? 'leader' : seat === r.target ? 'target' : 'player';
      round = {
        n: r.n,
        leader: r.leader,
        target: r.target,
        role,
        options: this.phase === 'pick' && seat === r.leader ? r.options : null,
        card: r.card,
        input: r.card ? this.inputFor(r.card) : null,
        myPosed: Boolean(r.posed[seat]),
        myAnswer: r.answers[seat] || null,
        posed: Object.fromEntries(this.order.map((s) => [s, Boolean(r.posed[s])])),
        answers: reveal ? Object.fromEntries(this.order.filter((s) => s !== seat && r.answers[s]).map((s) => [s, r.answers[s]])) : null,
        revealAt: r.revealAt,
        outcome: r.outcome,
        needsJudge: r.needsJudge,
        judged: r.judged,
        judgeable: r.judgeable,
        canJudge: this.phase === 'reveal' && r.needsJudge && !r.judged && seat === r.target,
        auto: r.auto,
        gains: r.gains,
        soulmates: r.soulmates,
        dareAccepted: r.dareAccepted,
        vote: r.vote,
      };
    }
    return {
      id: this.id,
      version: this.version,
      serverNow: this.clock(),
      mode: this.mode,
      maxPlayers: this.maxPlayers,
      orientation: this.orientation,
      orientationLabel: ORIENTATIONS[this.orientation].label,
      where: this.where,
      phase: this.phase,
      level: this.level,
      levelLabel: this.level ? LEVELS[this.level - 1] : null,
      rules: { roundsMax: this.roundsMax, flairGoal: RULES.flairGoal, countdownMs: RULES.countdownMs },
      roundNo: this.roundNo,
      complicity: this.complicity,
      soulmates: this.soulmates,
      host: this.host,
      you: me ? { seat, name: me.name, flair: me.flair, myLevel: me.level, left: me.left } : null,
      players: this.order.map((s) => {
        const p = this.players[s];
        return { seat: s, name: p.name, connected: p.connected, left: p.left, flair: p.flair, levelSet: p.level !== null };
      }),
      round,
      endReason: this.endReason,
      notice: this.notice,
    };
  }
}
