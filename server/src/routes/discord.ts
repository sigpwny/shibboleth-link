import { Hono } from 'hono';
import type { AppBindings } from '../bindings.js';
import { randomToken, sha256 } from '../crypto.js';
import { discordAuthorizeUrl, exchangeDiscordCode, getDiscordOAuthMe } from '../discord/client.js';
import { handleDiscordInteraction } from '../discord/interactions.js';
import { setDiscordSession } from '../session.js';
import { getOrCreateFlow } from './flow.js';
import { banError, firstActiveBan } from '../bans.js';

const STATE_TTL_MS = 10 * 60 * 1000;

export const discordRoutes = new Hono<AppBindings>();

discordRoutes.post('/interactions/callback', async (c) => {
  return handleDiscordInteraction(c.get('env'), c.get('storage'), c.req.raw);
});

discordRoutes.get('/start/:flowId', async (c) => {
  const flow = await c.get('storage').getLinkFlow(c.req.param('flowId'));
  const verificationFlow = flow ? null : await c.get('storage').getServerVerificationFlow(c.req.param('flowId'));
  if ((!flow || flow.expiresAt <= Date.now()) && (!verificationFlow || verificationFlow.expiresAt <= Date.now() || verificationFlow.completedAt)) {
    return c.json({ error: 'unknown_flow' }, 404);
  }

  const guildId = flow?.guildId ?? verificationFlow!.guildId;
  const ban = await firstActiveBan(c.get('storage'), [{ targetType: 'server', targetId: guildId }]);
  if (ban) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/${flow ? 'link' : 'verify'}?${flow ? `server=${encodeURIComponent(guildId)}` : `flow=${encodeURIComponent(verificationFlow!.id)}`}&error=${banError(ban.targetType)}`);
  }

  const flowId = flow?.id ?? verificationFlow!.id;
  const state = randomToken();
  const now = Date.now();
  await c.get('storage').createOAuthState({
    stateHash: sha256(state),
    flowId,
    provider: 'discord',
    createdAt: now,
    expiresAt: now + STATE_TTL_MS,
  });

  return c.redirect(discordAuthorizeUrl(c.get('env'), state));
});

discordRoutes.get('/start', async (c) => {
  const guildId = c.req.query('server');
  if (!guildId) {
    return c.json({ error: 'missing_server' }, 400);
  }

  const ban = await firstActiveBan(c.get('storage'), [{ targetType: 'server', targetId: guildId }]);
  if (ban) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link?server=${encodeURIComponent(guildId)}&error=${banError(ban.targetType)}`);
  }

  const guild = await c.get('storage').getGuildConfig(guildId);
  if (!guild?.linkingEnabled) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link?server=${encodeURIComponent(guildId)}&error=linking_disabled`);
  }

  const flow = await getOrCreateFlow(c, guildId);
  if (!flow || flow.expiresAt <= Date.now()) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link?server=${encodeURIComponent(guildId)}&error=expired_flow`);
  }

  const state = randomToken();
  const now = Date.now();
  await c.get('storage').createOAuthState({
    stateHash: sha256(state),
    flowId: flow.id,
    provider: 'discord',
    createdAt: now,
    expiresAt: now + STATE_TTL_MS,
  });

  return c.redirect(discordAuthorizeUrl(c.get('env'), state));
});

discordRoutes.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link/error?error=discord_missing_code`);
  }

  const storage = c.get('storage');
  const oauthState = await storage.consumeOAuthState(sha256(state), 'discord', Date.now());
  if (!oauthState) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link/error?error=discord_invalid_state`);
  }

  const flow = await storage.getLinkFlow(oauthState.flowId);
  const verificationFlow = flow ? null : await storage.getServerVerificationFlow(oauthState.flowId);
  if ((!flow || flow.expiresAt <= Date.now()) && (!verificationFlow || verificationFlow.expiresAt <= Date.now() || verificationFlow.completedAt)) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link/error?error=expired_flow`);
  }

  const flowId = flow?.id ?? verificationFlow!.id;
  const guildId = flow?.guildId ?? verificationFlow!.guildId;

  const tokens = await exchangeDiscordCode(c.get('env'), code);
  const me = await getDiscordOAuthMe(tokens.access_token);
  const ban = await firstActiveBan(storage, [
    { targetType: 'server', targetId: guildId },
    { targetType: 'user', targetId: me.user.id },
  ]);
  if (ban) {
    const target = flow
      ? `${c.get('env').APP_ORIGIN}/link?server=${encodeURIComponent(guildId)}&error=${banError(ban.targetType)}`
      : `${c.get('env').APP_ORIGIN}/verify?flow=${encodeURIComponent(flowId)}&error=${banError(ban.targetType)}`;
    return c.redirect(target);
  }
  await setDiscordSession(c, {
    version: 1,
    flowId,
    userId: me.user.id,
    username: me.user.username,
  });
  if (flow) {
    await storage.updateLinkFlow({ ...flow, step: 'discord_verified' });
  }

  const target = flow
    ? `${c.get('env').APP_ORIGIN}/link?server=${encodeURIComponent(guildId)}&connected=discord&next=shib`
    : `${c.get('env').APP_ORIGIN}/verify?flow=${encodeURIComponent(flowId)}&connected=discord&next=shib`;
  return c.redirect(target);
});
