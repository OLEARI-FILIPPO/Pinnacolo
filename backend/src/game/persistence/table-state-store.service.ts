import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';
import { TableState } from '../domain/types';

@Injectable()
export class TableStateStoreService {
  private readonly persistenceFilePath = join(process.cwd(), '.data', 'tables-state.json');
  private readonly snapshotId = 'tables';
  private readonly pool: Pool | null;

  constructor() {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      this.pool = null;
      return;
    }

    const isLocal = /localhost|127\.0\.0\.1/i.test(connectionString);
    this.pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });
  }

  async initialize() {
    if (!this.pool) {
      return;
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS pinnacolo_state_snapshots (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async loadTables() {
    if (!this.pool) {
      return this.loadFromFile();
    }

    try {
      const result = await this.pool.query<{ payload: TableState[] }>(
        'SELECT payload FROM pinnacolo_state_snapshots WHERE id = $1',
        [this.snapshotId],
      );

      const payload = result.rows[0]?.payload;
      return Array.isArray(payload) ? payload : [];
    } catch {
      return this.loadFromFile();
    }
  }

  async saveTables(tables: TableState[]) {
    if (!this.pool) {
      this.saveToFile(tables);
      return;
    }

    try {
      await this.pool.query(
        `
          INSERT INTO pinnacolo_state_snapshots (id, payload, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (id)
          DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
        `,
        [this.snapshotId, JSON.stringify(tables)],
      );
    } catch {
      this.saveToFile(tables);
    }
  }

  private loadFromFile() {
    if (!existsSync(this.persistenceFilePath)) {
      return [] as TableState[];
    }

    try {
      const raw = readFileSync(this.persistenceFilePath, 'utf8');
      const parsed = JSON.parse(raw) as TableState[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveToFile(tables: TableState[]) {
    try {
      const folder = dirname(this.persistenceFilePath);
      if (!existsSync(folder)) {
        mkdirSync(folder, { recursive: true });
      }

      writeFileSync(this.persistenceFilePath, JSON.stringify(tables), 'utf8');
    } catch {
      // Ignore persistence failures to keep gameplay responsive.
    }
  }
}