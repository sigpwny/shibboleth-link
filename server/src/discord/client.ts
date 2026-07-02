import type { AppEnv } from '../env.js';

const DISCORD_API = 'https://discord.com/api/v10';
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const ATTACH_FILES = 1n << 15n;
const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;

export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly route: string,
  ) {
    super(message);
  }
}

export class DiscordPreflightError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface DiscordOAuthUser {
  id: string;
  username: string;
  discriminator?: string;
  global_name?: string | null;
}

export interface DiscordOAuthMe {
  user: DiscordOAuthUser;
  scopes: string[];
}

export interface DiscordApplicationMe {
  id: string;
  approximate_guild_count?: number;
  bot_approximate_guild_count?: number;
}

export interface DiscordGuildMember {
  user?: DiscordOAuthUser;
  roles: string[];
  permissions?: string;
}

export interface DiscordRole {
  id: string;
  name: string;
  position: number;
  permissions: string;
  managed: boolean;
}

export interface DiscordPermissionOverwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface DiscordChannel {
  id: string;
  guild_id?: string;
  permission_overwrites?: DiscordPermissionOverwrite[];
}

export interface DiscordCommandPayload {
  name: string;
  type: number;
  description?: string;
  default_member_permissions?: string | null;
  contexts?: number[];
  integration_types?: number[];
  options?: unknown[];
}

export interface DiscordRegisteredCommand {
  id: string;
  name: string;
  options?: Array<{
    id?: string;
    name: string;
    type: number;
    options?: Array<{ id?: string; name: string; type: number }>;
  }>;
}

interface DiscordGuildPreview {
  id: string;
  name: string;
  icon: string | null;
  owner_id?: string;
}

async function discordFetch(env: AppEnv, route: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${DISCORD_API}${route}`, {
    ...init,
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new DiscordApiError(`Discord API request failed: ${response.status}`, response.status, route);
  }

  return response;
}

export function discordAuthorizeUrl(env: AppEnv, state: string): string {
  const url = new URL(`${DISCORD_API}/oauth2/authorize`);
  url.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.DISCORD_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export async function exchangeDiscordCode(env: AppEnv, code: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.DISCORD_REDIRECT_URI,
  });

  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error(`Discord token exchange failed: ${response.status}`);
  }

  return response.json() as Promise<DiscordTokenResponse>;
}

export async function getDiscordOAuthMe(token: string): Promise<DiscordOAuthMe> {
  const response = await fetch(`${DISCORD_API}/oauth2/@me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Discord user fetch failed: ${response.status}`);
  }

  return response.json() as Promise<DiscordOAuthMe>;
}

export async function getDiscordApplication(env: AppEnv): Promise<DiscordApplicationMe> {
  const response = await discordFetch(env, '/oauth2/applications/@me');
  return response.json() as Promise<DiscordApplicationMe>;
}

export async function getGuildMember(env: AppEnv, guildId: string, userId: string): Promise<DiscordGuildMember | null> {
  try {
    const response = await discordFetch(env, `/guilds/${guildId}/members/${userId}`);
    return response.json() as Promise<DiscordGuildMember>;
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function listGuildRoles(env: AppEnv, guildId: string): Promise<DiscordRole[]> {
  const response = await discordFetch(env, `/guilds/${guildId}/roles`);
  return response.json() as Promise<DiscordRole[]>;
}

export async function getDiscordChannel(env: AppEnv, channelId: string): Promise<DiscordChannel> {
  const response = await discordFetch(env, `/channels/${channelId}`);
  return response.json() as Promise<DiscordChannel>;
}

export async function getDiscordGuild(env: AppEnv, guildId: string): Promise<{ id: string; name: string; iconUrl?: string; ownerId?: string }> {
  const response = await discordFetch(env, `/guilds/${guildId}`);
  const guild = await response.json() as DiscordGuildPreview;
  return {
    id: guild.id,
    name: guild.name,
    iconUrl: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128` : undefined,
    ownerId: guild.owner_id,
  };
}

export function computeMemberGuildPermissions(guildId: string, member: DiscordGuildMember, roles: DiscordRole[]): bigint {
  let permissions = BigInt(roles.find((role) => role.id === guildId)?.permissions ?? '0');

  for (const roleId of member.roles) {
    const role = roles.find((candidate) => candidate.id === roleId);
    if (role) {
      permissions |= BigInt(role.permissions);
    }
  }

  return permissions;
}

export function hasManageRolesPermission(permissions: bigint): boolean {
  return (permissions & ADMINISTRATOR) !== 0n || (permissions & MANAGE_ROLES) !== 0n;
}

export function hasSendMessagesPermission(permissions: bigint): boolean {
  return (permissions & ADMINISTRATOR) !== 0n || ((permissions & VIEW_CHANNEL) !== 0n && (permissions & SEND_MESSAGES) !== 0n);
}

export function hasAttachFilesPermission(permissions: bigint): boolean {
  return (permissions & ADMINISTRATOR) !== 0n || ((permissions & VIEW_CHANNEL) !== 0n && (permissions & SEND_MESSAGES) !== 0n && (permissions & ATTACH_FILES) !== 0n);
}

export function missingChannelMessagePermissions(permissions: bigint, options: { requireAttachFiles?: boolean } = {}): string[] {
  if ((permissions & ADMINISTRATOR) !== 0n) {
    return [];
  }

  return [
    (permissions & VIEW_CHANNEL) === 0n ? 'View Channel' : undefined,
    (permissions & SEND_MESSAGES) === 0n ? 'Send Messages' : undefined,
    options.requireAttachFiles && (permissions & ATTACH_FILES) === 0n ? 'Attach Files' : undefined,
  ].filter((permission): permission is string => Boolean(permission));
}

export function computeChannelPermissions(guildId: string, member: DiscordGuildMember, roles: DiscordRole[], channel: DiscordChannel): bigint {
  let permissions = computeMemberGuildPermissions(guildId, member, roles);
  if ((permissions & ADMINISTRATOR) !== 0n) {
    return permissions;
  }

  const overwrites = channel.permission_overwrites ?? [];
  const everyone = overwrites.find((overwrite) => overwrite.id === guildId && overwrite.type === 0);
  if (everyone) {
    permissions = (permissions & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  }

  let allow = 0n;
  let deny = 0n;
  for (const roleId of member.roles) {
    const overwrite = overwrites.find((candidate) => candidate.id === roleId && candidate.type === 0);
    if (overwrite) {
      allow |= BigInt(overwrite.allow);
      deny |= BigInt(overwrite.deny);
    }
  }
  permissions = (permissions & ~deny) | allow;

  const memberId = member.user?.id;
  const memberOverwrite = memberId ? overwrites.find((overwrite) => overwrite.id === memberId && overwrite.type === 1) : undefined;
  if (memberOverwrite) {
    permissions = (permissions & ~BigInt(memberOverwrite.deny)) | BigInt(memberOverwrite.allow);
  }

  return permissions;
}

export async function registerGlobalCommands(env: AppEnv, commands: DiscordCommandPayload[]): Promise<void> {
  await discordFetch(env, `/applications/${env.DISCORD_CLIENT_ID}/commands`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
}

export async function registerGuildCommands(env: AppEnv, guildId: string, commands: DiscordCommandPayload[]): Promise<void> {
  await discordFetch(env, `/applications/${env.DISCORD_CLIENT_ID}/guilds/${guildId}/commands`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
}

export async function listGlobalCommands(env: AppEnv): Promise<DiscordRegisteredCommand[]> {
  const response = await discordFetch(env, `/applications/${env.DISCORD_CLIENT_ID}/commands`);
  return response.json() as Promise<DiscordRegisteredCommand[]>;
}

export async function listGuildCommands(env: AppEnv, guildId: string): Promise<DiscordRegisteredCommand[]> {
  const response = await discordFetch(env, `/applications/${env.DISCORD_CLIENT_ID}/guilds/${guildId}/commands`);
  return response.json() as Promise<DiscordRegisteredCommand[]>;
}

export function hasAdminConfigPermission(permissions: string | undefined): boolean {
  if (!permissions) {
    return false;
  }
  const bits = BigInt(permissions);
  return (bits & ADMINISTRATOR) !== 0n || (bits & MANAGE_ROLES) !== 0n;
}

export async function assertCanGrantRole(env: AppEnv, guildId: string, userId: string, roleId: string): Promise<void> {
  const [application, roles] = await Promise.all([
    getDiscordApplication(env),
    listGuildRoles(env, guildId),
  ]);

  const [botMember, targetMember] = await Promise.all([
    getGuildMember(env, guildId, application.id),
    getGuildMember(env, guildId, userId),
  ]);

  if (!botMember) {
    throw new DiscordPreflightError('bot_not_in_guild', 'The Discord bot is not a member of the target guild.');
  }

  if (!targetMember) {
    throw new DiscordPreflightError('user_not_in_guild', 'The linked Discord user is not a member of the target guild.');
  }

  const botPermissions = botMember.permissions !== undefined
    ? BigInt(botMember.permissions)
    : computeMemberGuildPermissions(guildId, botMember, roles);

  if (!hasManageRolesPermission(botPermissions)) {
    throw new DiscordPreflightError('missing_manage_roles', 'The Discord bot is missing Manage Roles permission.');
  }

  const targetRole = roles.find((role) => role.id === roleId);
  if (!targetRole) {
    throw new DiscordPreflightError('role_not_found', 'The target Discord role does not exist.');
  }

  if (targetRole.managed) {
    throw new DiscordPreflightError('role_managed', 'The target Discord role is managed by an integration.');
  }

  const botTopRolePosition = roles
    .filter((role) => botMember.roles.includes(role.id))
    .reduce((max, role) => Math.max(max, role.position), 0);

  if (botTopRolePosition <= targetRole.position) {
    throw new DiscordPreflightError('role_hierarchy', 'The bot top role is not above the target role.');
  }
}

export async function addGuildMemberRole(env: AppEnv, guildId: string, userId: string, roleId: string): Promise<void> {
  await discordFetch(env, `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: 'PUT' });
}

export async function createChannelMessage(env: AppEnv, channelId: string, content: string): Promise<void> {
  await discordFetch(env, `/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
}

export async function createChannelComponentsMessage(env: AppEnv, channelId: string, components: unknown[]): Promise<void> {
  await discordFetch(env, `/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      flags: 1 << 15,
      components,
      allowed_mentions: { parse: [] },
    }),
  });
}
