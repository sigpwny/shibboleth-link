import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import type { WorkerBindings } from './bindings.js';
import worker from './worker.js';

const APPLICATION_ID = '200000000000000001';
const VERIFY_SELF_COMMAND_ID = '200000000000000002';
const VERIFY_COMMAND_ID = '200000000000000003';
const CHANNEL_IDS = ['200000000000000101', '200000000000000102', '200000000000000103', '200000000000000104'];

type MessagePayload = { content: string; allowed_mentions: { parse: string[] } };

function fixture(t: TestContext, failedChannelId?: string) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../migrations/0001_migrate_from_2.sql', import.meta.url), 'utf8'));
  const insert = db.prepare(`
    INSERT INTO guild_configs (guild_id, name, admin_channel_id, verified, verification_expires_at, linking_enabled, log_links_enabled, mode, created_at, updated_at)
    VALUES (?, 'Test server', ?, ?, ?, 0, 0, ?, 0, 0)
  `);
  insert.run('verified', CHANNEL_IDS[0], 1, Date.UTC(2027, 7, 1), 'link_and_store');
  insert.run('unverified', CHANNEL_IDS[1], 0, null, 'confirm_only');
  insert.run('expired', CHANNEL_IDS[2], 1, Date.UTC(2026, 7, 1), 'confirm_only');
  insert.run('renewed', CHANNEL_IDS[3], 1, Date.UTC(2028, 7, 1), 'link_and_store');
  insert.run('no-channel', null, 1, Date.UTC(2027, 7, 1), 'link_and_store');
  insert.run('empty-channel', '', 0, null, 'confirm_only');
  insert.run('blank-channel', '   ', 0, null, 'confirm_only');

  const queries: string[] = [];
  const database = {
    prepare(sql: string) {
      queries.push(sql.trim());
      const statement = db.prepare(sql);
      function prepared(values: SQLInputValue[] = []) {
        return {
          bind(...parameters: SQLInputValue[]) { return prepared(parameters); },
          async all() { return { results: statement.all(...values) }; },
          async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
        };
      }
      return prepared();
    },
  } as unknown as D1Database;
  const bindings: WorkerBindings = {
    DB: database,
    ASSETS: {} as Fetcher,
    DISCORD_BOT_TOKEN: `reminder-test-${t.name}`,
    DISCORD_CLIENT_ID: APPLICATION_ID,
    DISCORD_CLIENT_SECRET: 'unused',
    DISCORD_PUBLIC_KEY: 'unused',
    JWT_SECRET: 'x'.repeat(32),
    SAML_ENTRY_POINT: 'https://example.com/saml',
    SAML_ISSUER: 'https://example.com',
    SAML_IDP_CERT: 'unused',
    SAML_SP_PRIVATE_KEY: 'unused',
  };
  const messages: Array<{ channelId: string; body: MessagePayload }> = [];
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === 'GET' && request.url === `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`) {
      return Response.json([
        { id: VERIFY_SELF_COMMAND_ID, name: 'verify-self' },
        { id: VERIFY_COMMAND_ID, name: 'verify' },
      ]);
    }
    const channelId = /^https:\/\/discord\.com\/api\/v10\/channels\/(\d+)\/messages$/.exec(request.url)?.[1];
    assert.equal(request.method, 'POST');
    assert.ok(channelId && CHANNEL_IDS.includes(channelId));
    messages.push({ channelId, body: await request.json() as MessagePayload });
    return channelId === failedChannelId
      ? Response.json({ code: 50013, message: 'Missing Permissions' }, { status: 403 })
      : Response.json({ id: `message-${channelId}` });
  });
  const log = t.mock.method(console, 'log', () => {});
  return { db, bindings, queries, messages, fetchMock, log };
}

function scheduledEvent(t: TestContext, cron: string, date: string): ScheduledController {
  return { cron, scheduledTime: Date.parse(date), noRetry: t.mock.fn() };
}

test('hourly cleanup never reads admin channels or sends reminders, including on reminder dates', async (t) => {
  const { bindings, queries, fetchMock } = fixture(t);
  for (const date of ['2027-07-02T00:00:00Z', '2027-07-25T00:00:00Z']) {
    await worker.scheduled(scheduledEvent(t, '0 * * * *', date), bindings);
  }
  assert.equal(queries.length, 8);
  assert.ok(queries.every((query) => query.startsWith('DELETE FROM')));
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('July 2 sends to all configured channels regardless of status and continues after permission failures', async (t) => {
  const { db, bindings, queries, messages, log } = fixture(t, CHANNEL_IDS[1]);
  const before = db.prepare('SELECT * FROM guild_configs').all();
  const noRetry = t.mock.fn();
  await worker.scheduled({ cron: '0 0 2 7 *', scheduledTime: Date.parse('2027-07-02T00:00:00Z'), noRetry }, bindings);

  assert.deepEqual(messages.map((message) => message.channelId).sort(), CHANNEL_IDS);
  assert.equal(queries.length, 1);
  assert.deepEqual(db.prepare('SELECT * FROM guild_configs').all(), before);
  assert.equal(noRetry.mock.callCount(), 1);
  assert.deepEqual(log.mock.calls[0].arguments, ['Verification reminders complete', { kind: 'opening', sent: 3, failed: 1 }]);
  for (const message of messages) {
    assert.equal(message.body.content, [
      'The new server verification period is now open.',
      `An eligible server owner or administrator can use </verify-self:${VERIFY_SELF_COMMAND_ID}> to verify or renew this server through <t:${Date.parse('2028-08-01T00:00:00Z') / 1000}:F> starting on <t:${Date.parse('2027-08-01T00:00:00Z') / 1000}:F>.`,
      `Use the </verify:${VERIFY_COMMAND_ID}> command to check your current server verification status.`,
    ].join(' '));
    assert.deepEqual(message.body.allowed_mentions, { parse: [] });
  }
});

test('July 25 uses a bold reminder heading and timestamps derived from the scheduled year', async (t) => {
  const { bindings, queries, messages } = fixture(t);
  await worker.scheduled(scheduledEvent(t, '0 0 25 7 *', '2032-07-25T00:00:00Z'), bindings);

  assert.equal(queries.length, 1);
  assert.equal(messages.length, CHANNEL_IDS.length);
  assert.equal(messages[0].body.content, [
    `**Reminder**\nThe current server verification period ends <t:${Date.parse('2032-08-01T00:00:00Z') / 1000}:R>.`,
    `An eligible server owner or administrator can use </verify-self:${VERIFY_SELF_COMMAND_ID}> to verify or renew this server through <t:${Date.parse('2033-08-01T00:00:00Z') / 1000}:F> starting on <t:${Date.parse('2032-08-01T00:00:00Z') / 1000}:F>.`,
    `Use the </verify:${VERIFY_COMMAND_ID}> command to check your current server verification status.`,
  ].join(' '));
});

test('annual reminders make no Discord requests when no admin channels are configured', async (t) => {
  const { db, bindings, queries, fetchMock } = fixture(t);
  db.exec('UPDATE guild_configs SET admin_channel_id = NULL');
  await worker.scheduled(scheduledEvent(t, '0 0 2 7 *', '2027-07-02T00:00:00Z'), bindings);

  assert.equal(queries.length, 1);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('unrecognized schedules do not query the database or contact Discord', async (t) => {
  const { bindings, queries, fetchMock } = fixture(t);
  await worker.scheduled(scheduledEvent(t, '0 0 1 7 *', '2027-07-01T00:00:00Z'), bindings);

  assert.equal(queries.length, 0);
  assert.equal(fetchMock.mock.callCount(), 0);
});
