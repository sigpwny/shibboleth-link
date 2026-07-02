import { Hono, type Context } from 'hono';
import type { AppBindings } from '../bindings.js';
import { getDiscordGuild } from '../discord/client.js';
import { confirmLinkFlow } from '../link/confirm.js';
import { clearLinkSessions, getDiscordSession, getFlowSession, getShibSession } from '../session.js';
import { SAML_ATTRIBUTE_LIST } from '../saml/attributes.js';
import { SERVICE_CONFIG } from '../services.js';
import { getOrCreateFlow } from './flow.js';
import { banError, firstActiveBan } from '../bans.js';

const GUILD_CACHE_TTL_MS = 60 * 60 * 1000;

async function getFreshGuild(c: Context<AppBindings>, guildId: string) {
  const storage = c.get('storage');
  const cached = await storage.getGuildConfig(guildId);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.updatedAt < GUILD_CACHE_TTL_MS && cached.iconUrl) {
    return cached;
  }

  try {
    const live = await getDiscordGuild(c.get('env'), guildId);
    const updated = {
      ...cached,
      name: live.name,
      iconUrl: live.iconUrl,
      updatedAt: Date.now(),
    };
    await storage.upsertGuildConfig(updated);
    return updated;
  } catch (error) {
    console.warn('Failed to refresh Discord guild metadata', {
      guildId,
      message: error instanceof Error ? error.message : 'unknown error',
    });
    return cached;
  }
}

export const linkRoutes = new Hono<AppBindings>();

linkRoutes.get('/target', async (c) => {
  const guildId = c.req.query('server');
  if (!guildId) {
    return c.json({ error: 'missing_server' }, 400);
  }

  const ban = await firstActiveBan(c.get('storage'), [{ targetType: 'server', targetId: guildId }]);
  if (ban) {
    return c.json({ error: banError(ban.targetType) }, 403);
  }

  const guild = await getFreshGuild(c, guildId);
  if (!guild) {
    return c.json({ error: 'unknown_server' }, 404);
  }

  if (!guild.linkingEnabled) {
    return c.json({
      server: guild,
      linkingEnabled: false,
      services: {
        shibboleth: { ...SERVICE_CONFIG.shibboleth, assertions: SAML_ATTRIBUTE_LIST },
        discord: SERVICE_CONFIG.discord,
      },
      shibboleth: { signedIn: false, assertions: {} },
      discord: { signedIn: false },
      canConfirm: false,
    });
  }

  return c.json({ server: guild });
});

linkRoutes.get('/session', async (c) => {
  const guildId = c.req.query('server');
  if (!guildId) {
    return c.json({ error: 'missing_server' }, 400);
  }

  const serverBan = await firstActiveBan(c.get('storage'), [{ targetType: 'server', targetId: guildId }]);
  if (serverBan) {
    return c.json({ error: banError(serverBan.targetType) }, 403);
  }

  const guild = await getFreshGuild(c, guildId);
  if (!guild) {
    return c.json({ error: 'unknown_server' }, 404);
  }

  const flow = await getOrCreateFlow(c, guildId);
  if (!flow) {
    return c.json({ error: 'unknown_server' }, 404);
  }

  const shib = await getShibSession(c, flow.id);
  const discord = await getDiscordSession(c, flow.id);
  const identityBan = await firstActiveBan(c.get('storage'), [
    { targetType: 'user', targetId: discord?.userId },
    { targetType: 'netid', targetId: shib?.uid },
  ]);
  if (identityBan) {
    return c.json({ error: banError(identityBan.targetType) }, 403);
  }

  return c.json({
    server: guild,
    services: {
      shibboleth: {
        ...SERVICE_CONFIG.shibboleth,
        assertions: SAML_ATTRIBUTE_LIST,
      },
      discord: SERVICE_CONFIG.discord,
    },
    flow: { step: flow.step, expiresAt: flow.expiresAt },
    shibboleth: {
      signedIn: Boolean(shib),
      assertions: {
        uid: shib?.uid,
        eduPersonAffiliation: shib?.affiliations,
      },
    },
    discord: { signedIn: Boolean(discord), username: discord?.username, userId: discord?.userId },
    canConfirm: Boolean(shib && discord),
  });
});

linkRoutes.post('/ensure', async (c) => {
  const body: { server?: string } = await c.req.json<{ server?: string }>().catch(() => ({}));
  if (!body.server) {
    return c.json({ error: 'missing_server' }, 400);
  }

  const serverBan = await firstActiveBan(c.get('storage'), [{ targetType: 'server', targetId: body.server }]);
  if (serverBan) {
    return c.json({ error: banError(serverBan.targetType) }, 403);
  }

  const guild = await c.get('storage').getGuildConfig(body.server);
  if (!guild) {
    return c.json({ error: 'unknown_server' }, 404);
  }
  if (!guild.linkingEnabled) {
    return c.json({ error: 'linking_disabled' }, 403);
  }

  const flow = await getOrCreateFlow(c, body.server);
  if (!flow) {
    return c.json({ error: 'unknown_server' }, 404);
  }

  return c.json({ ok: true, expiresAt: flow.expiresAt });
});

linkRoutes.post('/confirm/:flowId', async (c) => {
  const flowId = c.req.param('flowId');
  const result = await confirmLinkFlow(c.get('env'), c.get('storage'), flowId, await getShibSession(c, flowId), await getDiscordSession(c, flowId));
  if (result.ok) {
    clearLinkSessions(c);
  }
  return result.ok ? c.json(result) : c.json(result.body, result.status);
});

linkRoutes.post('/confirm', async (c) => {
  const guildId = c.req.query('server');
  if (!guildId) {
    return c.json({ error: 'missing_server' }, 400);
  }

  const serverBan = await firstActiveBan(c.get('storage'), [{ targetType: 'server', targetId: guildId }]);
  if (serverBan) {
    return c.json({ error: banError(serverBan.targetType) }, 403);
  }

  const flowSession = await getFlowSession(c, guildId);
  if (!flowSession) {
    return c.json({ error: 'expired_flow' }, 400);
  }

  const result = await confirmLinkFlow(c.get('env'), c.get('storage'), flowSession.flowId, await getShibSession(c, flowSession.flowId), await getDiscordSession(c, flowSession.flowId));
  if (result.ok) {
    clearLinkSessions(c);
  }
  return result.ok ? c.json(result) : c.json(result.body, result.status);
});
