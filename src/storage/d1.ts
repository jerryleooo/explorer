import type { SqlDatabase, SqlStatement, SqlValue } from "./sql";

export class D1SqlDatabase implements SqlDatabase {
  constructor(private readonly db: D1Database) {}

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const { results } = await this.db.prepare(sql).bind(...params).all<T>();
    return results;
  }

  first<T>(sql: string, params: SqlValue[] = []): Promise<T | null> {
    return this.db.prepare(sql).bind(...params).first<T>();
  }

  async batch(statements: SqlStatement[]): Promise<void> {
    if (statements.length === 0) return;
    await this.db.batch(statements.map((s) => this.db.prepare(s.sql).bind(...(s.params ?? []))));
  }
}
