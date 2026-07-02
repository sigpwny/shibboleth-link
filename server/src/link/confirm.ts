import type { AppEnv } from '../env.js';
import { randomToken } from '../crypto.js';
import { addGuildMemberRole, assertCanGrantRole, createChannelComponentsMessage, DiscordApiError, DiscordPreflightError } from '../discord/client.js';
import { decodeAffiliations } from '../discord/affiliations.js';
import { globalCommandMention } from '../discord/mentions.js';
import type { Storage } from '../storage/types.js';
import type { DiscordSession, ShibSession } from '../session.js';
import { banError, firstActiveBan } from '../bans.js';

export type ConfirmResult =
  | { ok: true; rolesGranted: number }
  | { ok: false; status: 400; body: { error: 'flow_not_ready' | 'missing_netid' } }
  | { ok: false; status: 403; body: { error: 'server_banned' | 'user_banned' | 'netid_banned' | 'linking_disabled' } }
  | { ok: false; status: 404; body: { error: 'unknown_server' } }
  | { ok: false; status: 409; body: { error: 'discord_preflight_failed'; code: string } | { error: 'flow_already_consumed' } }
  | { ok: false; status: 502; body: { error: 'discord_api_error'; status: number } };

function roleList(roleIds: string[]): string {
  return roleIds.length > 0 ? roleIds.map((roleId) => `<@&${roleId}>`).join(', ') : '`none`';
}

function affiliationList(affiliations: string[]): string {
  return affiliations.length > 0 ? affiliations.map((affiliation) => `\`${affiliation}\``).join(', ') : '`none`';
}

async function verifyCommandMention(env: AppEnv, guildId: string): Promise<string> {
  return globalCommandMention(env, 'verify');
}

async function roleGrantFailureHint(env: AppEnv, guildId: string, error: unknown, failedRoleIds: string[]): Promise<string> {
  const testCommand = await globalCommandMention(env, 'test');
  const configCommand = await globalCommandMention(env, 'config');
  if (error instanceof DiscordPreflightError) {
    switch (error.code) {
      case 'missing_manage_roles':
        return `Grant the bot **Manage Roles**, then run ${testCommand} to confirm the fix.`;
      case 'role_hierarchy':
        return `Move the bot role above ${roleList(failedRoleIds)}, then run ${testCommand} to confirm the fix.`;
      case 'role_not_found':
        return `A mapped role no longer exists. Remove or update the mapping in ${configCommand}, then run ${testCommand}.`;
      case 'role_managed':
        return `A mapped role is integration-managed. Choose a normal server role in ${configCommand}, then run ${testCommand}.`;
      case 'bot_not_in_guild':
        return `Re-invite the bot to this server, then run ${testCommand} to confirm the fix.`;
      case 'user_not_in_guild':
        return 'The linked Discord user is not in this server.';
      default:
        return `Fix the role permission issue, then run ${testCommand} to confirm the fix.`;
    }
  }

  if (error instanceof DiscordApiError) {
    return `Discord rejected the role update with HTTP ${error.status}. Run ${testCommand} after checking bot permissions.`;
  }

  return `Role assignment failed. Run ${testCommand} after checking bot permissions.`;
}

async function logLinkAttempt(env: AppEnv, storage: Storage, flowId: string, guildId: string, guild: Awaited<ReturnType<Storage['getGuildConfig']>>, shib: ShibSession, discord: DiscordSession, grantedRoleIds: string[], failedRoleIds: string[], failureHint?: string): Promise<void> {
  if (!guild?.logLinksEnabled || !guild.adminChannelId) {
    return;
  }

  const roleFields = [
    grantedRoleIds.length > 0 ? `**Granted roles**: ${roleList(grantedRoleIds)}` : undefined,
    failedRoleIds.length > 0 ? `**Failed roles**: ${roleList(failedRoleIds)}` : undefined,
  ].filter(Boolean).join(', ');
  const verifyMention = guild.mode === 'link_and_store' && !guild.verified ? await verifyCommandMention(env, guildId) : undefined;
  const identityLine = guild.mode === 'link_and_store' && guild.verified && shib.uid
    ? `**NetID**: ||\`${shib.uid}\`||, **Affiliation**: ${affiliationList(shib.affiliations)}`
    : `**Affiliation**: ${affiliationList(shib.affiliations)}${guild.mode === 'link_and_store' ? ` (${verifyMention} to see NetID)` : ''}`;

  const fields = [
    `**Discord**: <@${discord.userId}> (\`${discord.userId}\`)${roleFields ? `, ${roleFields}` : ''}`,
    identityLine,
    failureHint ? `⚠️ ${failureHint}` : undefined,
    `-# <t:${Math.floor(Date.now() / 1000)}:R>`,
  ].filter(Boolean).join('\n');

  try {
    await createChannelComponentsMessage(env, guild.adminChannelId, [
      {
        type: 17,
        accent_color: 0xff5f05,
        components: [
          { type: 10, content: fields },
        ],
      },
    ]);
  } catch (error) {
    await storage.createAuditEvent({
      id: randomToken(),
      flowId,
      guildId,
      type: 'link_log_failed',
      metadata: error instanceof DiscordApiError ? { status: error.status, route: error.route } : { code: 'unknown_error' },
      createdAt: Date.now(),
    });
  }
}

export async function confirmLinkFlow(env: AppEnv, storage: Storage, flowId: string, shib: ShibSession | null, discord: DiscordSession | null): Promise<ConfirmResult> {
  const flow = await storage.getLinkFlow(flowId);

  if (!flow || flow.consumedAt || flow.expiresAt <= Date.now() || !shib || !discord) {
    return { ok: false, status: 400, body: { error: 'flow_not_ready' } };
  }

  const ban = await firstActiveBan(storage, [
    { targetType: 'server', targetId: flow.guildId },
    { targetType: 'user', targetId: discord.userId },
    { targetType: 'netid', targetId: shib.uid },
  ]);
  if (ban) {
    return { ok: false, status: 403, body: { error: banError(ban.targetType) } };
  }

  const guild = await storage.getGuildConfig(flow.guildId);
  if (!guild) {
    return { ok: false, status: 404, body: { error: 'unknown_server' } };
  }
  if (!guild.linkingEnabled) {
    return { ok: false, status: 403, body: { error: 'linking_disabled' } };
  }
  if (guild?.mode === 'link_and_store' && !shib.uid) {
    return { ok: false, status: 400, body: { error: 'missing_netid' } };
  }

  const mappings = await storage.listRoleMappings(flow.guildId);
  const roleIds = [...new Set(mappings
    .filter((mapping) => decodeAffiliations(mapping.affiliation).some((affiliation) => shib.affiliations.includes(affiliation)))
    .map((mapping) => mapping.roleId))];

  const grantedRoleIds: string[] = [];
  try {
    for (let index = 0; index < roleIds.length; index += 1) {
      const roleId = roleIds[index];
      await assertCanGrantRole(env, flow.guildId, discord.userId, roleId);
      await addGuildMemberRole(env, flow.guildId, discord.userId, roleId);
      grantedRoleIds.push(roleId);
    }
  } catch (error) {
    const failedRoleIds = roleIds.filter((roleId) => !grantedRoleIds.includes(roleId));
    await storage.createAuditEvent({
      id: randomToken(),
      flowId: flow.id,
      guildId: flow.guildId,
      type: 'role_grant_failed',
      metadata: error instanceof DiscordPreflightError
        ? { code: error.code }
        : error instanceof DiscordApiError
          ? { code: 'discord_api_error', status: error.status, route: error.route }
          : { code: 'unknown_error' },
      createdAt: Date.now(),
    });

    await logLinkAttempt(env, storage, flow.id, flow.guildId, guild, shib, discord, grantedRoleIds, failedRoleIds, await roleGrantFailureHint(env, flow.guildId, error, failedRoleIds));

    if (error instanceof DiscordPreflightError) {
      return { ok: false, status: 409, body: { error: 'discord_preflight_failed', code: error.code } };
    }

    if (error instanceof DiscordApiError) {
      return { ok: false, status: 502, body: { error: 'discord_api_error', status: error.status } };
    }

    throw error;
  }

  const completedFlow = await storage.completeLinkFlow(flow.id, Date.now());
  if (!completedFlow) {
    return { ok: false, status: 409, body: { error: 'flow_already_consumed' } };
  }

  if (guild?.mode === 'link_and_store' && shib.uid) {
    const now = Date.now();
    await storage.upsertStoredLink({
      guildId: flow.guildId,
      discordUserId: discord.userId,
      shibUid: shib.uid,
      shibAffiliations: shib.affiliations,
      createdAt: now,
      updatedAt: now,
    });
  }

  await logLinkAttempt(env, storage, flow.id, flow.guildId, guild, shib, discord, grantedRoleIds, []);

  return { ok: true, rolesGranted: roleIds.length };
}
