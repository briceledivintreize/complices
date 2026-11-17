import { readFileSync } from 'node:fs';
import path from 'node:path';

const KINDS = new Set(['truth', 'bet', 'mirror', 'dare']);
const INPUTS = new Set(['text', 'scale', 'choice', 'draw']);
const WHERES = new Set(['any', 'together', 'remote']);

export function validCard(c) {
  if (!c || typeof c !== 'object') return false;
  if (typeof c.id !== 'string' || typeof c.text !== 'string' || !c.text.trim()) return false;
  if (![1, 2, 3].includes(c.level) || !KINDS.has(c.kind) || !INPUTS.has(c.input) || !WHERES.has(c.where)) return false;
  if (c.input === 'choice' && c.kind !== 'dare') {
    if (!Array.isArray(c.choices) || c.choices.length < 2 || c.choices.length > 4) return false;
  }
  if (c.input === 'scale' && c.kind !== 'dare') {
    const s = c.scale;
    if (!s || !Number.isInteger(s.min) || !Number.isInteger(s.max) || s.min >= s.max) return false;
  }
  if (c.kind === 'bet' && !['scale', 'choice'].includes(c.input)) return false;
  return true;
}

/** Charge les trois decks. Une carte invalide est ignorée avec un avertissement. */
export function loadDecks(dir) {
  const out = {};
  for (const name of ['romance', 'friendship', 'interests']) {
    const file = path.join(dir, `${name}.json`);
    try {
      const cards = JSON.parse(readFileSync(file, 'utf8'));
      const ok = cards.filter(validCard);
      const bad = cards.length - ok.length;
      if (bad) console.warn(`[decks] ${name} : ${bad} carte(s) invalide(s) ignorée(s)`);
      const ids = new Set();
      out[name] = ok.filter((c) => (ids.has(c.id) ? false : ids.add(c.id)));
    } catch (e) {
      console.warn(`[decks] impossible de lire ${file} : ${e.message}`);
      out[name] = [];
    }
  }
  return out;
}
