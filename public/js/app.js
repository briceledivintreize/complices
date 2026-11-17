// Complices : écrans de l'application (accueil, invitation, partie).

import { h, scribble, setScribble } from './dom.js';
import { Net } from './net.js';
import * as sound from './sound.js';
import { createInput, renderAnswer, labelsFor, KIND_LABEL, LEVELS } from './slate.js';

const app = document.getElementById('app');

// sessionStorage d'abord : deux onglets du même navigateur peuvent jouer les deux rôles sans se mélanger.
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
  { id: 'romance', label: 'Drague / couple', desc: 'Séduction, tendresse, frissons. Jamais explicite.', age: 18 },
  { id: 'friendship', label: 'Amitié', desc: 'Fous rires, souvenirs et mauvaise foi assumée.', age: 16 },
  { id: 'interests', label: "Centres d'intérêt", desc: 'Goûts, valeurs, rêves : pour se découvrir.', age: 16 },
];
const LEVEL_DESC = {
  romance: ['Tendresse et complicité', 'Ça chauffe un peu', 'Frissons, jamais explicite'],
  friendship: ['Fous rires garantis', 'Mauvaise foi assumée', "Ce qu'on ne se dit jamais"],
  interests: ['Tes goûts', 'Tes opinions', 'Tes rêves et tes peurs'],
};
const REACTIONS = ['😂', '😳', '❤️', '🤯', '🔥', '👏'];

// Élision : « l'ardoise d'Inès », « ce qu'Inès va répondre ».
const VOWEL = /^[aeiouyhàâäéèêëîïôöûüœ]/i;
const de = (name) => (VOWEL.test(name) ? `d'${name}` : `de ${name}`);
const que = (name) => (VOWEL.test(name) ? `qu'${name}` : `que ${name}`);

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

function optionButtons(items, selected, onPick) {
  const buttons = items.map((it) => h('button', {
    type: 'button', class: 'opt', id: `opt-${it.id}`, 'aria-pressed': String(it.id === selected),
    onclick: () => { buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btnOf(it)))); onPick(it.id); sound.circle(); },
  }, it.badge ? h('span', { class: 'badge', text: it.badge }) : null, h('b', { text: it.label }), h('span', { text: it.desc })));
  const btnOf = (it) => buttons[items.indexOf(it)];
  return buttons;
}

// ---------- accueil ----------

function homeScreen() {
  const state = { orientation: 'romance', where: 'remote' };
  const name = h('input', { class: 'input', id: 'name', maxlength: 20, autocomplete: 'nickname', placeholder: 'Ton pseudo', value: store.get('name') || '' });
  const ageText = h('span');
  const age = h('input', { type: 'checkbox', id: 'age' });
  const error = h('p', { class: 'error', role: 'alert' });
  const setAge = () => {
    const o = ORIENTATIONS.find((x) => x.id === state.orientation);
    ageText.textContent = `J'ai ${o.age} ans ou plus.`;
  };
  setAge();

  const create = h('button', { type: 'submit', class: 'btn primary block', id: 'create', text: 'Créer la partie' });
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { text: 'Ton pseudo' }), name),
    h('div', { class: 'field' }, h('span', { text: 'Votre jeu' }),
      h('div', { class: 'choices three' }, optionButtons(ORIENTATIONS.map((o) => ({ ...o, badge: `${o.age}+` })), state.orientation, (id) => { state.orientation = id; setAge(); }))),
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
    if (!pseudo) { error.textContent = 'Choisis un pseudo pour que ton ou ta complice te reconnaisse.'; name.focus(); return; }
    if (!age.checked) { error.textContent = `Ce jeu est réservé aux ${ORIENTATIONS.find((x) => x.id === state.orientation).age} ans et plus.`; return; }
    create.disabled = true;
    try {
      const r = await api('/api/rooms', { name: pseudo, orientation: state.orientation, where: state.where, ageOk: true });
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
      h('span', { class: 'eyebrow', text: 'Jeux à deux' }),
      h('h1', { class: 'chalkfx', text: 'Complices' }),
      h('p', { text: "Chacun écrit sur son ardoise, et au signal, vous montrez vos cartes en même temps. Un lien suffit pour inviter l'autre." })),
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
    const accept = h('button', { type: 'submit', class: 'btn primary block', id: 'accept', text: 'Accepter la partie' });
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
    app.append(
      h('header', { class: 'hero' }, h('span', { class: 'eyebrow', text: 'Complices' }), h('h1', { class: 'chalkfx', text: 'Invitation' })),
      h('div', { class: 'invite-card' },
        h('span', { class: 'kind', text: `${info.orientationLabel} · ${info.whereLabel}` }),
        h('p', { text: `${info.hostName} t'invite à jouer.` }),
        h('span', { class: 'hint', text: `Niveau maximal : ${info.levelMax}. Vous réglez chacun votre curseur en secret, et la partie prend le niveau le plus bas des deux.` })),
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
  const root = h('div', { class: `slate ${kind}` }, h('span', { class: 'tag', text: label }), inner);
  return { root, inner, front, back };
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
  let peerInk = 'idle';
  let timers = [];
  const owned = [];          // éléments ajoutés hors de #app

  const later = (ms, fn) => { const id = setTimeout(fn, Math.max(0, ms)); timers.push(id); return id; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; document.querySelectorAll('.signal').forEach((s) => s.remove()); };

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

  // Encre sortante : l'autre voit seulement que ma craie bouge.
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
      if (m.t === 'peer_ink') { peerInk = m.state; if (t) updateTable(); }
      else if (m.t === 'react') floatEmoji(m.emoji, 'down');
      else if (m.t === 'error') {
        toast(m.message);
        if (t && view) updateTable();
        if (t && m.code === 'empty') shake(t.mySlate.root);
      }
    },
    onStatus(s) {
      if (s === 'online') { banner.hidden = true; return; }
      if (s === 'offline') { banner.hidden = false; banner.textContent = 'Connexion perdue. Reconnexion…'; return; }
      clearTimers();
      stage.replaceChildren(
        h('h2', { class: 'chalkfx', text: s === 'gone' ? 'Partie terminée' : 'Partie ouverte ailleurs' }),
        h('p', { class: 'muted', text: s === 'gone' ? "Cette partie n'existe plus sur le serveur. Lancez-en une nouvelle." : 'Cette partie est ouverte dans un autre onglet ou sur un autre appareil.' }),
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
    const peer = view.peer?.name || 'Ton ou ta complice';
    if (n.type === 'joined') { toast(`${peer} a rejoint la partie !`); sound.joined(); sound.buzz([30, 40, 30]); }
    if (n.type === 'level_agreed') toast(`Niveau de la partie : ${view.levelLabel}. Personne ne sait qui a choisi quoi.`);
    if (n.type === 'lowered') toast('La partie redescend en Doux.');
  }

  function renderTop() {
    const p = view.phase;
    roundEl.textContent = p === 'lobby' ? "Salle d'attente" : p === 'negotiate' ? 'Réglages' : p === 'end' ? 'Fin de partie'
      : `Tour ${view.roundNo} / ${view.rules.roundsMax} · ${view.levelLabel}`;
    scoreEl.replaceChildren();
    if (view.peer && p !== 'lobby' && p !== 'negotiate') {
      scoreEl.append(`Toi ${view.you.flair} · `, h('span', { class: 'peer', text: `${view.peer.name} ${view.peer.flair}` }));
    }
    stopBtn.hidden = p === 'lobby' || p === 'end';
  }

  function renderCover() {
    const off = view.peer && !view.peer.connected && !['lobby', 'end'].includes(view.phase);
    cover.hidden = !off;
    if (off) coverText.textContent = `${view.peer.name} a perdu la connexion. La partie reprend dès son retour.`;
  }

  function renderStage() {
    const p = view.phase;
    let k;
    if (p === 'reveal' && !view.round.card) k = `passed-${view.roundNo}`;
    else if (['write', 'signal', 'reveal'].includes(p)) k = `table-${view.roundNo}`;
    else if (p === 'pick') k = `pick-${view.roundNo}-${(view.round.options || []).map((c) => c.id).join(',')}`;
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
      else { peerInk = 'idle'; buildTable(); }
    }
    if (p === 'negotiate') updateNegotiate();
    if (t) updateTable();
  }

  // ----- salle d'attente -----
  function buildLobby() {
    const els = [
      h('h2', { class: 'chalkfx', text: 'Invite ton ou ta complice' }),
      h('p', { class: 'muted', text: 'Envoie ce lien. Dès que la personne accepte, la partie commence.' }),
    ];
    if (invite) {
      const linkBox = h('input', { class: 'linkbox', id: 'invite-link', readonly: true, value: invite.link, 'aria-label': "Lien d'invitation" });
      const copy = h('button', { type: 'button', class: 'btn primary grow', id: 'copy', text: 'Copier le lien' });
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(invite.link); toast('Lien copié. Colle-le dans WhatsApp, Messenger ou SMS.'); }
        catch { linkBox.select(); try { document.execCommand('copy'); toast('Lien copié.'); } catch { toast('Sélectionne le lien et copie-le.'); } }
      });
      const row = h('div', { class: 'row' }, copy);
      if (navigator.share) {
        row.prepend(h('button', {
          type: 'button', class: 'btn ghost', id: 'share', text: 'Partager',
          onclick: () => navigator.share({ title: 'Complices', text: `${view.you.name} t'invite à jouer à Complices`, url: invite.link }).catch(() => {}),
        }));
      }
      els.push(
        h('img', { class: 'qr', src: invite.qr, alt: "QR code de l'invitation", width: 190, height: 190 }),
        h('p', { class: 'code chalkfx', text: invite.code }),
        linkBox, row);
    }
    const waiting = makeSlate('peer', 'Son ardoise');
    waiting.inner.classList.add('turned');
    waiting.back.append(h('span', { class: 'monogram chalkfx', text: '?' }), scribble(), h('span', { class: 'status', text: 'En attente de ton ou ta complice…' }));
    els.push(waiting.root, h('p', { class: 'small muted', text: "Le lien ne sert qu'une fois et expire dans 24 h. Sur place, l'autre peut scanner le QR code ou taper le code sur l'accueil." }));
    stage.append(...els);
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
      h('p', { class: 'muted', text: 'La partie prendra le niveau le plus bas des deux. Personne ne saura qui a choisi quoi.' }),
      h('div', { class: 'levels' }, levelButtons),
      peerLine,
      h('p', { class: 'small muted', text: "Pendant la partie, le bouton Stop permet de redescendre en Doux à tout moment, sans que l'autre sache que c'est toi." }));
  }
  function updateNegotiate() {
    const mine = view.you.myLevel;
    if (mine) levelButtons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === mine - 1)));
    const peer = view.peer?.name;
    if (peerLine && peer) peerLine.textContent = view.peer.levelSet ? `${peer} a réglé son curseur ✓` : `${peer} règle son curseur…`;
  }

  // ----- tirage -----
  function buildPick() {
    const r = view.round;
    const peer = view.peer.name;
    if (r.role === 'leader') {
      const cards = r.options.map((card) => h('button', {
        type: 'button', class: 'pickcard', id: `card-${card.id}`,
        onclick: (e) => { cards.forEach((c) => { c.disabled = true; }); e.currentTarget.classList.add('chosen'); net.act('pick', { cardId: card.id }); sound.pose(); },
      },
      h('div', { class: 'meta' }, h('span', { class: 'kind', text: KIND_LABEL[card.kind] }), h('span', { text: `${LEVELS[card.level - 1]} · ${inputHint(card)}` })),
      h('p', { text: card.text }),
      h('span', { class: 'small', text: kindHint(card, peer) })));
      stage.append(
        h('h2', { class: 'chalkfx', text: 'Tu es le Meneur' }),
        h('p', { class: 'muted', text: `Choisis une carte pour ${peer}.` }),
        h('div', { class: 'fan' }, cards),
        h('button', { type: 'button', class: 'btn link', id: 'pass-pick', text: 'Aucune ne me plaît : passer', onclick: () => net.act('pass') }));
    } else {
      const s = makeSlate('peer', `L'ardoise ${de(peer)}`);
      s.inner.classList.add('turned');
      s.back.append(h('span', { class: 'monogram chalkfx', text: 'C' }), scribble(), h('span', { class: 'status', text: `${peer} choisit une carte pour toi…` }));
      stage.append(s.root,
        h('h2', { class: 'chalkfx', text: 'Prépare ta craie' }),
        h('p', { class: 'muted', text: `Ce tour-ci, ${peer} est le Meneur et toi la Cible.` }));
    }
  }

  function inputHint(card) {
    if (card.kind === 'dare') return 'défi';
    return { text: 'réponse écrite', scale: 'échelle', choice: 'choix', draw: 'dessin' }[card.input];
  }
  function kindHint(card, peer) {
    if (card.kind === 'mirror') return 'Vous répondez tous les deux, chacun pour soi.';
    if (card.kind === 'dare') return `${peer} relève le défi ou passe. Toi, tu paries.`;
    return `${peer} répond pour de vrai. Toi, tu paries sur sa réponse.`;
  }
  function promptFor(r, peer) {
    const k = r.card.kind;
    if (k === 'mirror') return 'Miroir : répondez chacun pour vous. Âmes jumelles si vos ardoises sont pareilles.';
    if (k === 'dare') return r.role === 'target' ? 'Défi pour toi : tu le relèves ou tu passes ?' : `Défi pour ${peer}. Ton pari : relève ou passe ?`;
    return r.role === 'target' ? `Réponds pour de vrai. ${peer} parie sur ta réponse.` : `Pari : écris ce ${que(peer)} va répondre.`;
  }

  // ----- la table : écrire, signal, révélation -----
  function buildTable() {
    const r = view.round;
    const peer = view.peer.name;
    const peerSlate = makeSlate('peer', `L'ardoise ${de(peer)}`);
    peerSlate.inner.classList.add('turned');
    const scrib = scribble();
    const pStatus = h('span', { class: 'status', role: 'status' });
    peerSlate.back.append(h('span', { class: 'monogram chalkfx', text: 'C' }), scrib, pStatus);

    const master = h('div', { class: 'master' },
      h('span', { class: 'kind', text: `${KIND_LABEL[r.card.kind]} · ${LEVELS[r.card.level - 1]}` }),
      h('p', { class: 'q', text: r.card.text }),
      h('span', { class: 'hint', text: promptFor(r, peer) }));

    const mySlate = makeSlate('mine', 'Mon ardoise');
    const input = createInput({ card: r.card, input: r.input, role: r.role, peerName: peer, onInk: inkOut });
    mySlate.front.append(input.el);
    if (r.myAnswer) renderAnswer(mySlate.front, r.myAnswer, r.card, labelsFor(r.card, r.role, r.role === 'leader' ? peer : view.you.name));
    mySlate.back.append(
      h('span', { class: 'monogram chalkfx', text: 'C' }),
      h('span', { class: 'status', text: 'Ta carte est tournée' }),
      h('span', { class: 'substatus', text: `${peer} ne voit que le dos de ton ardoise.` }),
      h('button', { type: 'button', class: 'btn ghost', id: 'unpose', text: 'Reprendre la craie', onclick: () => { net.act('unpose'); mySlate.inner.classList.remove('turned'); } }));

    const tools = h('div', { class: 'tools' },
      h('button', { type: 'button', class: 'btn ghost', id: 'sponge', text: 'Éponge', onclick: () => { input.clear(); sound.sponge(); sound.buzz(20); } }),
      h('button', {
        type: 'button', class: 'btn primary', id: 'pose', text: 'Poser la craie',
        onclick: () => {
          const a = input.getAnswer();
          if (!a) { shake(mySlate.root); toast('Ton ardoise est vide. Écris quelque chose, ou passe la carte.'); return; }
          document.activeElement?.blur?.();
          mySlate.inner.classList.add('turned');
          tools.hidden = true;
          net.act('pose', { answer: a });
          sound.pose(); sound.buzz(15);
        },
      }),
      h('button', { type: 'button', class: 'btn link', id: 'pass', text: 'Passer', onclick: () => net.act('pass') }));
    const waiting = h('p', { class: 'wait chalkfx', hidden: true, role: 'status' });

    const verdictEl = h('div', { class: 'verdict chalkfx', role: 'status' });
    const judgeEl = h('div', { class: 'judge', hidden: true });
    const reacts = h('div', { class: 'reacts', role: 'group', 'aria-label': 'Réagir' },
      REACTIONS.map((e) => h('button', { type: 'button', 'aria-label': `Réagir ${e}`, text: e, onclick: () => { net.send({ t: 'react', emoji: e }); floatEmoji(e, 'up'); sound.pop(); sound.buzz(10); } })));
    const nextBtn = h('button', { type: 'button', class: 'btn primary block', id: 'next', onclick: (e) => { e.currentTarget.disabled = true; net.act('next'); } });
    const after = h('div', { class: 'after', hidden: true }, verdictEl, judgeEl, reacts, nextBtn);

    stage.append(peerSlate.root, master, mySlate.root, tools, waiting, after);
    t = { peerSlate, mySlate, input, tools, waiting, after, verdictEl, judgeEl, reacts, nextBtn, scrib, pStatus, revealed: false, countdown: false, peerWasPosed: false, judgeKey: null };
  }

  function updateTable() {
    const r = view.round;
    const p = view.phase;
    const peer = view.peer.name;

    if (p === 'write') {
      t.mySlate.inner.classList.toggle('turned', r.myPosed);
      t.tools.hidden = r.myPosed;
      t.waiting.hidden = !r.myPosed;
      t.waiting.textContent = r.peerPosed ? 'Les deux craies sont posées…' : `En attente ${de(peer)}…`;
      if (r.peerPosed) {
        setScribble(t.scrib, 'done');
        t.pStatus.textContent = `${peer} a posé sa craie ✓`;
        if (!t.peerWasPosed) { sound.peerReady(); sound.buzz(10); }
      } else {
        const [txt, st] = { writing: [`${peer} écrit…`, 'writing'], erasing: [`${peer} efface…`, 'erase'], idle: [`${peer} réfléchit…`, 'idle'] }[peerInk] || [`${peer} réfléchit…`, 'idle'];
        setScribble(t.scrib, st);
        t.pStatus.textContent = txt;
      }
      t.peerWasPosed = r.peerPosed;
      return;
    }

    if (p === 'signal') {
      t.mySlate.inner.classList.add('turned');
      t.tools.hidden = true;
      t.waiting.hidden = false;
      t.waiting.textContent = 'Le Maître va donner le signal…';
      setScribble(t.scrib, 'done');
      t.pStatus.textContent = `${peer} a posé sa craie ✓`;
      startCountdown();
      return;
    }

    // reveal
    if (r.outcome === 'played') {
      if (!t.revealed) { clearTimers(); reveal(); }
    } else {
      setScribble(t.scrib, 'done');
      t.pStatus.textContent = 'Carte passée';
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
    const peer = view.peer.name;
    const me = view.you.name;
    const peerRole = r.role === 'leader' ? 'target' : 'leader';
    if (r.peerAnswer) renderAnswer(t.peerSlate.front, r.peerAnswer, r.card, labelsFor(r.card, peerRole, peerRole === 'target' ? peer : me));
    if (r.myAnswer) renderAnswer(t.mySlate.front, r.myAnswer, r.card, labelsFor(r.card, r.role, r.role === 'leader' ? peer : me));
    t.input.lock();
    t.peerSlate.inner.classList.remove('turned');
    t.mySlate.inner.classList.remove('turned');
    t.tools.hidden = true;
    t.waiting.hidden = true;
    setTimeout(() => {
      if (!t) return;
      t.peerSlate.root.classList.add('lifted');
      t.mySlate.root.classList.add('lifted');
      dust(t.peerSlate.root); dust(t.mySlate.root);
      sound.lift();
    }, 120);
  }

  function showAfter() {
    const r = view.round;
    const v = verdictFor(view);
    t.verdictEl.replaceChildren(v.title, h('small', { text: v.sub }));
    t.after.hidden = false;
    t.reacts.hidden = r.outcome !== 'played';

    const jk = `${r.canJudge}`;
    if (t.judgeKey !== jk) {
      t.judgeKey = jk;
      t.judgeEl.replaceChildren();
      if (r.canJudge) {
        const labels = r.card.kind === 'mirror' ? ['Pareil', 'Proche', 'Différent'] : ['Vu juste', 'Presque', 'Raté'];
        ['exact', 'close', 'miss'].forEach((verdict, i) => t.judgeEl.append(h('button', {
          type: 'button', class: i === 0 ? 'btn primary' : 'btn ghost', id: `judge-${verdict}`, text: labels[i],
          onclick: () => { t.judgeEl.querySelectorAll('button').forEach((b) => { b.disabled = true; }); net.act('judge', { verdict }); },
        })));
      }
    }
    t.judgeEl.hidden = !r.canJudge;
    const canNext = r.outcome !== 'played' || !r.needsJudge || Boolean(r.verdict);
    t.nextBtn.hidden = !canNext;
    t.nextBtn.textContent = view.roundNo >= view.rules.roundsMax ? 'Voir le bilan' : 'Tour suivant';
  }

  function verdictFor(v) {
    const r = v.round;
    const peer = v.peer.name;
    const lead = r.role === 'leader';
    if (r.outcome === 'passed') return { title: 'Carte passée', sub: 'Aucun point en jeu, aucune explication à donner.' };
    if (r.outcome === 'lowered') return { title: 'On redescend en Doux', sub: 'La carte en cours est retirée. La suite sera plus douce.' };
    const res = r.auto || r.verdict;
    if (r.card.kind === 'dare') {
      const acc = r.dareAccepted;
      const title = acc ? (lead ? `${peer} relève le défi !` : 'Tu relèves le défi !') : (lead ? `${peer} passe ce défi` : 'Tu passes ce défi');
      let sub = res === 'exact'
        ? (lead ? "Tu l'avais vu venir : +3 Flair." : `${peer} l'avait vu venir : +3 Flair.`)
        : (lead ? 'Ton pari était faux.' : `${peer} avait parié autre chose.`);
      if (acc) sub += lead ? ` ${peer} gagne +2 Flair. Place au spectacle !` : ' +2 Flair pour toi. À toi de jouer, maintenant !';
      return { title, sub };
    }
    if (r.card.kind === 'mirror') {
      if (!res) return { title: 'Comparez vos ardoises', sub: r.canJudge ? 'Vos réponses sont-elles pareilles ? À toi de juger.' : `${peer} compare vos ardoises…` };
      if (res === 'exact') return { title: 'Âmes jumelles !', sub: 'Même réponse : +2 Flair chacun et un bonus de complicité.' };
      if (res === 'close') return { title: 'Presque pareil', sub: "+1 Flair chacun. Écho : qu'est-ce qui vous sépare ?" };
      return { title: 'Deux versions', sub: 'Écho : chacun raconte pourquoi il a écrit ça.' };
    }
    const played = lead ? `${peer} gagne +2 Flair pour avoir joué.` : '+2 Flair pour toi : tu as joué le jeu.';
    if (!res) return { title: 'Alors, ce pari ?', sub: r.canJudge ? `${peer} a parié sur ta réponse. Verdict ?` : `${peer} juge ton pari…` };
    if (res === 'exact') return { title: lead ? 'Pari exact !' : `${peer} a vu juste !`, sub: `${lead ? '+3 Flair pour toi.' : `+3 Flair pour ${peer}.`} ${played}` };
    if (res === 'close') return { title: 'À un cheveu !', sub: `${lead ? '+1 Flair pour toi.' : `+1 Flair pour ${peer}.`} ${played}` };
    return { title: lead ? 'Pari raté !' : `Raté pour ${peer} !`, sub: `Écho : demande pourquoi. ${played}` };
  }

  // Le tirage entier a été passé (ou retiré en redescendant en Doux) avant le choix d'une carte.
  function buildPassed() {
    const lowered = view.round.outcome === 'lowered';
    stage.append(h('div', { class: 'after' },
      h('div', { class: 'verdict chalkfx' }, lowered ? 'On redescend en Doux' : 'Tirage passé',
        h('small', { text: lowered ? 'La suite sera plus douce.' : 'Aucun point en jeu, aucune explication à donner.' })),
      h('button', { type: 'button', class: 'btn primary block', id: 'next', text: view.roundNo >= view.rules.roundsMax ? 'Voir le bilan' : 'Tour suivant', onclick: (e) => { e.currentTarget.disabled = true; net.act('next'); } })));
  }

  // ----- fin -----
  function buildEnd() {
    const peer = view.peer?.name || 'ton ou ta complice';
    const els = [];
    if (view.endReason === 'stopped') {
      els.push(h('h2', { class: 'chalkfx', text: 'Partie terminée' }), h('p', { class: 'muted', text: 'Bonne soirée à vous deux.' }));
    } else {
      const me = view.you.flair;
      const them = view.peer.flair;
      const winner = me === them ? 'Égalité parfaite. Vous vous lisez aussi bien l’un que l’autre.' : me > them ? 'Le Flair de la soirée : toi.' : `Le Flair de la soirée : ${peer}.`;
      els.push(
        h('h2', { class: 'chalkfx', text: 'Belle partie, les complices' }),
        h('div', { class: 'tally' },
          h('div', {}, h('span', { text: 'Ton Flair' }), h('span', { text: String(me) })),
          h('div', {}, h('span', { text: `Flair ${de(peer)}` }), h('span', { text: String(them) })),
          h('div', {}, h('span', { text: 'Complicité du duo' }), h('span', { text: `+${view.complicity}` })),
          h('div', {}, h('span', { text: 'Âmes jumelles' }), h('span', { text: String(view.soulmates) }))),
        h('p', { class: 'peerline chalkfx', text: winner }),
        h('p', { class: 'muted', text: 'Posez les téléphones et profitez de la soirée.' }));
    }
    els.push(
      h('button', { type: 'button', class: 'btn primary block', id: 'rematch', text: 'Revanche', onclick: (e) => { e.currentTarget.disabled = true; net.act('rematch'); }, disabled: !view.peer?.connected }),
      h('button', { type: 'button', class: 'btn ghost block', text: "Retour à l'accueil", onclick: () => go('/') }));
    stage.append(h('div', { class: 'end' }, els));
  }

  // ----- Stop -----
  function openStopSheet() {
    if (!view) return;
    const close = () => wrap.remove();
    const items = [
      h('h3', { class: 'chalkfx', text: 'Une pause ?' }),
      h('p', { text: "Personne ne saura qui a appuyé. Rien n'est demandé, rien n'est jugé." }),
    ];
    if (view.level > 1 && ['pick', 'write', 'signal', 'reveal'].includes(view.phase)) {
      items.push(h('button', { type: 'button', class: 'btn primary block', id: 'lower', text: 'Redescendre en Doux', onclick: () => { net.act('lower'); close(); } }));
    }
    items.push(
      h('button', { type: 'button', class: 'btn danger block', id: 'end-game', text: 'Terminer la partie', onclick: () => { net.act('stop'); close(); } }),
      h('button', { type: 'button', class: 'btn ghost block', text: 'Continuer', onclick: close }));
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
    for (let n = 0; n < 16; n++) {
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

  function floatEmoji(e, dir) {
    if (!REACTIONS.includes(e)) return;
    const anchor = t ? (dir === 'down' ? t.peerSlate.root : t.mySlate.root) : stage;
    const r = anchor.getBoundingClientRect();
    const f = h('span', { class: `float${dir === 'down' ? ' down' : ''}`, text: e, 'aria-hidden': 'true' });
    f.style.left = `${r.left + r.width * (0.3 + Math.random() * 0.4)}px`;
    f.style.top = `${r.top + (dir === 'down' ? 10 : r.height / 2)}px`;
    document.body.append(f);
    setTimeout(() => f.remove(), 1500);
    if (dir === 'down') sound.buzz(10);
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
