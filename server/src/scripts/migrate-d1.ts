import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });
dotenv.config({ path: '.env', override: false });

const database = process.env.D1_DATABASE_NAME;
if (!database) {
  throw new Error('Missing D1_DATABASE_NAME');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: npm run db:migrate:local | npm run db:migrate:remote');
  console.log('Reads target database name from D1_DATABASE_NAME in root .env.');
  process.exit(0);
}

const mode = process.argv.includes('--local') ? '--local' : '--remote';
const result = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', database, mode], { stdio: 'inherit' });
if (result.status !== 0) {
  throw new Error(`D1 migration failed for ${database}`);
}
