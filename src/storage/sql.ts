export type SqlValue = string | number | null;

export interface SqlStatement {
  sql: string;
  params?: SqlValue[];
}

/** Minimal SQLite-dialect driver port, implemented by D1 (hosted) and local SQLite (tests / future desktop). */
export interface SqlDatabase {
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Runs the statements atomically, in order. */
  batch(statements: SqlStatement[]): Promise<void>;
}

const SCHEMA_MISMATCH_RE = /\b(?:has no column named|no such column|no such table)\b/i;

/** Detects SQLite/D1 schema errors that indicate pending migrations have not been applied. */
export function isSchemaMigrationError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current != null; depth++) {
    const message = current instanceof Error ? current.message : typeof current === "string" ? current : null;
    if (message && SCHEMA_MISMATCH_RE.test(message)) return true;
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}
