import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });
dotenv.config({ path: '.env', override: false });

const plaintextNames = [
  'DISCORD_CLIENT_ID',
  'DISCORD_PUBLIC_KEY',
  'SAML_ENTRY_POINT',
  'SAML_ISSUER',
  'SAML_IDP_CERT',
] as const;

const optionalPlaintextNames = [
  'OPERATOR_GUILD_ID',
  'OPERATOR_CHANNEL_ID',
] as const;

function readOptionalFile(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function readRequired(name: string): string {
  const fileFallback = name === 'SAML_IDP_CERT' ? readOptionalFile('data/shibboleth/idp-cert.pem') : undefined;
  const value = process.env[name] ?? fileFallback;
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

const deployArgs = ['wrangler', 'deploy'];
for (const name of plaintextNames) {
  deployArgs.push('--var', `${name}:${readRequired(name)}`);
}
for (const name of optionalPlaintextNames) {
  const value = process.env[name];
  if (value) {
    deployArgs.push('--var', `${name}:${value}`);
  }
}

run('npm', ['--prefix', '../client', 'run', 'build']);
run('npx', deployArgs);
