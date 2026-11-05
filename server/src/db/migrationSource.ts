import type { Knex } from 'knex';
import * as createImages from './migrations/001_create_images.js';

// Migrations are registered explicitly instead of discovered on disk, so the same
// code runs under tsx in development and as compiled JavaScript in production.
const migrations: Record<string, Knex.Migration> = {
  '001_create_images': createImages,
};

export const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(migrations).sort(),
  getMigrationName: (name) => name,
  getMigration: async (name) => {
    const migration = migrations[name];
    if (!migration) throw new Error(`Unknown migration: ${name}`);
    return migration;
  },
};
