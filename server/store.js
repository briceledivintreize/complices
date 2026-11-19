// Banque de questions perso : seules les questions que le Meneur accepte de partager,
// anonymes (ni pseudo, ni partie, ni IP), et jamais les réponses.
// Les questions validées par l'équipe rejoignent ensuite les cartes du jeu.

import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS custom_questions (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  orientation  TEXT NOT NULL,
  mode         TEXT NOT NULL,
  level        SMALLINT NOT NULL,
  kind         TEXT NOT NULL,
  input        TEXT NOT NULL,
  text         TEXT NOT NULL,
  choices      JSONB,
  scale        JSONB,
  player_count SMALLINT,
  status       TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS custom_questions_created_idx ON custom_questions (created_at DESC);
CREATE INDEX IF NOT EXISTS custom_questions_status_idx ON custom_questions (status);
`;

export const STATUSES = ['pending', 'approved', 'rejected'];

/** On ne garde pas une question qui contient manifestement une donnée personnelle. */
export function looksPersonal(text) {
  return /@|https?:\/\/|www\.|(\d[\s.-]?){6,}/i.test(text);
}

function row(card, meta) {
  return {
    orientation: meta.orientation,
    mode: meta.mode,
    level: card.level,
    kind: card.kind,
    input: card.input,
    text: card.text,
    choices: card.choices || null,
    scale: card.scale || null,
    player_count: meta.playerCount ?? null,
  };
}

/** Transforme une question validée en carte jouable. */
export function toCard(q) {
  const card = {
    id: `cq-${q.id}`,
    level: q.level,
    kind: q.kind,
    input: q.input,
    where: 'any',
    players: q.kind === 'vote' ? 'group' : q.mode === 'duo' ? 'duo' : 'any',
    text: q.text,
    community: true,
  };
  if (q.choices) card.choices = q.choices;
  if (q.scale) card.scale = q.scale;
  return card;
}

/** Stockage Postgres (Neon). Sans DATABASE_URL, le stockage est désactivé et le jeu marche quand même. */
export function createStore(url = process.env.DATABASE_URL) {
  if (!url) return disabledStore();
  const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  pool.on('error', (e) => console.error('[db] connexion perdue :', e.message));
  let ready = null;
  const init = () => (ready ||= pool.query(SCHEMA).then(() => true).catch((e) => { ready = null; throw e; }));

  return {
    enabled: true,
    init,
    async save(card, meta) {
      if (looksPersonal(card.text) || (card.choices || []).some(looksPersonal)) return false;
      await init();
      const r = row(card, meta);
      await pool.query(
        `INSERT INTO custom_questions (orientation, mode, level, kind, input, text, choices, scale, player_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [r.orientation, r.mode, r.level, r.kind, r.input, r.text, r.choices && JSON.stringify(r.choices), r.scale && JSON.stringify(r.scale), r.player_count],
      );
      return true;
    },
    async list({ status, limit = 200 } = {}) {
      await init();
      const lim = Math.min(Math.max(1, Number(limit) || 200), 1000);
      const { rows } = status
        ? await pool.query('SELECT * FROM custom_questions WHERE status = $1 ORDER BY created_at DESC LIMIT $2', [status, lim])
        : await pool.query('SELECT * FROM custom_questions ORDER BY created_at DESC LIMIT $1', [lim]);
      return rows;
    },
    async setStatus(id, status) {
      await init();
      const { rowCount } = await pool.query('UPDATE custom_questions SET status = $1 WHERE id = $2', [status, id]);
      return rowCount === 1;
    },
    async approvedCards() {
      await init();
      const { rows } = await pool.query("SELECT * FROM custom_questions WHERE status = 'approved'");
      return rows;
    },
    async stats() {
      await init();
      const { rows } = await pool.query('SELECT status, count(*)::int AS n FROM custom_questions GROUP BY status');
      return Object.fromEntries(rows.map((x) => [x.status, x.n]));
    },
    close: () => pool.end(),
  };
}

function disabledStore() {
  return {
    enabled: false,
    init: async () => false,
    save: async () => false,
    list: async () => [],
    setStatus: async () => false,
    approvedCards: async () => [],
    stats: async () => ({}),
    close: async () => {},
  };
}

/** Stockage en mémoire, pour les tests. */
export function createMemoryStore() {
  const rows = [];
  let seq = 0;
  return {
    enabled: true,
    rows,
    init: async () => true,
    async save(card, meta) {
      if (looksPersonal(card.text) || (card.choices || []).some(looksPersonal)) return false;
      rows.push({ id: ++seq, created_at: new Date(), status: 'pending', ...row(card, meta) });
      return true;
    },
    list: async ({ status } = {}) => rows.filter((r) => !status || r.status === status),
    async setStatus(id, status) { const r = rows.find((x) => x.id === Number(id)); if (!r) return false; r.status = status; return true; },
    approvedCards: async () => rows.filter((r) => r.status === 'approved'),
    stats: async () => rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {}),
    close: async () => {},
  };
}
