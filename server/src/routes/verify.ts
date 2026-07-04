import { Hono } from 'hono';
import type { AppBindings } from '../bindings.js';
import { computeMemberGuildPermissions, getDiscordGuild, getGuildMember, listGuildRoles } from '../discord/client.js';
import { SAML_ATTRIBUTE_LIST } from '../saml/attributes.js';
import { SERVICE_CONFIG } from '../services.js';
import { clearIdentitySessions, getDiscordSession, getShibSession } from '../session.js';
import { isActiveUiucMember, isAlum, verificationSatisfied, verificationExpiry } from '../verify/policy.js';
import { banError, firstActiveBan } from '../bans.js';

export const verifyRoutes = new Hono<AppBindings>();

const ADMINISTRATOR = 1n << 3n;

function hasAdministratorPermission(permissions: string | undefined): boolean {
  return Boolean(permissions) && (BigInt(permissions!) & ADMINISTRATOR) !== 0n;
}

verifyRoutes.get('/session', async (c) => {
  const flowId = c.req.query('flow');
  if (!flowId) {
    return c.json({ error: 'missing_flow' }, 400);
  }
  const flow = await c.get('storage').getServerVerificationFlow(flowId);
  if (!flow || flow.completedAt || flow.expiresAt <= Date.now()) {
    return c.json({ error: 'invalid_flow' }, 404);
  }
  const ban = await firstActiveBan(c.get('storage'), [{ targetType: 'server', targetId: flow.guildId }]);
  if (ban) {
    return c.json({ error: banError(ban.targetType) }, 403);
  }
  const guild = await c.get('storage').getGuildConfig(flow.guildId);
  const shib = await getShibSession(c, flow.id);
  const discord = await getDiscordSession(c, flow.id);
  const verifiers = await c.get('storage').listServerVerifiers(flow.guildId, Date.now());
  const discordMatchesRequester = discord?.userId === flow.requesterDiscordUserId;
  return c.json({
    flow: {
      id: flow.id,
      expiresAt: flow.expiresAt,
      requesterDiscordUserId: flow.requesterDiscordUserId,
      requesterIsOwner: flow.requesterIsOwner,
      requesterIsAdmin: flow.requesterIsAdmin,
    },
    operator: { name: 'Shibboleth Link' },
    server: guild,
    services: {
      shibboleth: {
        ...SERVICE_CONFIG.shibboleth,
        assertions: SAML_ATTRIBUTE_LIST,
      },
      discord: SERVICE_CONFIG.discord,
    },
    shibboleth: {
      signedIn: Boolean(shib?.uid),
      assertions: {
        uid: shib?.uid,
        eduPersonAffiliation: shib?.affiliations,
      },
      active: shib ? isActiveUiucMember(shib.affiliations) : false,
      alum: shib ? isAlum(shib.affiliations) : false,
    },
    discord: { signedIn: Boolean(discord), username: discord?.username, userId: discord?.userId },
    canConfirm: Boolean(shib?.uid && discord && discordMatchesRequester),
    discordMatchesRequester,
    verification: {
      expiresAt: verificationExpiry(),
      satisfied: verificationSatisfied(verifiers),
      verifierCount: verifiers.length,
      activeAdminCount: verifiers.filter((verifier) => verifier.active && (verifier.isAdmin || verifier.isOwner)).length,
      ownerVerified: Boolean(verifiers.find((verifier) => verifier.isOwner)),
    },
  });
});

verifyRoutes.post('/confirm', async (c) => {
  const flowId = c.req.query('flow');
  if (!flowId) {
    return c.json({ error: 'missing_flow' }, 400);
  }

  const storage = c.get('storage');
  const flow = await storage.getServerVerificationFlow(flowId);
  if (!flow || flow.completedAt || flow.expiresAt <= Date.now()) {
    return c.json({ error: 'invalid_flow' }, 404);
  }

  const shib = await getShibSession(c, flow.id);
  const discord = await getDiscordSession(c, flow.id);
  if (!shib || !discord) {
    return c.json({ error: 'flow_not_ready' }, 400);
  }

  if (!shib.uid) {
    return c.json({ error: 'missing_netid' }, 400);
  }

  if (discord.userId !== flow.requesterDiscordUserId) {
    return c.json({ error: 'discord_user_mismatch' }, 400);
  }

  const ban = await firstActiveBan(storage, [
    { targetType: 'server', targetId: flow.guildId },
    { targetType: 'user', targetId: discord.userId },
    { targetType: 'netid', targetId: shib.uid },
  ]);
  if (ban) {
    return c.json({ error: banError(ban.targetType) }, 403);
  }

  const [guild, requesterMember, roles] = await Promise.all([
    getDiscordGuild(c.get('env'), flow.guildId).catch(() => null),
    getGuildMember(c.get('env'), flow.guildId, discord.userId).catch(() => null),
    listGuildRoles(c.get('env'), flow.guildId).catch(() => []),
  ]);
  const requesterIsOwner = guild?.ownerId === discord.userId;
  const requesterPermissions = requesterMember?.permissions !== undefined
    ? requesterMember.permissions
    : requesterMember ? computeMemberGuildPermissions(flow.guildId, requesterMember, roles).toString() : undefined;
  const requesterIsAdmin = hasAdministratorPermission(requesterPermissions);
  if (!requesterIsOwner && !requesterIsAdmin) {
    return c.json({ error: 'verification_permission_lost' }, 403);
  }

  const expiresAt = verificationExpiry();
  const affiliations = shib.affiliations;
  await storage.upsertServerVerifier({
    guildId: flow.guildId,
    discordUserId: discord.userId,
    shibUid: shib.uid,
    affiliations,
    isOwner: requesterIsOwner,
    isAdmin: requesterIsAdmin || requesterIsOwner,
    active: isActiveUiucMember(affiliations),
    alum: isAlum(affiliations),
    verifiedAt: Date.now(),
    expiresAt,
  });

  await storage.completeServerVerificationFlow(flow.id, Date.now());
  clearIdentitySessions(c);
  const verifiers = await storage.listServerVerifiers(flow.guildId, Date.now());
  const satisfied = verificationSatisfied(verifiers);
  if (satisfied) {
    const guild = await storage.getGuildConfig(flow.guildId);
    if (guild) {
      await storage.upsertGuildConfig({ ...guild, verified: true, verificationExpiresAt: expiresAt, updatedAt: Date.now() });
    }
  }

  return c.json({ ok: true, satisfied, expiresAt });
});
