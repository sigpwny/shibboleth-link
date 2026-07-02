import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });
dotenv.config({ path: '.env', override: false });

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

run('npm', ['--prefix', '../client', 'run', 'build']);
run('npx', ['wrangler', 'deploy']);
