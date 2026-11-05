import { createDatabase } from './knex.js';

const command = process.argv[2] ?? 'latest';
const db = createDatabase();

try {
  if (command === 'latest') {
    const [batch, applied] = await db.migrate.latest();
    console.log(applied.length ? `Batch ${batch}: ${applied.join(', ')}` : 'Already up to date');
  } else if (command === 'rollback') {
    const [batch, reverted] = await db.migrate.rollback();
    console.log(
      reverted.length
        ? `Rolled back batch ${batch}: ${reverted.join(', ')}`
        : 'Nothing to roll back',
    );
  } else {
    throw new Error(`Unknown command "${command}". Use "latest" or "rollback".`);
  }
} finally {
  await db.destroy();
}
