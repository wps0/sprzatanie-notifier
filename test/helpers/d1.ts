/**
 * @fileoverview In-memory stand-in for a Cloudflare D1 binding, backed by
 * Node's built-in SQLite. Covers the part of the D1 API this project uses
 * (`prepare().bind().first()/all()/run()`, an atomic `batch()` and `exec()`),
 * so tests can call the Worker's handlers with real SQL semantics.
 */

import {readdirSync, readFileSync} from 'node:fs';
import type {SQLInputValue} from 'node:sqlite';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

import type {Database, Statement} from '../../src/worker/store.ts';

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));

export interface RunResult {
  readonly success: true;
  readonly results: [];
  readonly meta: {readonly changes: number; readonly last_row_id: number};
}

export interface AllResult<T> {
  readonly success: true;
  readonly results: T[];
  readonly meta: Record<string, never>;
}

export interface TestStatement extends Statement {
  /** The SQL text, so that `batch()` knows whether it returns rows. */
  readonly sql: string;
  bind(...values: unknown[]): TestStatement;
  run(): Promise<RunResult>;
  all<T>(): Promise<AllResult<T>>;
}

export interface TestDatabase extends Database {
  prepare(sql: string): TestStatement;
  /** Runs statements in one transaction; any failure rolls all back. */
  batch(
    statements: readonly TestStatement[],
  ): Promise<Array<RunResult | AllResult<unknown>>>;
  exec(sql: string): Promise<{count: number; duration: number}>;
}

function returnsRows(sql: string): boolean {
  return /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);
}

export function createD1({migrate = true} = {}): TestDatabase {
  const db = new DatabaseSync(':memory:');
  if (migrate) {
    for (const file of readdirSync(MIGRATIONS).sort()) {
      db.exec(readFileSync(MIGRATIONS + file, 'utf8'));
    }
  }

  const statement = (
    sql: string,
    params: readonly SQLInputValue[] = [],
  ): TestStatement => ({
    sql,
    bind: (...values: unknown[]) => statement(sql, values as SQLInputValue[]),
    async first<T>(column?: string): Promise<T | null> {
      const row = db.prepare(sql).get(...params);
      if (!row) return null;
      return (column ? row[column] : {...row}) as T;
    },
    async all<T>(): Promise<AllResult<T>> {
      const rows = db.prepare(sql).all(...params);
      return {
        success: true,
        results: rows.map(row => ({...row}) as T),
        meta: {},
      };
    },
    async run(): Promise<RunResult> {
      const info = db.prepare(sql).run(...params);
      return {
        success: true,
        results: [],
        meta: {
          changes: Number(info.changes),
          last_row_id: Number(info.lastInsertRowid),
        },
      };
    },
  });

  return {
    prepare: sql => statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results: Array<RunResult | AllResult<unknown>> = [];
        for (const item of statements) {
          results.push(await (returnsRows(item.sql) ? item.all() : item.run()));
        }
        db.exec('COMMIT');
        return results;
      } catch (e: unknown) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql) {
      db.exec(sql);
      return {count: 0, duration: 0};
    },
  };
}
