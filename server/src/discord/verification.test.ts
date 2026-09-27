import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import nacl from 'tweetnacl';
import type { AppEnv } from '../env.js';
import { MemoryStorage } from '../storage/memory.js';
import { handleDiscordInteraction } from './interactions.js';

const GUILD_ID = '100000000000000001';
const USER_ID = '100000000000000002';
const APPLICATION_ID = '100000000000000003';
const CONFIG_COMMAND_ID = '100000000000000004';
const VERIFY_SELF_COMMAND_ID = '100000000000000005';
const ADMIN_CHANNEL_ID = '100000000000000006';
const OPERATOR_GUILD_ID = '100000000000000007';
const OPERATOR_CHANNEL_ID = '100000000000000008';
const GENERAL_CHANNEL_ID = '100000000000000009';

type ResponseComponent = { components?: ResponseComponent[]; url?: string };
type CommandResponse = {
  type: number;
  data: { flags: number; content?: string; components?: ResponseComponent[] };
};

async function fixture(t: TestContext, adminChannelId?: string) {
  const keys = nacl.sign.keyPair();
  const env = {
    APP_ORIGIN: 'https://example.com',
    DISCORD_BOT_TOKEN: `verification-test-${t.name}`,
    DISCORD_CLIENT_ID: APPLICATION_ID,
    DISCORD_PUBLIC_KEY: Buffer.from(keys.publicKey).toString('hex'),
    OPERATOR_GUILD_ID,
    OPERATOR_CHANNEL_ID,
  } as AppEnv;
  const storage = new MemoryStorage();
  await storage.upsertGuildConfig({
    guildId: GUILD_ID,
    name: 'Test server',
    adminChannelId,
    logLinksEnabled: false,
    linkingEnabled: true,
    mode: 'confirm_only',
    verified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.method, 'GET');
    let body: unknown;
    switch (request.url) {
      case `https://discord.com/api/v10/guilds/${GUILD_ID}`:
        body = { id: GUILD_ID, name: 'Test server', owner_id: USER_ID, icon: null };
        break;
      case `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`:
        body = [
          { id: CONFIG_COMMAND_ID, name: 'config' },
          { id: VERIFY_SELF_COMMAND_ID, name: 'verify-self' },
        ];
        break;
      default:
        assert.fail(`Unexpected Discord request: ${request.url}`);
    }
    return Response.json(body);
  });

  async function invoke(data: object, guildId = GUILD_ID, channelId = GENERAL_CHANNEL_ID) {
    const body = JSON.stringify({
      type: 2,
      guild_id: guildId,
      channel_id: channelId,
      member: { user: { id: USER_ID }, permissions: '8' },
      data,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = nacl.sign.detached(new TextEncoder().encode(timestamp + body), keys.secretKey);
    const response = await handleDiscordInteraction(env, storage, new Request(`${env.APP_ORIGIN}/api/discord/interactions/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Ed25519': Buffer.from(signature).toString('hex'),
        'X-Signature-Timestamp': timestamp,
      },
      body,
    }));
    assert.equal(response.status, 200);
    return response.json() as Promise<CommandResponse>;
  }

  return { storage, invoke };
}

test('verify-self without an admin channel replies privately with a linked config command and creates no flow', async (t) => {
  const { storage, invoke } = await fixture(t);
  const createFlow = t.mock.method(storage, 'createServerVerificationFlow');

  const response = await invoke({ name: 'verify-self' });

  assert.equal(response.type, 4);
  assert.equal(response.data.flags, 64);
  assert.equal(response.data.content, `⚠️ Configure an admin channel using </config:${CONFIG_COMMAND_ID}> before starting server verification.`);
  assert.equal(createFlow.mock.callCount(), 0);
});

test('verify-self without a server configuration creates no flow or configuration', async (t) => {
  const { storage, invoke } = await fixture(t);
  t.mock.method(storage, 'getGuildConfig', async () => null);
  const createFlow = t.mock.method(storage, 'createServerVerificationFlow');
  const upsertConfig = t.mock.method(storage, 'upsertGuildConfig');

  const response = await invoke({ name: 'verify-self' });

  assert.equal(response.data.content, `⚠️ Configure an admin channel using </config:${CONFIG_COMMAND_ID}> before starting server verification.`);
  assert.equal(createFlow.mock.callCount(), 0);
  assert.equal(upsertConfig.mock.callCount(), 0);
});

test('verify-self with an admin channel starts verification when invoked in another channel', async (t) => {
  const { storage, invoke } = await fixture(t, ADMIN_CHANNEL_ID);
  const createFlow = t.mock.method(storage, 'createServerVerificationFlow');

  const response = await invoke({ name: 'verify-self' });

  assert.equal(createFlow.mock.callCount(), 1);
  const flow = createFlow.mock.calls[0].arguments[0];
  assert.equal(flow.guildId, GUILD_ID);
  assert.equal(flow.requesterDiscordUserId, USER_ID);
  assert.equal(flow.expiresAt - flow.createdAt, 15 * 60 * 1000);
  assert.deepEqual(await storage.getServerVerificationFlow(flow.id), flow);
  assert.equal(response.data.flags & 64, 64);
  assert.equal(response.data.components?.[0].components?.[1].components?.[0].url, `https://example.com/verify?flow=${flow.id}`);
});

test('operator verification succeeds without an admin channel', async (t) => {
  const { storage, invoke } = await fixture(t);
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

  const response = await invoke({
    name: 'operator',
    options: [{
      name: 'verify',
      options: [
        { name: 'server', value: GUILD_ID },
        { name: 'expires', value: new Date(expiresAt).toISOString() },
      ],
    }],
  }, OPERATOR_GUILD_ID, OPERATOR_CHANNEL_ID);

  const config = await storage.getGuildConfig(GUILD_ID);
  assert.equal(config?.verified, true);
  assert.equal(config?.verificationExpiresAt, expiresAt);
  assert.equal(config?.adminChannelId, undefined);
  assert.match(response.data.content ?? '', /Verified Server/);
});
