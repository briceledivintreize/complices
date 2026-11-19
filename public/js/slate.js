// L'ardoise : saisir une réponse (texte, échelle, choix, défi, dessin) et l'afficher à la craie.

import { h } from './dom.js';
import * as sound from './sound.js';

export const KIND_LABEL = { truth: 'Vérité', bet: 'Pari', mirror: 'Miroir', dare: 'Action', vote: 'Vote' };
export const LEVELS = ['Doux', 'Piquant', 'Audacieux'];

/** Libellés des choix, du point de vue de celui qui écrit. Pour un vote : place → pseudo. */
export function labelsFor(card, writerRole, targetName, players = []) {
  if (card.kind === 'vote') return Object.fromEntries(players.map((p) => [p.seat, p.name]));
  if (card.kind === 'dare') {
    return writerRole === 'target' ? ['Je relève', 'Je passe'] : [`${targetName} relève`, `${targetName} passe`];
  }
  return card.choices || [];
}

export function chalkLine(c, x1, y1, x2, y2, color, w) {
  c.strokeStyle = color;
  c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const j = () => (Math.random() - 0.5) * w * 0.7;
    c.globalAlpha = 0.35 + Math.random() * 0.45;
    c.lineWidth = w * (0.55 + Math.random() * 0.6);
    c.beginPath();
    c.moveTo(x1 + j(), y1 + j());
    c.lineTo(x2 + j(), y2 + j());
    c.stroke();
  }
  c.globalAlpha = 1;
}

function fit(cv) {
  const w = cv.clientWidth;
  const hgt = cv.clientHeight;
  if (!w || !hgt) return null;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(hgt * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, hgt);
  return { c, w, h: hgt };
}

function drawStrokes(cv, strokes, color) {
  const o = fit(cv);
  if (!o) return null;
  const width = Math.max(2.5, o.w / 110);
  for (const s of strokes) {
    if (s.length === 2) chalkLine(o.c, s[0] * o.w, s[1] * o.h, s[0] * o.w + 0.5, s[1] * o.h + 0.5, color, width);
    for (let i = 2; i < s.length; i += 2) chalkLine(o.c, s[i - 2] * o.w, s[i - 1] * o.h, s[i] * o.w, s[i + 1] * o.h, color, width);
  }
  return o;
}

function inkColor(el, fallback) {
  const v = getComputedStyle(el).getPropertyValue('--mine-ink').trim();
  return v || fallback;
}

/** Redessine un canvas dès qu'il a une taille (et à chaque redimensionnement). */
function whenSized(cv, fn) {
  const ro = new ResizeObserver(() => { if (cv.clientWidth) fn(); });
  ro.observe(cv);
  return ro;
}

/**
 * Crée la zone d'écriture de mon ardoise.
 * @returns {{el: HTMLElement, getAnswer: () => object|null, clear: () => void, lock: () => void}}
 */
export function createInput({ card, input, role, peerName, players = [], me = null, onInk }) {
  const ink = (s) => onInk && onInk(s);

  if (input === 'text') {
    const ta = h('textarea', { class: 'ink chalkfx', id: 'slate-text', maxlength: 60, placeholder: 'Écris ici…', 'aria-label': 'Ta réponse', autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false', enterkeyhint: 'done' });
    const counter = h('span', { class: 'counter', text: '0 / 60' });
    ta.addEventListener('input', () => { sound.chalk(); ink('writing'); counter.textContent = `${ta.value.length} / 60`; });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ta.blur(); } });
    const el = h('div', {}, ta, counter);
    return {
      el,
      getAnswer: () => { const v = ta.value.replace(/\s+/g, ' ').trim(); return v ? { type: 'text', value: v } : null; },
      clear: () => { ta.value = ''; counter.textContent = '0 / 60'; ink('erasing'); ta.focus(); },
      lock: () => { ta.readOnly = true; },
    };
  }

  if (input === 'scale') {
    const { min = 1, max = 10, minLabel = '', maxLabel = '' } = card.scale || {};
    let value = null;
    let locked = false;
    const buttons = [];
    for (let n = min; n <= max; n++) {
      const b = h('button', { type: 'button', class: 'chalkbtn chalkfx', id: `slate-n${n}`, 'aria-pressed': 'false', text: String(n) });
      b.addEventListener('click', () => {
        if (locked) return;
        value = n;
        buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        sound.circle(); ink('writing');
      });
      buttons.push(b);
    }
    const el = h('div', { class: 'scale', role: 'group', 'aria-label': 'Entoure un chiffre' },
      h('div', { class: 'nums' }, buttons),
      h('div', { class: 'ends' }, h('span', { text: `${min} = ${minLabel}` }), h('span', { text: `${max} = ${maxLabel}` })));
    return {
      el,
      getAnswer: () => (value === null ? null : { type: 'scale', value }),
      clear: () => { value = null; buttons.forEach((x) => x.setAttribute('aria-pressed', 'false')); ink('erasing'); },
      lock: () => { locked = true; },
    };
  }

  if (input === 'player') {
    let value = null;
    let locked = false;
    const buttons = players.map((p) => {
      const b = h('button', { type: 'button', class: 'chalkbtn chalkfx', id: `slate-p${p.seat}`, 'aria-pressed': 'false', text: p.seat === me ? `${p.name} (moi)` : p.name });
      b.addEventListener('click', () => {
        if (locked) return;
        value = p.seat;
        buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        sound.circle(); ink('writing');
      });
      return b;
    });
    const el = h('div', { class: `optlist${players.length > 4 ? ' two-cols' : ''}`, role: 'group', 'aria-label': 'Désigne un joueur' }, buttons);
    return {
      el,
      getAnswer: () => (value === null ? null : { type: 'player', value }),
      clear: () => { value = null; buttons.forEach((x) => x.setAttribute('aria-pressed', 'false')); ink('erasing'); },
      lock: () => { locked = true; },
    };
  }

  if (input === 'choice' || input === 'dare') {
    const labels = labelsFor(card, role, peerName);
    let value = null;
    let locked = false;
    const buttons = labels.map((label, i) => {
      const b = h('button', { type: 'button', class: 'chalkbtn chalkfx', id: `slate-c${i}`, 'aria-pressed': 'false', text: label });
      b.addEventListener('click', () => {
        if (locked) return;
        value = i;
        buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        sound.circle(); ink('writing');
      });
      return b;
    });
    const el = h('div', { class: 'optlist', role: 'group', 'aria-label': 'Entoure ta réponse' }, buttons);
    return {
      el,
      getAnswer: () => (value === null ? null : { type: 'choice', value }),
      clear: () => { value = null; buttons.forEach((x) => x.setAttribute('aria-pressed', 'false')); ink('erasing'); },
      lock: () => { locked = true; },
    };
  }

  // Dessin au doigt
  const cv = h('canvas', { class: 'board', id: 'slate-draw', 'aria-label': 'Dessine au doigt sur ton ardoise' });
  const strokes = [];
  let points = 0;
  let current = null;
  let locked = false;
  let o = null;
  let color = '#9CCBEA';
  const redraw = () => { color = inkColor(cv, color); o = drawStrokes(cv, strokes, color); };
  const ro = whenSized(cv, redraw);
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  cv.addEventListener('pointerdown', (e) => {
    if (!o) redraw(); // le ResizeObserver n'a pas encore tourné (onglet en arrière-plan, rendu lent)
    if (locked || !o || strokes.length >= 200) return;
    e.preventDefault();
    const [x, y] = pos(e);
    current = [round(x), round(y)];
    strokes.push(current);
    points += 1;
    try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!current || points >= 3000) return;
    const [x, y] = pos(e);
    const px = current[current.length - 2];
    const py = current[current.length - 1];
    if (Math.hypot(x - px, y - py) < 0.006) return;
    current.push(round(x), round(y));
    points += 1;
    chalkLine(o.c, px * o.w, py * o.h, x * o.w, y * o.h, color, Math.max(2.5, o.w / 110));
    sound.chalk(); ink('writing');
  });
  const end = () => { current = null; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  return {
    el: cv,
    getAnswer: () => (strokes.length ? { type: 'draw', strokes: strokes.map((s) => s.slice()) } : null),
    clear: () => { strokes.length = 0; points = 0; redraw(); ink('erasing'); },
    lock: () => { locked = true; ro.disconnect(); },
  };
}

function round(x) { return Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000; }

/** Écrit une réponse à la craie sur une face d'ardoise. */
export function renderAnswer(face, answer, card, labels) {
  face.replaceChildren();
  if (answer.type === 'draw') {
    const cv = h('canvas', { class: 'board', 'aria-label': 'Dessin' });
    face.append(cv);
    const paint = () => drawStrokes(cv, answer.strokes, inkColor(cv, '#F1EEE4'));
    paint();
    whenSized(cv, paint);
    return;
  }
  const box = h('div', { class: 'written chalkfx' });
  if (answer.type === 'skip') {
    box.classList.add('skip');
    box.textContent = "s'abstient";
  } else if (answer.type === 'player') {
    box.textContent = labels[answer.value] ?? '?';
  } else if (answer.type === 'scale') {
    const max = card.scale?.max ?? 10;
    box.append(h('span', { class: 'big', text: String(answer.value) }), h('span', { class: 'unit', text: `sur ${max}` }));
  } else if (answer.type === 'choice') {
    box.textContent = labels[answer.value] ?? '?';
  } else {
    box.textContent = answer.value;
  }
  face.append(box);
}
