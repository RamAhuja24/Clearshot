import knex, { type Knex } from 'knex';
import { config } from '../config/env.js';
import { migrationSource } from './migrationSource.js';

export function createDatabase(connectionString: string = config.db.url): Knex {
  return knex({
    client: 'pg',
    connection: { connectionString, application_name: 'clearshot' },
    pool: { min: 0, max: 10 },
    migrations: { migrationSource, tableName: 'knex_migrations' },
  });
}
