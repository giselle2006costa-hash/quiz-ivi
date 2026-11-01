import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export function openDb(file = config.dbPath) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      notes        TEXT NOT NULL DEFAULT '',
      start_at     TEXT,                 -- ISO UTC; NULL = tarefa sem horario
      due_date     TEXT,                 -- YYYY-MM-DD para tarefas sem horario
      duration_min INTEGER NOT NULL DEFAULT 30,
      remind_min   INTEGER NOT NULL DEFAULT 15,
      priority     INTEGER NOT NULL DEFAULT 2,   -- 1 alta, 2 media, 3 baixa
      kind         TEXT NOT NULL DEFAULT 'task',   -- event | task | note
      category_id  INTEGER,
      done         INTEGER NOT NULL DEFAULT 0,
      reminded     INTEGER NOT NULL DEFAULT 0,
      outlook_id   TEXT,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS categories (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
      color TEXT NOT NULL DEFAULT '#6b7280'
    );
  `);
  // bancos criados antes da coluna kind
  if (!db.prepare('PRAGMA table_info(items)').all().some((c) => c.name === 'kind')) {
    db.exec("ALTER TABLE items ADD COLUMN kind TEXT NOT NULL DEFAULT 'task'");
    db.exec("UPDATE items SET kind='event' WHERE start_at IS NOT NULL");
  }
  if (!db.prepare('PRAGMA table_info(items)').all().some((c) => c.name === 'category_id')) {
    db.exec('ALTER TABLE items ADD COLUMN category_id INTEGER');
  }
  // categorias iniciais, uma unica vez (se voce apagar, elas nao voltam)
  if (!db.prepare("SELECT v FROM kv WHERE k='cats_seeded'").get()) {
    const ins = db.prepare('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)');
    for (const [n, c] of [['PUC Campinas', '#2f6fa8'], ['UNESP', '#3b6e5c'], ['CBEVET', '#7a4fa0']]) ins.run(n, c);
    db.prepare("INSERT INTO kv (k, v) VALUES ('cats_seeded', '1')").run();
  }
  return db;
}

const SELECT = `SELECT items.*, c.name AS category, c.color AS category_color
  FROM items LEFT JOIN categories c ON c.id = items.category_id`;

export const store = (db) => ({
  list: () => db.prepare(`${SELECT} ORDER BY items.done, COALESCE(items.start_at, items.due_date), items.priority`).all(),
  get: (id) => db.prepare(`${SELECT} WHERE items.id = ?`).get(id),
  create(i) {
    const r = db.prepare(
      `INSERT INTO items (title, notes, start_at, due_date, duration_min, remind_min, priority, kind, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(i.title, i.notes ?? '', i.start_at ?? null, i.due_date ?? null,
      i.duration_min ?? 30, i.remind_min ?? 15, i.priority ?? 2,
      i.kind ?? (i.start_at ? 'event' : 'task'), i.category_id ?? null);
    return this.get(Number(r.lastInsertRowid));
  },
  update(id, patch) {
    const cur = this.get(id);
    if (!cur) return null;
    const n = { ...cur, ...patch };
    // mudou horario => lembrete volta a valer
    const reminded = patch.start_at !== undefined || patch.remind_min !== undefined ? 0 : n.reminded;
    db.prepare(
      `UPDATE items SET title=?, notes=?, start_at=?, due_date=?, duration_min=?, remind_min=?,
       priority=?, kind=?, category_id=?, done=?, reminded=?, outlook_id=? WHERE id=?`
    ).run(n.title, n.notes, n.start_at, n.due_date, n.duration_min, n.remind_min,
      n.priority, n.kind, n.category_id ?? null, n.done ? 1 : 0, reminded, n.outlook_id, id);
    return this.get(id);
  },
  remove: (id) => db.prepare('DELETE FROM items WHERE id = ?').run(id),
  dueReminders: (nowIso) => db.prepare(
    `${SELECT} WHERE items.done=0 AND items.reminded=0 AND items.start_at IS NOT NULL
     AND datetime(items.start_at, '-' || items.remind_min || ' minutes') <= datetime(?)
     AND datetime(items.start_at, '+' || items.duration_min || ' minutes') > datetime(?)`
  ).all(nowIso, nowIso),
  markReminded: (id) => db.prepare('UPDATE items SET reminded=1 WHERE id=?').run(id),
  kvGet: (k) => db.prepare('SELECT v FROM kv WHERE k=?').get(k)?.v,
  kvSet: (k, v) => db.prepare('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v),
  cats: () => db.prepare('SELECT * FROM categories ORDER BY name COLLATE NOCASE').all(),
  catGet: (id) => db.prepare('SELECT * FROM categories WHERE id = ?').get(id),
  catCreate(name, color) {
    const r = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run(name, color);
    return this.catGet(Number(r.lastInsertRowid));
  },
  catUpdate(id, patch) {
    const cur = this.catGet(id);
    if (!cur) return null;
    db.prepare('UPDATE categories SET name=?, color=? WHERE id=?').run(patch.name ?? cur.name, patch.color ?? cur.color, id);
    return this.catGet(id);
  },
  catRemove(id) {
    db.prepare('UPDATE items SET category_id = NULL WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  },
});
