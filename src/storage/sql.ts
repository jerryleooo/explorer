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
