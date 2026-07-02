import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });
dotenv.config({ path: '.env', override: false });

const secretNames = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_PUBLIC_KEY',
  'JWT_SECRET',
  'SAML_ENTRY_POINT',
  'SAML_ISSUER',
] as const;

const optionalSecretNames = [
  'OPERATOR_GUILD_ID',
  'OPERATOR_CHANNEL_ID',
] as const;

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function readOptionalFile(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function putSecret(name: string, value: string): void {
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', name], {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  if (result.status !== 0) {
    throw new Error(`Failed to set ${name}`);
  }
}

for (const name of secretNames) {
  putSecret(name, readRequired(name));
}

for (const name of optionalSecretNames) {
  const value = process.env[name];
  if (value) {
    putSecret(name, value);
  }
}

putSecret('SAML_IDP_CERT', process.env.SAML_IDP_CERT ?? readOptionalFile('data/shibboleth/idp-cert.pem') ?? readRequired('SAML_IDP_CERT'));
putSecret('SAML_SP_PRIVATE_KEY', process.env.SAML_SP_PRIVATE_KEY ?? readOptionalFile('data/shibboleth/sp-key.pem') ?? readRequired('SAML_SP_PRIVATE_KEY'));

console.log('Worker runtime bindings configured. Re-run this script only when runtime secrets/config change.');
