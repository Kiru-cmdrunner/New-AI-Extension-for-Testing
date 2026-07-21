/**
 * DexieUnitOfWorkFactory — creates Units of Work backed by Dexie.
 *
 * The composition root creates one factory and injects it into services.
 * Each call to create() returns a fresh UnitOfWork — but they all share
 * the same underlying database instance.
 */

import type { UnitOfWorkFactory, UnitOfWork } from '../interfaces/unit-of-work';
import { DexieUnitOfWork } from './dexie-unit-of-work';
import { createDatabase, type CmdRunnerDatabase } from './dexie-database';

export class DexieUnitOfWorkFactory implements UnitOfWorkFactory {
  private readonly db: CmdRunnerDatabase;

  constructor() {
    this.db = createDatabase();
  }

  create(): UnitOfWork {
    return new DexieUnitOfWork(this.db);
  }

  /** Expose the database for testing/debugging purposes. */
  getDatabase(): CmdRunnerDatabase {
    return this.db;
  }
}
