import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqlDatabase, SqlStatement, SqlValue } from "../src/storage/sql";

/** Local SQLite driver used to prove the repository stays within the D1/SQLite common subset. */
export class NodeSqliteDatabase implements SqlDatabase {
  readonly db = new DatabaseSync(":memory:");

  constructor() {
    this.db.exec("PRAGMA foreign_keys = ON");
    const dir = join(import.meta.dirname, "..", "migrations");
    for (const file of readdirSync(dir).sort()) this.db.exec(readFileSync(join(dir, file), "utf8"));
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async first<T>(sql: string, params: SqlValue[] = []): Promise<T | null> {
    return (this.db.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    this.db.exec("BEGIN");
    try {
      for (const s of statements) this.db.prepare(s.sql).run(...(s.params ?? []));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
