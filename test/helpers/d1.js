// In-memory stand-in for a Cloudflare D1 binding, backed by Node's built-in SQLite.
// Covers the subset of the D1 API this project uses: prepare().bind().first()/all()/run(),
// batch() (atomic) and exec(). Lets tests call the Worker's handlers directly under
// `node --test`, with real SQL semantics and no extra dependencies.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));
const returnsRows = (sql) => /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);

export function createD1({ migrate = true } = {}) {
  const db = new DatabaseSync(':memory:');
  if (migrate) for (const file of readdirSync(MIGRATIONS).sort()) db.exec(readFileSync(MIGRATIONS + file, 'utf8'));

  const statement = (sql, params = []) => ({
    bind: (...args) => statement(sql, args),
    async first(column) {
      const row = db.prepare(sql).get(...params);
      if (!row) return null;
      return column ? row[column] : { ...row };
    },
    async all() {
      return { success: true, results: db.prepare(sql).all(...params).map((row) => ({ ...row })), meta: {} };
    },
    async run() {
      const info = db.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
    auto() { return returnsRows(sql) ? this.all() : this.run(); },
  });

  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const s of statements) results.push(await s.auto());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sql) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}
