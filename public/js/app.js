// Complices : écrans de l'application (accueil, invitation, partie à deux ou en groupe).

import { h, scribble, setScribble } from './dom.js';
import { Net } from './net.js';
import * as sound from './sound.js';
import { createInput, renderAnswer, labelsFor, KIND_LABEL, LEVELS } from './slate.js';

const app = document.getElementById('app');

// sessionStorage d'abord : plusieurs onglets du même navigateur peuvent jouer sans se mélanger.
// localStorage en secours : on retrouve sa partie après avoir fermé l'onglet.
const store = {
  get(k) {
    for (const s of ['sessionStorage', 'localStorage']) {
      try { const v = window[s].getItem(`complices:${k}`); if (v !== null) return JSON.parse(v); } catch { /* stockage indisponible */ }
    }
    return null;
  },
  set(k, v) {
    for (const s of ['sessionStorage', 'localStorage']) {
      try { window[s].setItem(`complices:${k}`, JSON.stringify(v)); } catch { /* stockage indisponible */ }
    }
  },
};

const ORIENTATIONS = [
  { id: 'romance', label: 'Drague / couple', desc: 'Séduction, tendresse, frissons. Jamais explicite.', age: 18, group: false },
  { id: 'friendship', label: 'Amitié', desc: 'Fous rires, souvenirs et mauvaise foi assumée.', age: 16, group: true },
  { id: 'interests', label: "Centres d'intérêt", desc: 'Goûts, valeurs, rêves : pour se découvrir.', age: 16, group: true },
];
const LEVEL_DESC = {
  romance: ['Tendresse et complicité', 'Ça chauffe un peu', 'Frissons, jamais explicite'],
  friendship: ['Fous rires garantis', 'Mauvaise foi assumée', "Ce qu'on ne se dit jamais"],
  interests: ['Tes goûts', 'Tes opinions', 'Tes rêves et tes peurs'],
};
const REACTIONS = ['😂', '😳', '❤️', '🤯', '🔥', '👏'];
const CUSTOM_KINDS = [
  { id: 'truth', label: 'Vérité', desc: 'La Cible répond, les autres parient', inputs: ['text', 'choice'] },
  { id: 'bet', label: 'Pari', desc: 'Réponse mesurable, points automatiques', inputs: ['scale', 'choice'] },
  { id: 'mirror', label: 'Miroir', desc: 'Tout le monde répond pour soi', inputs: ['text', 'scale', 'choice', 'draw'] },
  { id: 'dare', label: 'Action', desc: 'La Cible relève le défi ou passe', inputs: ['text'] },
  { id: 'vote', label: 'Vote', desc: 'Chacun désigne un joueur', inputs: ['player'], group: true },
];
const INPUT_LABEL = { text: 'Réponse écrite', choice: 'Choix', scale: 'Échelle de 1 à 10', draw: 'Dessin', player: 'Un joueur' };

// Élision : « l'ardoise d'Inès », « ce qu'Inès va répondre ».
const VOWEL = /^[aeiouyhàâäéèêëîïôöûüœ]/i;
const de = (name) => (VOWEL.test(name) ? `d'${name}` : `de ${name}`);
const que = (name) => (VOWEL.test(name) ? `qu'${name}` : `que ${name}`);
const listNames = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`);

// ---------- navigation ----------

let current = null;
export function go(path) { history.pushState({}, '', path); route(); }
window.addEventListener('popstate', route);
document.addEventListener('pointerdown', () => sound.unlock(), { once: true });

function route() {
  if (current && current.destroy) current.destroy();
  current = null;
  app.replaceChildren();
  window.scrollTo(0, 0);
  const p = location.pathname;
  let m;
  if ((m = p.match(/^\/j\/([A-Za-z0-9-]+)/))) current = joinScreen(m[1]);
  else if ((m = p.match(/^\/g\/([A-Za-z0-9-]+)/))) current = gameScreen(m[1]);
  else current = homeScreen();
}

async function api(path, body) {
  const opts = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
  let r;
  try { r = await fetch(path, opts); } catch { throw new Error('Impossible de joindre le serveur. Vérifie ta connexion.'); }
  let data = {};
  try { data = await r.json(); } catch { /* réponse vide */ }
  if (!r.ok) throw new Error(data.error || 'Erreur inattendue.');
  return data;
}

let toastTimer = null;
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** Groupe de boutons à choix unique. `items` : { id, label, desc?, badge?, disabled? }. */
function optionButtons(items, selected, onPick, cls = 'opt') {
  const buttons = items.map((it) => h('button', {
    type: 'button', class: cls, id: `opt-${it.id}`, 'aria-pressed': String(it.id === selected), disabled: Boolean(it.disabled),
    onclick: (e) => { buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); onPick(it.id); sound.circle(); },
  }, it.badge ? h('span', { class: 'badge', text: it.badge }) : null, h('b', { text: it.label }), it.desc ? h('span', { text: it.desc }) : null));
  return buttons;
}

// ---------- accueil ----------

function homeScreen() {
  const state = { orientation: 'romance', where: 'remote', mode: 'duo' };
  const name = h('input', { class: 'input', id: 'name', maxlength: 20, autocomplete: 'nickname', placeholder: 'Ton pseudo', value: store.get('name') || '' });
  const ageText = h('span');
  const age = h('input', { type: 'checkbox', id: 'age' });
  const error = h('p', { class: 'error', role: 'alert' });
  const setAge = () => { ageText.textContent = `J'ai ${ORIENTATIONS.find((x) => x.id === state.orientation).age} ans ou plus.`; };

  const oriButtons = optionButtons(ORIENTATIONS.map((o) => ({ ...o, badge: `${o.age}+` })), state.orientation, (id) => { state.orientation = id; setAge(); });
  const duoNote = h('p', { class: 'small muted', hidden: true, text: 'La Drague / couple se joue uniquement à deux.' });
  const paintOrientations = () => {
    const romance = oriButtons[0];
    romance.disabled = state.mode === 'group';
    duoNote.hidden = state.mode !== 'group';
    if (state.mode === 'group' && state.orientation === 'romance') {
      state.orientation = 'friendship';
      oriButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === 1)));
      setAge();
    }
  };
  setAge();

  const create = h('button', { type: 'submit', class: 'btn primary block', id: 'create', text: 'Créer la partie' });
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { text: 'Ton pseudo' }), name),
    h('div', { class: 'field' }, h('span', { text: 'Combien de joueurs ?' }),
      h('div', { class: 'choices two' }, optionButtons([
        { id: 'duo', label: 'À deux', desc: 'En couple, entre amis, en tête-à-tête' },
        { id: 'group', label: 'En groupe', desc: "Jusqu'à 8, avec un lien à partager dans un groupe WhatsApp" },
      ], state.mode, (id) => { state.mode = id; paintOrientations(); }))),
    h('div', { class: 'field' }, h('span', { text: 'Votre jeu' }), h('div', { class: 'choices three' }, oriButtons), duoNote),
    h('div', { class: 'field' }, h('span', { text: 'Vous jouez' }),
      h('div', { class: 'choices two' }, optionButtons([
        { id: 'remote', label: 'À distance', desc: 'Chacun chez soi, en appel ou en message' },
        { id: 'together', label: 'Ensemble', desc: 'Dans la même pièce, un téléphone chacun' },
      ], state.where, (id) => { state.where = id; }))),
    h('label', { class: 'check' }, age, ageText),
    error,
    create);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    const pseudo = name.value.trim();
    if (!pseudo) { error.textContent = 'Choisis un pseudo pour que les autres te reconnaissent.'; name.focus(); return; }
    if (!age.checked) { error.textContent = `Ce jeu est réservé aux ${ORIENTATIONS.find((x) => x.id === state.orientation).age} ans et plus.`; return; }
    create.disabled = true;
    try {
      const r = await api('/api/rooms', { name: pseudo, orientation: state.orientation, where: state.where, mode: state.mode, ageOk: true });
      store.set('name', pseudo);
      store.set(`room:${r.roomId}`, { playerId: r.playerId, secret: r.secret });
      store.set(`invite:${r.roomId}`, r.invite);
      go(`/g/${r.roomId}`);
    } catch (err) {
      error.textContent = err.message;
      create.disabled = false;
    }
  });

  const codeInput = h('input', { class: 'input', id: 'code', maxlength: 9, placeholder: 'K7F3-QM9X', autocapitalize: 'characters', autocomplete: 'off', 'aria-label': "Code d'invitation" });
  const joinErr = h('p', { class: 'error' });
  const joinForm = h('form', { class: 'joincode' },
    h('span', { class: 'eyebrow', text: 'On t’a donné un code ?' }),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, codeInput), h('button', { type: 'submit', class: 'btn ghost', text: 'Rejoindre' })),
    joinErr);
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = normalizeCode(codeInput.value);
    if (c.length !== 8) { joinErr.textContent = 'Le code fait 8 caractères, par exemple K7F3-QM9X.'; return; }
    go(`/j/${c}`);
  });

  app.append(
    h('header', { class: 'hero' },
      h('span', { class: 'eyebrow', text: 'Jeux à deux ou en groupe' }),
      h('h1', { class: 'chalkfx', text: 'Complices' }),
      h('p', { text: "Chacun écrit sur son ardoise, et au signal, tout le monde montre sa carte en même temps. Un lien suffit pour inviter." })),
    form,
    joinForm,
    h('p', { class: 'footer-note' },
      'Vos réponses ne sont jamais enregistrées : elles disparaissent à la fin de la partie. ',
      h('a', { href: '/confidentialite.html', text: 'Confidentialité et mentions légales' })));
  return {};
}

// ---------- invitation ----------

function joinScreen(rawCode) {
  const code = normalizeCode(rawCode);
  const already = store.get(`joined:${code}`);
  if (already && store.get(`room:${already}`)) { queueMicrotask(() => go(`/g/${already}`)); return {}; }

  const loading = h('p', { class: 'muted', text: 'Ouverture de l’invitation…' });
  app.append(loading);

  api(`/api/invite/${code}`).then((info) => {
    loading.remove();
    const name = h('input', { class: 'input', id: 'name', maxlength: 20, autocomplete: 'nickname', placeholder: 'Ton pseudo', value: store.get('name') || '' });
    const age = h('input', { type: 'checkbox', id: 'age' });
    const error = h('p', { class: 'error', role: 'alert' });
    const accept = h('button', { type: 'submit', class: 'btn primary block', id: 'accept', text: info.mode === 'group' ? 'Rejoindre le groupe' : 'Accepter la partie' });
    const form = h('form', { class: 'form', novalidate: true },
      h('label', { class: 'field' }, h('span', { text: 'Ton pseudo' }), name),
      h('label', { class: 'check' }, age, h('span', { text: `J'ai ${info.minAge} ans ou plus.` })),
      error, accept,
      h('button', { type: 'button', class: 'btn link', text: 'Non merci', onclick: () => go('/') }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      const pseudo = name.value.trim();
      if (!pseudo) { error.textContent = 'Choisis un pseudo.'; name.focus(); return; }
      if (!age.checked) { error.textContent = `Cette partie est réservée aux ${info.minAge} ans et plus.`; return; }
      accept.disabled = true;
      try {
        const r = await api(`/api/invite/${code}/join`, { name: pseudo, ageOk: true });
        store.set('name', pseudo);
        store.set(`room:${r.roomId}`, { playerId: r.playerId, secret: r.secret });
        store.set(`joined:${code}`, r.roomId);
        go(`/g/${r.roomId}`);
      } catch (err) {
        error.textContent = err.message;
        accept.disabled = false;
      }
    });
    const group = info.mode === 'group';
    app.append(
      h('header', { class: 'hero' }, h('span', { class: 'eyebrow', text: 'Complices' }), h('h1', { class: 'chalkfx', text: 'Invitation' })),
      h('div', { class: 'invite-card' },
        h('span', { class: 'kind', text: `${info.orientationLabel} · ${info.whereLabel}${group ? ' · en groupe' : ''}` }),
        h('p', { text: group ? `${info.hostName} lance une partie de groupe.` : `${info.hostName} t'invite à jouer.` }),
        group ? h('span', { class: 'hint', text: `Déjà là (${info.players.length}/${info.maxPlayers}) : ${listNames(info.players)}.` }) : null,
        h('span', { class: 'hint', text: `Niveau maximal : ${info.levelMax}. Chacun règle son curseur en secret, et la partie prend le niveau le plus bas.` })),
      form);
  }).catch((err) => {
    loading.remove();
    app.append(
      h('header', { class: 'hero' }, h('h1', { class: 'chalkfx', text: 'Oups' }), h('p', { text: err.message })),
      h('button', { type: 'button', class: 'btn primary', text: "Retour à l'accueil", onclick: () => go('/') }));
  });
  return {};
}

// ---------- partie ----------

function makeSlate(kind, label) {
  const front = h('div', { class: 'face front' });
  const back = h('div', { class: 'face back' });
  const inner = h('div', { class: 'inner' }, front, back);
  const tag = h('span', { class: 'tag', text: label });
  const root = h('div', { class: `slate ${kind}` }, tag, inner);
  return { root, inner, front, back, tag };
}

function gameScreen(roomId) {
  const creds = store.get(`room:${roomId}`);
  if (!creds) {
    app.append(
      h('header', { class: 'hero' }, h('h1', { class: 'chalkfx', text: 'Partie introuvable' }),
        h('p', { text: "Cette partie n'a pas été ouverte sur cet appareil. Demande un nouveau lien d'invitation." })),
      h('button', { type: 'button', class: 'btn primary', text: "Retour à l'accueil", onclick: () => go('/') }));
    return {};
  }

  let view = null;
  let invite = store.get(`invite:${roomId}`);
  let key = null;
  let t = null;              // références de l'écran de table
  let lastNotice;            // undefined tant qu'aucun état n'est reçu
  let peerInk = {};          // place → 'writing' | 'erasing' | 'idle'
  let timers = [];
  const owned = [];          // éléments ajoutés hors de #app

  const later = (ms, fn) => { const id = setTimeout(fn, Math.max(0, ms)); timers.push(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; document.querySelectorAll('.signal').forEach((s) => s.remove()); };

  // Aides de lecture de l'état
  const me = () => view.you.seat;
  const isGroup = () => view.mode === 'group';
  const activePlayers = () => view.players.filter((p) => !p.left);
  const others = () => activePlayers().filter((p) => p.seat !== me());
  const nameOf = (seat) => view.players.find((p) => p.seat === seat)?.name || '?';
  const who = (seat) => (seat === me() ? 'toi' : nameOf(seat));
  const peer = () => others()[0];

  // Barre du haut
  const roundEl = h('span', { class: 'grow' });
  const scoreEl = h('span', { class: 'score' });
  const muteBtn = h('button', { type: 'button', class: 'pill', id: 'mute' });
  const paintMute = () => { muteBtn.textContent = sound.isMuted() ? 'Son coupé' : 'Son'; muteBtn.setAttribute('aria-pressed', String(sound.isMuted())); };
  muteBtn.addEventListener('click', () => { sound.setMuted(!sound.isMuted()); paintMute(); });
  paintMute();
  const stopBtn = h('button', { type: 'button', class: 'pill stop', id: 'stop', text: 'Stop', onclick: openStopSheet });
  const banner = h('div', { class: 'banner', hidden: true, role: 'status' });
  const stage = h('div', { class: 'stage' });
  app.append(h('div', { class: 'topbar' }, roundEl, scoreEl, muteBtn, stopBtn), banner, stage);

  const coverText = h('p', { class: 'muted' });
  const cover = h('div', { class: 'cover', hidden: true }, h('div', { class: 'box' }, scribble(), h('h2', { class: 'chalkfx', text: 'Pause' }), coverText));
  document.body.append(cover);
  owned.push(cover);

  // Encre sortante : les autres voient seulement que ma craie bouge.
  let lastInk = 0;
  let idleTimer = null;
  function inkOut(state) {
    const now = Date.now();
    if (state === 'erasing' || now - lastInk > 1200) { net.send({ t: 'ink', state }); lastInk = now; }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => net.send({ t: 'ink', state: 'idle' }), 2500);
  }

  const net = new Net({
    roomId, playerId: creds.playerId, secret: creds.secret,
    onState(m) {
      if (m.invite) { invite = m.invite; store.set(`invite:${roomId}`, invite); }
      view = m.view;
      handleNotice();
      renderTop();
      renderStage();
      renderCover();
    },
    onEvent(m) {
      if (m.t === 'peer_ink') { peerInk[m.seat] = m.state; if (t) updateTable(); }
      else if (m.t === 'react') floatEmoji(m.emoji, m.seat);
      else if (m.t === 'error') {
        toast(m.message);
        if (t && view) updateTable();
        if (t && m.code === 'empty') shake(t.mySlate.root);
        stage.querySelectorAll('button[disabled].busy').forEach((b) => { b.disabled = false; b.classList.remove('busy'); });
      }
    },
    onStatus(s) {
      if (s === 'online') { banner.hidden = true; return; }
      if (s === 'offline') { banner.hidden = false; banner.textContent = 'Connexion perdue. Reconnexion…'; return; }
      clearTimers();
      const left = view?.you?.left || s === 'gone' && view && !view.players.find((p) => p.seat === me());
      stage.replaceChildren(
        h('h2', { class: 'chalkfx', text: s === 'gone' ? (left ? 'Tu as quitté la partie' : 'Partie terminée') : 'Partie ouverte ailleurs' }),
        h('p', { class: 'muted', text: s === 'gone' ? (left ? 'À bientôt !' : "Cette partie n'existe plus sur le serveur. Lancez-en une nouvelle.") : 'Cette partie est ouverte dans un autre onglet ou sur un autre appareil.' }),
        h('button', { type: 'button', class: 'btn primary', text: "Retour à l'accueil", onclick: () => go('/') }));
      banner.hidden = true;
      key = null; t = null;
    },
  });

  function handleNotice() {
    const n = view.notice;
    if (lastNotice === undefined) { lastNotice = n ? n.id : 0; return; }
    if (!n || n.id === lastNotice) return;
    lastNotice = n.id;
    if (n.type === 'joined' && n.seat !== me()) { toast(`${nameOf(n.seat)} a rejoint la partie !`); sound.joined(); sound.buzz([30, 40, 30]); }
    if (n.type === 'left' && n.seat !== me()) toast(`${nameOf(n.seat)} a quitté la partie.`);
    if (n.type === 'level_agreed') toast(`Niveau de la partie : ${view.levelLabel}. Personne ne sait qui a choisi quoi.`);
    if (n.type === 'lowered') toast('La partie redescend en Doux.');
  }

  function renderTop() {
    const p = view.phase;
    roundEl.textContent = p === 'lobby' ? "Salle d'attente" : p === 'negotiate' ? 'Réglages' : p === 'end' ? 'Fin de partie'
      : `Tour ${view.roundNo} / ${view.rules.roundsMax} · ${view.levelLabel}`;
    scoreEl.replaceChildren();
    if (!['lobby', 'negotiate'].includes(p) && view.you) {
      if (isGroup()) {
        const ranked = [...activePlayers()].sort((a, b) => b.flair - a.flair);
        const rank = ranked.findIndex((x) => x.seat === me()) + 1;
        scoreEl.append(`Toi ${view.you.flair} · `, h('span', { class: 'peer', text: rank === 1 ? '1er' : `${rank}e` }));
      } else if (peer()) {
        scoreEl.append(`Toi ${view.you.flair} · `, h('span', { class: 'peer', text: `${peer().name} ${peer().flair}` }));
      }
    }
    stopBtn.hidden = p === 'end' || (p === 'lobby' && !isGroup());
    stopBtn.textContent = isGroup() && view.host !== me() ? 'Quitter' : 'Stop';
  }

  function renderCover() {
    // En duo, la partie se met en pause si l'autre perd la connexion. En groupe, on continue sans lui.
    const p2 = peer();
    const off = !isGroup() && p2 && !p2.connected && !['lobby', 'end'].includes(view.phase);
    cover.hidden = !off;
    if (off) coverText.textContent = `${p2.name} a perdu la connexion. La partie reprend dès son retour.`;
  }

  function renderStage() {
    const p = view.phase;
    if (view.you?.left) {
      if (key !== 'left') {
        key = 'left'; t = null; clearTimers();
        stage.replaceChildren(
          h('h2', { class: 'chalkfx', text: 'Tu as quitté la partie' }),
          h('p', { class: 'muted', text: 'Le groupe continue sans toi. À bientôt !' }),
          h('button', { type: 'button', class: 'btn primary', text: "Retour à l'accueil", onclick: () => go('/') }));
      }
      return;
    }
    let k;
    if (p === 'reveal' && !view.round.card) k = `passed-${view.roundNo}`;
    else if (['write', 'signal', 'reveal'].includes(p)) k = `table-${view.roundNo}`;
    else if (p === 'pick') k = `pick-${view.roundNo}-${view.round.leader}-${(view.round.options || []).map((c) => c.id).join(',')}`;
    else if (p === 'lobby') k = 'lobby';
    else k = `${p}-${view.roundNo}`;
    if (k !== key) {
      key = k;
      clearTimers();
      t = null;
      stage.replaceChildren();
      if (p === 'lobby') buildLobby();
      else if (p === 'negotiate') buildNegotiate();
      else if (p === 'pick') buildPick();
      else if (p === 'end') buildEnd();
      else if (k.startsWith('passed')) buildPassed();
      else { peerInk = {}; buildTable(); }
    }
    if (p === 'lobby') updateLobby();
    if (p === 'negotiate') updateNegotiate();
    if (p === 'pick') updatePick();
    if (t) updateTable();
  }

  // ----- salle d'attente -----
  let lobbyList = null;
  let startBtn = null;
  let lobbyHint = null;
  function buildLobby() {
    const group = isGroup();
    const els = [
      h('h2', { class: 'chalkfx', text: group ? 'Rassemble ton groupe' : 'Invite ton ou ta complice' }),
      h('p', { class: 'muted', text: group
        ? "Partage ce lien dans votre groupe WhatsApp. Chacun choisit son pseudo, puis l'hôte lance la partie."
        : 'Envoie ce lien. Dès que la personne accepte, la partie commence.' }),
    ];
    if (invite) {
      const linkBox = h('input', { class: 'linkbox', id: 'invite-link', readonly: true, value: invite.link, 'aria-label': "Lien d'invitation" });
      const copy = h('button', { type: 'button', class: 'btn ghost grow', id: 'copy', text: 'Copier le lien' });
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(invite.link); toast('Lien copié.'); }
        catch { linkBox.select(); try { document.execCommand('copy'); toast('Lien copié.'); } catch { toast('Sélectionne le lien et copie-le.'); } }
      });
      const message = group
        ? `${view.you.name} lance une partie de Complices ! Rejoins le groupe ici : ${invite.link}`
        : `${view.you.name} t'invite à jouer à Complices : ${invite.link}`;
      const wa = h('a', { class: 'btn primary grow wa', id: 'whatsapp', href: `https://wa.me/?text=${encodeURIComponent(message)}`, target: '_blank', rel: 'noopener', text: 'Envoyer sur WhatsApp' });
      const row = h('div', { class: 'row' }, wa, copy);
      if (navigator.share) {
        row.append(h('button', {
          type: 'button', class: 'btn ghost', id: 'share', text: 'Partager',
          onclick: () => navigator.share({ title: 'Complices', text: message, url: invite.link }).catch(() => {}),
        }));
      }
      els.push(
        h('img', { class: 'qr', src: invite.qr, alt: "QR code de l'invitation", width: 170, height: 170 }),
        h('p', { class: 'code chalkfx', text: invite.code }),
        row, linkBox);
    }
    if (group) {
      lobbyList = h('ul', { class: 'roster' });
      lobbyHint = h('p', { class: 'small muted' });
      startBtn = h('button', { type: 'button', class: 'btn primary block', id: 'start', text: 'Lancer la partie', onclick: (e) => { e.currentTarget.disabled = true; e.currentTarget.classList.add('busy'); net.act('start'); } });
      els.push(h('h3', { class: 'chalkfx', text: 'Autour de la table' }), lobbyList, startBtn, lobbyHint);
    } else {
      const waiting = makeSlate('peer', 'Son ardoise');
      waiting.inner.classList.add('turned');
      waiting.back.append(h('span', { class: 'monogram chalkfx', text: '?' }), scribble(), h('span', { class: 'status', text: 'En attente de ton ou ta complice…' }));
      els.push(waiting.root);
    }
    els.push(h('p', { class: 'small muted', text: group
      ? `Jusqu'à ${view.maxPlayers} joueurs. Le lien expire dans 24 h et se ferme dès que la partie commence.`
      : "Le lien ne sert qu'une fois et expire dans 24 h. Sur place, l'autre peut scanner le QR code ou taper le code sur l'accueil." }));
    stage.append(...els);
  }
  function updateLobby() {
    if (!lobbyList) return;
    lobbyList.replaceChildren(...activePlayers().map((p) => h('li', { class: p.connected ? '' : 'off' },
      h('span', { class: 'chalkfx', text: p.name }),
      h('span', { class: 'small muted', text: `${p.seat === view.host ? 'hôte' : ''}${p.seat === me() ? (p.seat === view.host ? ' · toi' : 'toi') : ''}` }))));
    const host = view.host === me();
    const n = activePlayers().length;
    startBtn.hidden = !host;
    startBtn.disabled = n < 2;
    startBtn.textContent = n < 2 ? 'En attente des joueurs…' : `Lancer la partie à ${n}`;
    lobbyHint.textContent = host ? 'Lance quand tout le monde est là : plus personne ne pourra entrer ensuite.' : `${nameOf(view.host)} lancera la partie quand tout le monde sera là.`;
  }

  // ----- curseur secret -----
  let levelButtons = [];
  let peerLine = null;
  function buildNegotiate() {
    const desc = LEVEL_DESC[view.orientation];
    levelButtons = LEVELS.map((L, i) => h('button', {
      type: 'button', class: 'level', id: `level-${i + 1}`, 'aria-pressed': 'false',
      onclick: () => {
        levelButtons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
        net.act('set_level', { level: i + 1 });
        sound.circle(); sound.buzz(10);
      },
    }, h('b', { class: 'chalkfx', text: L }), h('span', { text: desc[i] })));
    peerLine = h('p', { class: 'peerline chalkfx', role: 'status' });
    stage.append(
      h('h2', { class: 'chalkfx', text: 'Règle ton curseur, en secret' }),
      h('p', { class: 'muted', text: `La partie prendra le niveau le plus bas ${isGroup() ? 'de tous' : 'des deux'}. Personne ne saura qui a choisi quoi.` }),
      h('div', { class: 'levels' }, levelButtons),
      peerLine,
      h('p', { class: 'small muted', text: "Pendant la partie, le bouton Stop permet de redescendre en Doux à tout moment, sans que personne sache que c'est toi." }));
  }
  function updateNegotiate() {
    const mine = view.you.myLevel;
    if (mine) levelButtons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === mine - 1)));
    if (!peerLine) return;
    if (isGroup()) {
      const done = activePlayers().filter((p) => p.levelSet);
      const waiting = activePlayers().filter((p) => !p.levelSet && p.seat !== me()).map((p) => p.name);
      peerLine.textContent = `Curseurs réglés : ${done.length} / ${activePlayers().length}${waiting.length ? ` · on attend ${listNames(waiting)}` : ''}`;
    } else if (peer()) {
      peerLine.textContent = peer().levelSet ? `${peer().name} a réglé son curseur ✓` : `${peer().name} règle son curseur…`;
    }
  }

  // ----- tirage : carte du jeu ou question perso -----
  let pickState = null;
  function buildPick() {
    const r = view.round;
    pickState = { target: r.target };
    if (r.role !== 'leader') {
      const s = makeSlate('peer', `L'ardoise ${de(nameOf(r.leader))}`);
      s.inner.classList.add('turned');
      s.back.append(h('span', { class: 'monogram chalkfx', text: 'C' }), scribble(), h('span', { class: 'status', text: `${nameOf(r.leader)} choisit une carte…` }));
      stage.append(s.root,
        h('h2', { class: 'chalkfx', text: 'Prépare ta craie' }),
        h('p', { class: 'muted', text: isGroup()
          ? `Ce tour-ci, ${nameOf(r.leader)} est le Meneur et choisit la carte et la Cible.`
          : `Ce tour-ci, ${nameOf(r.leader)} est le Meneur et toi la Cible.` }));
      return;
    }
    const els = [h('h2', { class: 'chalkfx', text: 'Tu es le Meneur' })];
    if (isGroup()) {
      const chips = others().map((p) => h('button', {
        type: 'button', class: 'chip', id: `target-${p.seat}`, 'aria-pressed': String(p.seat === pickState.target),
        onclick: (e) => { pickState.target = p.seat; chips.forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget))); sound.circle(); paintHints(); },
      }, p.name));
      els.push(h('p', { class: 'muted', text: 'À qui poses-tu la question ? Les autres parieront sur sa réponse.' }), h('div', { class: 'chips', role: 'group', 'aria-label': 'Choisir la Cible' }, chips));
    } else {
      els.push(h('p', { class: 'muted', text: `Choisis une carte pour ${nameOf(r.target)}, ou écris ta propre question.` }));
    }
    const hints = [];
    const cards = r.options.map((card) => {
      const hint = h('span', { class: 'small' });
      hints.push([hint, card]);
      return h('button', {
        type: 'button', class: 'pickcard', id: `card-${card.id}`,
        onclick: (e) => { cards.forEach((c) => { c.disabled = true; }); e.currentTarget.classList.add('busy'); net.act('pick', { cardId: card.id, target: pickState.target }); sound.pose(); },
      },
      h('div', { class: 'meta' }, h('span', { class: 'kind', text: `${KIND_LABEL[card.kind]}${card.community ? ' · communauté' : ''}` }), h('span', { text: `${LEVELS[card.level - 1]} · ${inputHint(card)}` })),
      h('p', { text: card.text }),
      hint);
    });
    function paintHints() { for (const [el, card] of hints) el.textContent = kindHint(card, nameOf(pickState.target)); }
    paintHints();
    const writeBtn = h('button', { type: 'button', class: 'btn primary block', id: 'write-own', text: 'Écrire ma propre question', onclick: openEditor });
    els.push(h('div', { class: 'fan' }, cards), writeBtn,
      h('button', { type: 'button', class: 'btn link', id: 'pass-pick', text: 'Aucune ne me plaît : passer le tour', onclick: () => net.act('pass') }));
    stage.append(...els);
  }
  function updatePick() { /* le tirage est reconstruit si les cartes changent */ }

  function openEditor() {
    const r = view.round;
    const ed = { kind: 'truth', input: 'text', choices: ['', ''], minLabel: '', maxLabel: '' };
    const kinds = CUSTOM_KINDS.filter((k) => !k.group || isGroup());
    const text = h('textarea', { class: 'input editor-text', id: 'custom-text', maxlength: 140, rows: 3, placeholder: 'Ta question, ton défi…' });
    const counter = h('span', { class: 'small muted', text: '0 / 140' });
    text.addEventListener('input', () => { counter.textContent = `${text.value.length} / 140`; });
    const inputsBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Type de réponse' });
    const choicesBox = h('div', { class: 'field' });
    const scaleBox = h('div', { class: 'row' },
      h('input', { class: 'linkbox grow', id: 'scale-min', maxlength: 20, placeholder: '1 = Pas du tout', oninput: (e) => { ed.minLabel = e.target.value; } }),
      h('input', { class: 'linkbox grow', id: 'scale-max', maxlength: 20, placeholder: '10 = Énormément', oninput: (e) => { ed.maxLabel = e.target.value; } }));
    const kindHelp = h('p', { class: 'small muted' });
    const share = h('input', { type: 'checkbox', id: 'custom-share' });
    const err = h('p', { class: 'error', role: 'alert' });

    function paintChoices() {
      choicesBox.replaceChildren(
        ...ed.choices.map((c, i) => h('input', { class: 'linkbox', id: `choice-${i}`, maxlength: 24, placeholder: `Choix ${i + 1}`, value: c, oninput: (e) => { ed.choices[i] = e.target.value; } })),
        ed.choices.length < 4 ? h('button', { type: 'button', class: 'btn link', text: '+ Ajouter un choix', onclick: () => { ed.choices.push(''); paintChoices(); } }) : null);
    }
    function paintInputs() {
      const k = kinds.find((x) => x.id === ed.kind);
      if (!k.inputs.includes(ed.input)) ed.input = k.inputs[0];
      kindHelp.textContent = k.desc + (ed.kind === 'dare' ? '. Tout le monde parie : relève ou passe ?' : '');
      inputsBox.replaceChildren(...optionButtons(k.inputs.map((i) => ({ id: i, label: INPUT_LABEL[i] })), ed.input, (id) => { ed.input = id; paintInputs(); }, 'chip'));
      inputsBox.hidden = k.inputs.length < 2;
      choicesBox.hidden = ed.input !== 'choice';
      scaleBox.hidden = ed.input !== 'scale';
    }
    paintChoices();
    paintInputs();

    const play = h('button', {
      type: 'button', class: 'btn primary block', id: 'play-custom', text: 'Jouer cette carte',
      onclick: (e) => {
        err.textContent = '';
        const card = { text: text.value.trim(), kind: ed.kind, input: ed.input };
        if (card.text.length < 5) { err.textContent = 'Écris ta question (5 caractères minimum).'; text.focus(); return; }
        if (ed.input === 'choice') {
          card.choices = ed.choices.map((c) => c.trim()).filter(Boolean);
          if (card.choices.length < 2) { err.textContent = 'Propose au moins 2 choix.'; return; }
        }
        if (ed.input === 'scale') card.scale = { minLabel: ed.minLabel.trim(), maxLabel: ed.maxLabel.trim() };
        e.currentTarget.disabled = true;
        e.currentTarget.classList.add('busy');
        net.act('pick_custom', { card, target: pickState.target, share: share.checked });
        sound.pose();
      },
    });

    stage.replaceChildren(
      h('h2', { class: 'chalkfx', text: 'Ta propre carte' }),
      h('p', { class: 'muted', text: isGroup() ? `Cible : ${nameOf(pickState.target)}. Niveau de la partie : ${view.levelLabel}.` : `Pour ${nameOf(r.target)}. Niveau de la partie : ${view.levelLabel}.` }),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Type de carte' }, optionButtons(kinds.map((k) => ({ id: k.id, label: k.label })), ed.kind, (id) => { ed.kind = id; paintInputs(); }, 'chip')),
      kindHelp,
      h('label', { class: 'field' }, h('span', { text: 'La carte' }), text, counter),
      inputsBox, choicesBox, scaleBox,
      h('label', { class: 'check' }, share, h('span', { text: "Proposer ma question à la banque Complices, sans mon pseudo. Si l'équipe la valide, elle pourra apparaître dans d'autres parties." })),
      h('p', { class: 'small muted', text: "Reste dans le niveau choisi par tous. La Cible peut toujours passer, sans explication." }),
      err, play,
      h('button', { type: 'button', class: 'btn link', text: 'Revenir au tirage', onclick: () => { key = null; renderStage(); } }));
    text.focus();
  }

  function inputHint(card) {
    if (card.kind === 'dare') return 'défi';
    return { text: 'réponse écrite', scale: 'échelle', choice: 'choix', draw: 'dessin', player: 'vote' }[card.input];
  }
  function kindHint(card, targetName) {
    if (card.kind === 'mirror') return isGroup() ? 'Tout le monde répond, chacun pour soi.' : 'Vous répondez tous les deux, chacun pour soi.';
    if (card.kind === 'vote') return 'Chacun désigne un joueur. La majorité l’emporte.';
    const bettors = isGroup() ? 'Les autres parient' : 'Toi, tu paries';
    if (card.kind === 'dare') return `${targetName} relève le défi ou passe. ${bettors}.`;
    return `${targetName} répond pour de vrai. ${bettors} sur sa réponse.`;
  }
  function promptFor(r) {
    const k = r.card.kind;
    const target = nameOf(r.target);
    if (k === 'mirror') return 'Miroir : chacun répond pour soi. Âmes jumelles si vos ardoises sont pareilles.';
    if (k === 'vote') return 'Vote : désigne un joueur. Toutes les ardoises se montrent en même temps.';
    if (k === 'dare') return r.role === 'target' ? 'Défi pour toi : tu le relèves ou tu passes ?' : `Défi pour ${target}. Ton pari : relève ou passe ?`;
    if (r.role === 'target') return isGroup() ? 'Réponds pour de vrai. Les autres parient sur ta réponse.' : `Réponds pour de vrai. ${nameOf(r.leader)} parie sur ta réponse.`;
    return `Pari : écris ce ${que(target)} va répondre.`;
  }

  // ----- la table : écrire, signal, révélation -----
  function buildTable() {
    const r = view.round;
    const group = isGroup();
    const peers = {};
    const peersBox = h('div', { class: `peers${group ? ' many' : ''}` });
    for (const p of others()) {
      const role = p.seat === r.target && r.card.kind !== 'mirror' && r.card.kind !== 'vote' ? ' · Cible' : p.seat === r.leader ? ' · Meneur' : '';
      const s = makeSlate(`peer${group ? ' mini' : ''}`, group ? `${p.name}${role}` : `L'ardoise ${de(p.name)}`);
      s.inner.classList.add('turned');
      const scrib = scribble();
      const status = h('span', { class: 'status', role: 'status' });
      const gain = h('span', { class: 'gain', hidden: true });
      s.back.append(group ? null : h('span', { class: 'monogram chalkfx', text: 'C' }), scrib, status);
      s.root.append(gain);
      peers[p.seat] = { ...s, scrib, status, gain, wasPosed: false };
      peersBox.append(s.root);
    }

    const kindLine = `${KIND_LABEL[r.card.kind]} · ${LEVELS[r.card.level - 1]}${r.card.custom ? ` · question ${de(r.card.author)}` : r.card.community ? ' · communauté' : ''}`;
    const master = h('div', { class: 'master' },
      h('span', { class: 'kind', text: kindLine }),
      h('p', { class: 'q', text: r.card.text }),
      h('span', { class: 'hint', text: promptFor(r) }));

    const mySlate = makeSlate('mine', r.role === 'target' && r.card.kind !== 'mirror' && r.card.kind !== 'vote' ? 'Mon ardoise · Cible' : 'Mon ardoise');
    const myGain = h('span', { class: 'gain', hidden: true });
    mySlate.root.append(myGain);
    const input = createInput({
      card: r.card, input: r.input, role: r.role === 'target' ? 'target' : 'leader', peerName: nameOf(r.target),
      players: activePlayers(), me: me(), onInk: inkOut,
    });
    mySlate.front.append(input.el);
    if (r.myAnswer) renderAnswer(mySlate.front, r.myAnswer, r.card, myLabels(r));
    mySlate.back.append(
      h('span', { class: 'monogram chalkfx', text: 'C' }),
      h('span', { class: 'status', text: 'Ta carte est tournée' }),
      h('span', { class: 'substatus', text: group ? 'Les autres ne voient que le dos de ton ardoise.' : `${nameOf(peer().seat)} ne voit que le dos de ton ardoise.` }),
      h('button', { type: 'button', class: 'btn ghost', id: 'unpose', text: 'Reprendre la craie', onclick: () => { net.act('unpose'); mySlate.inner.classList.remove('turned'); } }));

    // En groupe, seule la Cible d'une Vérité / Pari / Action passe la carte ; les autres s'abstiennent.
    const passWhole = !group || (r.role === 'target' && !['mirror', 'vote'].includes(r.card.kind));
    const tools = h('div', { class: 'tools' },
      h('button', { type: 'button', class: 'btn ghost', id: 'sponge', text: 'Éponge', onclick: () => { input.clear(); sound.sponge(); sound.buzz(20); } }),
      h('button', {
        type: 'button', class: 'btn primary', id: 'pose', text: 'Poser la craie',
        onclick: () => {
          const a = input.getAnswer();
          if (!a) { shake(mySlate.root); toast('Ton ardoise est vide. Écris quelque chose, ou passe.'); return; }
          document.activeElement?.blur?.();
          mySlate.inner.classList.add('turned');
          tools.hidden = true;
          net.act('pose', { answer: a });
          sound.pose(); sound.buzz(15);
        },
      }),
      h('button', { type: 'button', class: 'btn link', id: 'pass', text: passWhole ? 'Passer' : "Je m'abstiens", onclick: () => net.act('pass') }));
    const waiting = h('p', { class: 'wait chalkfx', hidden: true, role: 'status' });

    const verdictEl = h('div', { class: 'verdict chalkfx', role: 'status' });
    const judgeEl = h('div', { class: 'judgebox', hidden: true });
    const reacts = h('div', { class: 'reacts', role: 'group', 'aria-label': 'Réagir' },
      REACTIONS.map((e) => h('button', { type: 'button', 'aria-label': `Réagir ${e}`, text: e, onclick: () => { net.send({ t: 'react', emoji: e }); floatEmoji(e, me()); sound.pop(); sound.buzz(10); } })));
    const nextBtn = h('button', { type: 'button', class: 'btn primary block', id: 'next', onclick: (e) => { e.currentTarget.disabled = true; net.act('next'); } });
    const after = h('div', { class: 'after', hidden: true }, verdictEl, judgeEl, reacts, nextBtn);

    stage.append(peersBox, master, mySlate.root, tools, waiting, after);
    t = { peers, mySlate, myGain, input, tools, waiting, after, verdictEl, judgeEl, reacts, nextBtn, revealed: false, countdown: false, judgeKey: null };
  }

  function myLabels(r) {
    return labelsFor(r.card, r.role === 'target' ? 'target' : 'leader', nameOf(r.target), activePlayers());
  }
  function labelsOf(r, seat) {
    return labelsFor(r.card, seat === r.target ? 'target' : 'leader', nameOf(r.target), activePlayers());
  }

  function updateTable() {
    const r = view.round;
    const p = view.phase;
    const present = (s) => view.players.find((x) => x.seat === s);

    if (p === 'write') {
      t.mySlate.inner.classList.toggle('turned', r.myPosed);
      t.tools.hidden = r.myPosed;
      t.waiting.hidden = !r.myPosed;
      const missing = others().filter((x) => x.connected && !r.posed[x.seat]).map((x) => x.name);
      t.waiting.textContent = missing.length ? `En attente ${missing.length === 1 ? de(missing[0]) : `de ${listNames(missing)}`}…` : 'Toutes les craies sont posées…';
      for (const [seat, s] of Object.entries(t.peers)) {
        const pl = present(seat);
        if (pl?.left) { setScribble(s.scrib, 'idle'); s.status.textContent = 'a quitté'; continue; }
        if (r.posed[seat]) {
          setScribble(s.scrib, 'done');
          s.status.textContent = 'a posé sa craie ✓';
          if (!s.wasPosed) { sound.peerReady(); sound.buzz(10); }
        } else if (pl && !pl.connected) {
          setScribble(s.scrib, 'idle'); s.status.textContent = 'absent·e';
        } else {
          const [txt, st] = { writing: ['écrit…', 'writing'], erasing: ['efface…', 'erase'] }[peerInk[seat]] || ['réfléchit…', 'idle'];
          setScribble(s.scrib, st);
          s.status.textContent = txt;
        }
        s.wasPosed = Boolean(r.posed[seat]);
      }
      return;
    }

    if (p === 'signal') {
      t.mySlate.inner.classList.add('turned');
      t.tools.hidden = true;
      t.waiting.hidden = false;
      t.waiting.textContent = 'Le Maître va donner le signal…';
      for (const s of Object.values(t.peers)) { setScribble(s.scrib, 'done'); if (!s.status.textContent.includes('quitté')) s.status.textContent = 'a posé sa craie ✓'; }
      startCountdown();
      return;
    }

    // reveal
    if (r.outcome === 'played' || r.outcome === 'absent') {
      if (!t.revealed) { clearTimers(); reveal(); }
      paintGains();
    } else {
      for (const s of Object.values(t.peers)) { setScribble(s.scrib, 'done'); s.status.textContent = 'Carte passée'; }
      t.mySlate.inner.classList.add('turned');
      t.tools.hidden = true;
      t.waiting.hidden = true;
    }
    showAfter();
  }

  function startCountdown() {
    if (t.countdown) return;
    t.countdown = true;
    const local = net.toLocal(view.round.revealAt);
    const now = Date.now();
    const span = h('span');
    const sig = h('div', { class: 'signal', 'aria-live': 'assertive' }, span);
    const show = (txt, goCls) => { span.className = goCls ? 'go chalkfx' : 'chalkfx'; void span.offsetWidth; span.textContent = txt; };
    let shown = false;
    [3, 2, 1].forEach((n, i) => {
      const at = local - 3000 + i * 1000 - now;
      if (at > -400) later(at, () => { if (!shown) { document.body.append(sig); shown = true; } show(String(n)); sound.tick(); sound.buzz(30); });
    });
    later(local - now, () => {
      if (!shown) { document.body.append(sig); shown = true; }
      show('Ardoises !', true);
      sound.bell(); sound.buzz([60, 40, 120]);
      reveal();
      setTimeout(() => { sig.classList.add('fade'); setTimeout(() => sig.remove(), 360); }, 650);
    });
  }

  function reveal() {
    if (t.revealed) return;
    t.revealed = true;
    const r = view.round;
    for (const [seat, s] of Object.entries(t.peers)) {
      const a = r.answers?.[seat];
      if (a) renderAnswer(s.front, a, r.card, labelsOf(r, seat));
      else s.front.replaceChildren(h('div', { class: 'written chalkfx skip', text: 'ardoise vide' }));
      s.inner.classList.remove('turned');
    }
    if (r.myAnswer) renderAnswer(t.mySlate.front, r.myAnswer, r.card, myLabels(r));
    t.input.lock();
    t.mySlate.inner.classList.remove('turned');
    t.tools.hidden = true;
    t.waiting.hidden = true;
    setTimeout(() => {
      if (!t) return;
      const all = [...Object.values(t.peers).map((s) => s.root), t.mySlate.root];
      all.forEach((el) => el.classList.add('lifted'));
      dust(t.mySlate.root);
      Object.values(t.peers).slice(0, 3).forEach((s) => dust(s.root));
      sound.lift();
    }, 120);
  }

  /** Petites pastilles de points sur chaque ardoise après la révélation. */
  function paintGains() {
    const r = view.round;
    const paint = (el, seat) => {
      const g = r.gains?.[seat];
      const mark = r.auto?.[seat];
      el.hidden = !g && !mark;
      el.className = `gain ${mark || ''}`;
      el.textContent = g ? `+${g}` : mark === 'miss' ? '✗' : '';
      if (!g && mark !== 'miss') el.hidden = true;
    };
    for (const [seat, s] of Object.entries(t.peers)) paint(s.gain, seat);
    paint(t.myGain, me());
  }

  function showAfter() {
    const r = view.round;
    const v = verdictFor(r);
    t.verdictEl.replaceChildren(v.title, h('small', { text: v.sub }));
    t.after.hidden = false;
    t.reacts.hidden = r.outcome !== 'played';

    const jk = `${r.canJudge}`;
    if (t.judgeKey !== jk) {
      t.judgeKey = jk;
      t.judgeEl.replaceChildren();
      if (r.canJudge) buildJudge(r);
    }
    t.judgeEl.hidden = !r.canJudge;
    const canNext = r.outcome !== 'played' || !r.needsJudge || r.judged;
    t.nextBtn.hidden = !canNext;
    t.nextBtn.textContent = view.roundNo >= view.rules.roundsMax ? 'Voir le bilan' : 'Tour suivant';
  }

  /** La Cible juge chaque ardoise écrite ou dessinée. */
  function buildJudge(r) {
    const mirror = r.card.kind === 'mirror';
    const labels = mirror ? ['Pareil', 'Proche', 'Différent'] : ['Vu juste', 'Presque', 'Raté'];
    const verdicts = {};
    const send = h('button', { type: 'button', class: 'btn primary block', id: 'judge-send', text: 'Valider', disabled: true });
    const rows = r.judgeable.map((seat) => {
      const btns = ['exact', 'close', 'miss'].map((v, i) => h('button', {
        type: 'button', class: 'chip', id: `judge-${seat}-${v}`, 'aria-pressed': 'false', text: labels[i],
        onclick: (e) => {
          verdicts[seat] = v;
          btns.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
          send.disabled = Object.keys(verdicts).length !== r.judgeable.length;
          sound.circle();
        },
      }));
      const a = r.answers?.[seat];
      const preview = a?.type === 'text' ? `« ${a.value} »` : a?.type === 'draw' ? 'son dessin' : '';
      return h('div', { class: 'judgerow' }, h('span', { class: 'who' }, h('b', { text: nameOf(seat) }), preview ? ` ${preview}` : ''), h('div', { class: 'chips' }, btns));
    });
    send.addEventListener('click', () => { send.disabled = true; net.act('judge', { verdicts }); });
    t.judgeEl.append(
      h('p', { class: 'small muted', text: mirror ? 'Vos réponses sont-elles pareilles ?' : r.judgeable.length > 1 ? 'Qui a vu juste ? Juge chaque ardoise.' : `${nameOf(r.judgeable[0])} a-t-il·elle vu juste ?` }),
      ...rows, send);
  }

  function verdictFor(r) {
    const group = isGroup();
    const target = r.target;
    const iAmTarget = target === me();
    if (r.outcome === 'passed') return { title: 'Carte passée', sub: 'Aucun point en jeu, aucune explication à donner.' };
    if (r.outcome === 'lowered') return { title: 'On redescend en Doux', sub: 'La carte en cours est retirée. La suite sera plus douce.' };
    if (r.outcome === 'absent') return { title: 'La Cible est absente', sub: 'Personne ne marque. On passe à la suite.' };
    const exact = Object.keys(r.auto || {}).filter((s) => r.auto[s] === 'exact' && s !== target);
    const close = Object.keys(r.auto || {}).filter((s) => r.auto[s] === 'close' && s !== target);
    const names = (seats) => listNames(seats.map(who));

    if (r.card.kind === 'vote') {
      const winners = r.vote?.winners || [];
      const n = winners.length ? r.vote.counts[winners[0]] : 0;
      if (!winners.length) return { title: 'Aucun vote', sub: '' };
      const title = winners.length > 1 ? `Égalité : ${names(winners)} !` : winners[0] === me() ? 'Le groupe t’a désigné·e !' : `Le groupe a désigné ${nameOf(winners[0])} !`;
      const voters = Object.keys(r.gains || {});
      return { title, sub: `${n} vote${n > 1 ? 's' : ''}. ${voters.length ? `+1 pour ${names(voters)}, dans la majorité.` : ''} Écho : pourquoi ce choix ?` };
    }
    if (r.card.kind === 'dare') {
      const acc = r.dareAccepted;
      const title = acc ? (iAmTarget ? 'Tu relèves le défi !' : `${nameOf(target)} relève le défi !`) : (iAmTarget ? 'Tu passes ce défi' : `${nameOf(target)} passe ce défi`);
      let sub = exact.length ? `${exact.includes(me()) && exact.length === 1 ? "Tu l'avais vu venir" : `Vu venir par ${names(exact)}`} : +3.` : 'Personne ne l’avait vu venir.';
      if (acc) sub += iAmTarget ? ' +2 Flair pour toi. À toi de jouer, maintenant !' : ` +2 pour ${nameOf(target)}. Place au spectacle !`;
      return { title, sub };
    }
    if (r.card.kind === 'mirror') {
      if (r.needsJudge && !r.judged) return { title: 'Comparez vos ardoises', sub: r.canJudge ? 'À toi de juger.' : `${nameOf(target)} compare vos ardoises…` };
      if (r.soulmates?.length) return { title: `Âmes jumelles : ${names(r.soulmates)} !`, sub: '+2 chacun et un bonus de complicité.' };
      const near = Object.keys(r.auto || {}).filter((s) => r.auto[s] === 'close');
      if (near.length) return { title: 'Presque pareil', sub: `+1 pour ${names(near)}. Écho : qu'est-ce qui vous sépare ?` };
      return { title: group ? 'Toutes les versions sont sur la table' : 'Deux versions', sub: group ? '+1 pour chaque ardoise. Écho : chacun raconte la sienne.' : 'Écho : chacun raconte pourquoi il a écrit ça.' };
    }
    // Vérité / Pari
    const played = iAmTarget ? '+2 Flair pour toi : tu as joué le jeu.' : `+2 pour ${nameOf(target)} qui a joué le jeu.`;
    if (r.needsJudge && !r.judged) return { title: 'Alors, ces paris ?', sub: r.canJudge ? 'Les autres ont parié sur ta réponse. Verdict ?' : `${nameOf(target)} juge les ardoises…` };
    if (exact.length) {
      const solo = !group && exact.length === 1;
      return { title: solo ? (exact[0] === me() ? 'Pari exact !' : `${nameOf(exact[0])} a vu juste !`) : `Vu juste : ${names(exact)} !`, sub: `${exact.length > 1 ? '+3 chacun' : '+3'}${close.length ? `, +1 pour ${names(close)}` : ''}. ${played}` };
    }
    if (close.length) return { title: 'À un cheveu !', sub: `+1 pour ${names(close)}. ${played}` };
    return { title: 'Personne n’a vu juste !', sub: `Écho : demande pourquoi. ${played}` };
  }

  // Le tirage entier a été passé avant le choix d'une carte.
  function buildPassed() {
    stage.append(h('div', { class: 'after' },
      h('div', { class: 'verdict chalkfx' }, view.round.outcome === 'lowered' ? 'On redescend en Doux' : 'Tour passé',
        h('small', { text: 'Aucun point en jeu, aucune explication à donner.' })),
      h('button', { type: 'button', class: 'btn primary block', id: 'next', text: view.roundNo >= view.rules.roundsMax ? 'Voir le bilan' : 'Tour suivant', onclick: (e) => { e.currentTarget.disabled = true; net.act('next'); } })));
  }

  // ----- fin -----
  function buildEnd() {
    const els = [];
    if (view.you.left) {
      els.push(h('h2', { class: 'chalkfx', text: 'Tu as quitté la partie' }), h('p', { class: 'muted', text: 'À bientôt !' }));
    } else if (view.endReason === 'stopped' || view.endReason === 'alone') {
      els.push(h('h2', { class: 'chalkfx', text: 'Partie terminée' }), h('p', { class: 'muted', text: view.endReason === 'alone' ? 'Tout le monde est parti. Bonne soirée !' : 'Bonne soirée à tous.' }));
    } else {
      const ranked = [...activePlayers()].sort((a, b) => b.flair - a.flair);
      const top = ranked.filter((p) => p.flair === ranked[0].flair);
      const winner = top.length > 1 ? `Égalité au sommet : ${listNames(top.map((p) => who(p.seat)))}.` : top[0].seat === me() ? 'Le Flair de la soirée : toi.' : `Le Flair de la soirée : ${top[0].name}.`;
      els.push(
        h('h2', { class: 'chalkfx', text: isGroup() ? 'Belle partie, la bande' : 'Belle partie, les complices' }),
        h('div', { class: 'tally' },
          ...ranked.map((p, i) => h('div', {}, h('span', { text: `${i + 1}. ${p.seat === me() ? `${p.name} (toi)` : p.name}` }), h('span', { text: `${p.flair}` }))),
          h('div', { class: 'sep' }, h('span', { text: 'Complicité' }), h('span', { text: `+${view.complicity}` })),
          h('div', {}, h('span', { text: 'Âmes jumelles' }), h('span', { text: String(view.soulmates) }))),
        h('p', { class: 'peerline chalkfx', text: winner }),
        h('p', { class: 'muted', text: 'Posez les téléphones et profitez de la soirée.' }));
    }
    if (!view.you.left) {
      els.push(h('button', { type: 'button', class: 'btn primary block', id: 'rematch', text: 'Revanche', onclick: (e) => { e.currentTarget.disabled = true; net.act('rematch'); }, disabled: activePlayers().filter((p) => p.connected).length < 2 }));
    }
    els.push(h('button', { type: 'button', class: 'btn ghost block', text: "Retour à l'accueil", onclick: () => go('/') }));
    stage.append(h('div', { class: 'end' }, els));
  }

  // ----- Stop -----
  function openStopSheet() {
    if (!view) return;
    const close = () => wrap.remove();
    const host = view.host === me();
    const group = isGroup();
    const items = [
      h('h3', { class: 'chalkfx', text: 'Une pause ?' }),
      h('p', { text: "Personne ne saura qui a appuyé. Rien n'est demandé, rien n'est jugé." }),
    ];
    if (view.level > 1 && ['pick', 'write', 'signal', 'reveal'].includes(view.phase)) {
      items.push(h('button', { type: 'button', class: 'btn primary block', id: 'lower', text: 'Redescendre en Doux', onclick: () => { net.act('lower'); close(); } }));
    }
    if (group) {
      items.push(h('button', { type: 'button', class: 'btn danger block', id: 'leave', text: 'Quitter la partie', onclick: () => { net.act('leave'); close(); } }));
      if (host && view.phase !== 'lobby') items.push(h('button', { type: 'button', class: 'btn ghost block', id: 'end-game', text: 'Terminer pour tout le monde', onclick: () => { net.act('stop'); close(); } }));
    } else {
      items.push(h('button', { type: 'button', class: 'btn danger block', id: 'end-game', text: 'Terminer la partie', onclick: () => { net.act('stop'); close(); } }));
    }
    items.push(h('button', { type: 'button', class: 'btn ghost block', text: 'Continuer', onclick: close }));
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Stop' }, items);
    const wrap = h('div', { class: 'sheet-wrap', onclick: (e) => { if (e.target === wrap) close(); } }, sheet);
    document.body.append(wrap);
    owned.push(wrap);
    sheet.querySelector('button')?.focus();
  }

  // ----- effets -----
  function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); sound.buzz([20, 30, 20]); }

  function dust(el) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    for (let n = 0; n < 14; n++) {
      const d = h('span', { class: 'dust' });
      const size = 2 + Math.random() * 5;
      d.style.width = `${size}px`; d.style.height = `${size}px`;
      d.style.left = `${r.left + Math.random() * r.width}px`;
      d.style.top = `${r.top + (Math.random() < 0.5 ? 0 : r.height)}px`;
      d.style.setProperty('--dx', `${(Math.random() - 0.5) * 60}px`);
      d.style.setProperty('--dy', `${(Math.random() - 0.5) * 50}px`);
      document.body.append(d);
      setTimeout(() => d.remove(), 1000);
    }
  }

  /** Une réaction s'envole depuis l'ardoise de celui qui l'envoie. */
  function floatEmoji(e, seat) {
    if (!REACTIONS.includes(e)) return;
    const mine = seat === me();
    const anchor = t ? (mine ? t.mySlate.root : t.peers[seat]?.root || stage) : stage;
    const r = anchor.getBoundingClientRect();
    const f = h('span', { class: `float${mine ? '' : ' down'}`, text: e, 'aria-hidden': 'true' });
    f.style.left = `${r.left + r.width * (0.3 + Math.random() * 0.4)}px`;
    f.style.top = `${r.top + (mine ? r.height / 2 : 10)}px`;
    document.body.append(f);
    setTimeout(() => f.remove(), 1500);
    if (!mine) sound.buzz(10);
  }

  return {
    destroy() {
      net.close();
      clearTimers();
      clearTimeout(idleTimer);
      owned.forEach((el) => el.remove());
      document.querySelectorAll('.sheet-wrap, .toast').forEach((el) => el.remove());
    },
  };
}

route();
