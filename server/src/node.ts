import { existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnv } from './env.js';
import { SqliteStorage } from './storage/sqlite.js';

dotenv.config({ path: '../.env' });
dotenv.config({ path: '.env', override: false });

function readOptionalFile(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

const env = loadEnv({
  ...process.env,
  SAML_IDP_CERT: process.env.SAML_IDP_CERT ?? readOptionalFile('data/shibboleth/idp-cert.pem'),
  SAML_SP_PRIVATE_KEY: process.env.SAML_SP_PRIVATE_KEY ?? readOptionalFile('data/shibboleth/sp-key.pem'),
});
const storage = new SqliteStorage(process.env.SQLITE_PATH ?? 'data/local.sqlite');
storage.migrate();

const TRANSIENT_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function cleanupTransientRows(): Promise<void> {
  const cutoff = Date.now() - TRANSIENT_RETENTION_MS;
  const result = await storage.cleanupTransientRows(cutoff);
  console.log('Transient cleanup complete', result);
}

cleanupTransientRows().catch((error) => {
  console.error('Transient cleanup failed', error);
});
setInterval(() => {
  cleanupTransientRows().catch((error) => {
    console.error('Transient cleanup failed', error);
  });
}, CLEANUP_INTERVAL_MS).unref();

const app = createApp(env, storage);

const port = Number(env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Shibboleth Link API listening on http://localhost:${port}`);
});
