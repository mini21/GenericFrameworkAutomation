import { logger } from '../logger/logger';

export interface DbRow {
  [column: string]: unknown;
}

/**
 * Generic contract for test data setup/verification/cleanup (see
 * docs/ARCHITECTURE.md). Any real driver (pg, mysql2, mongodb, ...) can
 * implement this interface without touching fixtures or specs.
 */
export interface DbClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  insert(table: string, row: DbRow): Promise<void>;
  find(table: string, predicate?: (row: DbRow) => boolean): Promise<DbRow[]>;
  findOne(table: string, predicate?: (row: DbRow) => boolean): Promise<DbRow | undefined>;
  clear(table: string): Promise<void>;
}

/**
 * Safe default DbClient: an in-memory example implementation with no
 * external service or native dependency. Swap for a real driver once a
 * target database is chosen — DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
 * are already wired through config/env.config.ts for that driver to read
 * (see EnvironmentManager.dbConfig).
 */
export class InMemoryDbClient implements DbClient {
  private readonly tables = new Map<string, DbRow[]>();
  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;
    logger.info('DB: connected (in-memory example client)');
  }

  async disconnect(): Promise<void> {
    this.tables.clear();
    this.connected = false;
    logger.info('DB: disconnected');
  }

  async insert(table: string, row: DbRow): Promise<void> {
    this.assertConnected();
    const rows = this.tables.get(table) ?? [];
    rows.push({ ...row });
    this.tables.set(table, rows);
    logger.debug(`DB: inserted into ${table}`, { row });
  }

  async find(table: string, predicate: (row: DbRow) => boolean = () => true): Promise<DbRow[]> {
    this.assertConnected();
    return (this.tables.get(table) ?? []).filter(predicate);
  }

  async findOne(
    table: string,
    predicate: (row: DbRow) => boolean = () => true,
  ): Promise<DbRow | undefined> {
    const rows = await this.find(table, predicate);
    return rows[0];
  }

  async clear(table: string): Promise<void> {
    this.assertConnected();
    this.tables.set(table, []);
    logger.debug(`DB: cleared ${table}`);
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error('DbClient: not connected — call connect() first');
    }
  }
}

/** Swap this factory's return value for a real driver-backed DbClient later. */
export function createDbClient(): DbClient {
  return new InMemoryDbClient();
}
