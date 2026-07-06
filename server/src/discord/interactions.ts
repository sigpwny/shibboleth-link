import nacl from 'tweetnacl';
import type { AppEnv } from '../env.js';
import { getDiscordGuild, assertCanGrantRole, DiscordPreflightError, getDiscordApplication, getGuildMember, listGuildRoles, DiscordApiError, computeMemberGuildPermissions, computeChannelPermissions, getDiscordChannel, hasAdminConfigPermission, hasManageRolesPermission, missingChannelMessagePermissions } from './client.js';
import { affiliationMask, affiliationSelectOptions, affiliationsFromMask, decodeAffiliations, encodeAffiliations, prettyAffiliations } from './affiliations.js';
import { globalCommandMention } from './mentions.js';
import { logServerAdded } from './operator-log.js';
import type { BanTargetType, Storage } from '../storage/types.js';
import { randomToken } from '../crypto.js';
import { verificationSatisfied } from '../verify/policy.js';
import { discordTimestamp, firstActiveBan, formatBanExpiration, normalizeBanTarget, parseExpiration } from '../bans.js';
import { RequestBodyTooLargeError, readTextBody } from '../request-body.js';

const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const MODAL_SUBMIT = 5;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const UPDATE_MESSAGE = 7;
const MODAL = 9;
const EPHEMERAL = 1 << 6;
const IS_COMPONENTS_V2 = 1 << 15;
const UIUC_ORANGE = 0xff5f05;
const ADMINISTRATOR = 1n << 3n;
const VERIFIED_SERVER_LABEL = '<:verify_green:1518510352768303124> Verified Server';
const DISCORD_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
const DISCORD_INTERACTION_BODY_LIMIT_BYTES = 64 * 1024;

type Option = {
  name: string;
  type: number;
  value?: string;
  options?: Option[];
};

type Component = {
  type: number;
  content?: string;
  value?: string;
  custom_id?: string;
  values?: string[];
  components?: Component[];
};

type Interaction = {
  type: number;
  guild_id?: string;
  channel_id?: string;
  channel?: { id?: string; parent_id?: string | null };
  member?: { permissions?: string; user?: { id: string } };
  user?: { id: string };
  data?: {
    type?: number;
    name?: string;
    options?: Option[];
    custom_id?: string;
    values?: string[];
    components?: Component[];
    target_id?: string;
    resolved?: {
      messages?: Record<string, { author?: { id?: string } }>;
    };
  };
  message?: { components?: Component[] };
};

const FLOW_TTL_MS = 15 * 60 * 1000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function message(content: string, ephemeral = true): Response {
  return jsonResponse({
    type: CHANNEL_MESSAGE,
    data: {
      content,
      flags: ephemeral ? EPHEMERAL : 0,
      allowed_mentions: { parse: [] },
    },
  });
}

function componentMessage(components: unknown[], ephemeral = true, update = false): Response {
  const data: Record<string, unknown> = {
    components,
    allowed_mentions: { parse: [] },
  };

  if (!update) {
    data.flags = (ephemeral ? EPHEMERAL : 0) | IS_COMPONENTS_V2;
  }

  return jsonResponse({
    type: update ? UPDATE_MESSAGE : CHANNEL_MESSAGE,
    data,
  });
}

function interactiveMessage(content: string, components: unknown[], ephemeral = true, update = false): Response {
  const data: Record<string, unknown> = {
    content,
    components,
    allowed_mentions: { parse: [] },
  };
  if (!update) {
    data.flags = ephemeral ? EPHEMERAL : 0;
  }

  return jsonResponse({
    type: update ? UPDATE_MESSAGE : CHANNEL_MESSAGE,
    data,
  });
}

function modalResponse(customId: string, title: string, label: string): Response {
  return jsonResponse({
    type: MODAL,
    data: {
      custom_id: customId,
      title,
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'confirmation',
              style: 1,
              label,
              required: true,
              min_length: 1,
              max_length: 32,
            },
          ],
        },
      ],
    },
  });
}

function attachmentMessage(content: string, filename: string, fileContent: string): Response {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    type: CHANNEL_MESSAGE,
    data: {
      content,
      attachments: [{ id: '0', filename }],
      allowed_mentions: { parse: [] },
    },
  }));
  form.append('files[0]', new Blob([fileContent], { type: 'text/csv;charset=utf-8' }), filename);
  return new Response(form);
}

async function adminEphemeral(storage: Storage, interaction: Interaction): Promise<boolean> {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return true;
  }
  const config = await storage.getGuildConfig(guildId);
  const interactionChannelIds = new Set([
    interaction.channel_id,
    interaction.channel?.id,
    interaction.channel?.parent_id ?? undefined,
  ].filter((value): value is string => Boolean(value)));
  return !config?.adminChannelId || !interactionChannelIds.has(config.adminChannelId);
}

async function requireAdminChannel(storage: Storage, interaction: Interaction): Promise<{ ok: true; guildId: string } | { ok: false; response: Response }> {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return { ok: false, response: message('⚠️ This command can only be used in a server.') };
  }

  const config = await storage.getGuildConfig(guildId);
  const interactionChannelIds = new Set([
    interaction.channel_id,
    interaction.channel?.id,
    interaction.channel?.parent_id ?? undefined,
  ].filter((value): value is string => Boolean(value)));

  if (!config?.adminChannelId || !interactionChannelIds.has(config.adminChannelId)) {
    return { ok: false, response: message('⚠️ This command can only be used in the configured admin channel.') };
  }

  return { ok: true, guildId };
}

function roleMention(roleId: string): string {
  return `<@&${roleId}>`;
}

function mappingLine(affiliations: string[], roleId: string): string {
  return `- ${affiliations.map(prettyAffiliations).join(', ')} → ${roleMention(roleId)}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function userId(interaction: Interaction): string | undefined {
  return interaction.member?.user?.id ?? interaction.user?.id;
}

function assertSetupOwner(interaction: Interaction, ownerId: string): Response | null {
  return userId(interaction) === ownerId ? null : message('⚠️ Only the user who opened this config panel can use these controls.');
}

function requireCurrentAdminConfigPermission(interaction: Interaction): Response | null {
  return hasAdminConfigPermission(interaction.member?.permissions)
    ? null
    : message('⚠️ You need current server administrator or Manage Roles permission to use this control.');
}

function flattenComponents(components: Component[] | undefined): Component[] {
  const result: Component[] = [];
  for (const component of components ?? []) {
    result.push(component);
    result.push(...flattenComponents(component.components));
  }
  return result;
}

function setupChangesFromInteraction(interaction: Interaction): string[] {
  const changesText = flattenComponents(interaction.message?.components)
    .find((component) => component.type === 10 && component.content?.startsWith('**Changes made**'))
    ?.content;

  if (!changesText) {
    return [];
  }

  return changesText
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);
}

function setupCustomId(action: string, guildId: string, ownerId: string, data?: string): string {
  return ['setup', action, guildId, ownerId, data ? encodeURIComponent(data) : undefined]
    .filter((part): part is string => Boolean(part))
    .join(':');
}

function parseSetupCustomId(customId: string | undefined): { action: string; guildId: string; ownerId: string; data?: string } | null {
  const parts = customId?.split(':') ?? [];
  if (parts.length < 4 || parts.length > 5 || parts[0] !== 'setup') {
    return null;
  }
  return { action: parts[1], guildId: parts[2], ownerId: parts[3], data: parts[4] ? decodeURIComponent(parts[4]) : undefined };
}

function deleteDataCustomId(action: 'cancel' | 'modal' | 'ready' | 'execute', guildId: string, ownerId: string): string {
  return ['delete-data', action, guildId, ownerId].join(':');
}

function parseDeleteDataCustomId(customId: string | undefined): { action: string; guildId: string; ownerId: string } | null {
  const parts = customId?.split(':') ?? [];
  if (parts.length !== 4 || parts[0] !== 'delete-data') {
    return null;
  }
  return { action: parts[1], guildId: parts[2], ownerId: parts[3] };
}

function modalValue(components: Component[] | undefined, customId: string): string | undefined {
  return flattenComponents(components).find((component) => component.custom_id === customId)?.value;
}

function encodeDraft(affiliations: string[] | string, roleId?: string): string {
  const encodedAffiliations = Array.isArray(affiliations) ? encodeAffiliations(affiliations) : affiliations;
  const mask = affiliationMask(decodeAffiliations(encodedAffiliations)).toString(36);
  return `${mask}.${roleId ?? ''}`;
}

function decodeDraft(data: string | undefined): { affiliations: string; roleId?: string } {
  if (data?.includes('.')) {
    const [maskValue = '0', roleId = ''] = data.split('.');
    const mask = Number.parseInt(maskValue, 36) || 0;
    return { affiliations: encodeAffiliations(affiliationsFromMask(mask)), roleId: roleId || undefined };
  }

  const [affiliations = '', roleId = ''] = (data ?? '').split('|');
  return { affiliations, roleId: roleId || undefined };
}

function encodeBooleanDraft(value?: boolean): string | undefined {
  return value === undefined ? undefined : value ? '1' : '0';
}

function decodeBooleanDraft(value: string | undefined): boolean | undefined {
  if (value === '1') return true;
  if (value === '0') return false;
  return undefined;
}

function decodeModeDraft(value: string | undefined): 'confirm_only' | 'link_and_store' | undefined {
  return value === 'confirm_only' || value === 'link_and_store' ? value : undefined;
}

function prettyMode(mode: 'confirm_only' | 'link_and_store'): string {
  return mode === 'link_and_store' ? 'Link and Store' : 'Confirm Only';
}

async function warningText(env: AppEnv, guildId: string, error: DiscordPreflightError): Promise<string> {
  const testCommand = await globalCommandMention(env, 'test');
  switch (error.code) {
    case 'bot_not_in_guild':
      return `I am not in this server. Re-invite the bot, then run ${testCommand} again.`;
    case 'user_not_in_guild':
      return 'The test user is not in this server. This should not block saving the mapping, but role grants require users to be in the server.';
    case 'missing_manage_roles':
      return `I am missing **Manage Roles**. Give the bot Manage Roles, then run ${testCommand} again.`;
    case 'role_not_found':
      return 'That role no longer exists. Pick another role.';
    case 'role_managed':
      return 'That role is managed by an integration. Pick a normal server role.';
    case 'role_hierarchy':
      return `My highest role must be above the role I grant. Move the bot role higher, then run ${testCommand} again.`;
    default:
      return error.message;
  }
}

function optionValue(options: Option[] | undefined, name: string): string | undefined {
  const option = options?.find((candidate) => candidate.name === name);
  return typeof option?.value === 'string' ? option.value : undefined;
}

function hasAdministratorPermission(permissions: string | undefined): boolean {
  return Boolean(permissions) && (BigInt(permissions!) & ADMINISTRATOR) !== 0n;
}

function operatorAllowed(env: AppEnv, interaction: Interaction): boolean {
  return Boolean(
    env.OPERATOR_GUILD_ID
    && env.OPERATOR_CHANNEL_ID
    && interaction.guild_id === env.OPERATOR_GUILD_ID
    && interaction.channel_id === env.OPERATOR_CHANNEL_ID
    && hasAdministratorPermission(interaction.member?.permissions),
  );
}

async function verifySignature(env: AppEnv, request: Request, rawBody: string): Promise<boolean> {
  if (!env.DISCORD_PUBLIC_KEY) {
    throw new Error('Missing DISCORD_PUBLIC_KEY');
  }

  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  if (!signature || !timestamp) {
    return false;
  }

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > DISCORD_SIGNATURE_MAX_AGE_MS) {
    return false;
  }

  return nacl.sign.detached.verify(
    new TextEncoder().encode(timestamp + rawBody),
    Buffer.from(signature, 'hex'),
    Buffer.from(env.DISCORD_PUBLIC_KEY, 'hex'),
  );
}

async function ensureGuild(storage: Storage, env: AppEnv, guildId: string) {
  const existing = await storage.getGuildConfig(guildId);
  const now = Date.now();
  try {
    const guild = await getDiscordGuild(env, guildId);
    const config = {
      guildId,
      name: guild.name,
      iconUrl: guild.iconUrl,
      adminChannelId: existing?.adminChannelId,
      logLinksEnabled: existing?.logLinksEnabled ?? false,
      linkingEnabled: existing?.linkingEnabled ?? true,
      mode: existing?.mode ?? 'confirm_only' as const,
      verified: existing?.verified ?? false,
      verificationExpiresAt: existing?.verificationExpiresAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await storage.upsertGuildConfig(config);
    if (!existing) {
      await logServerAdded(env, config);
    }
    return config;
  } catch {
    if (existing) {
      return existing;
    }
    const config = {
      guildId,
      name: `Discord server ${guildId}`,
      iconUrl: undefined,
      adminChannelId: undefined,
      logLinksEnabled: false,
      linkingEnabled: true,
      mode: 'confirm_only' as const,
      verified: false,
      verificationExpiresAt: undefined,
      createdAt: now,
      updatedAt: now,
    };
    await storage.upsertGuildConfig(config);
    await logServerAdded(env, config);
    return config;
  }
}

async function missingBotChannelMessagePermissions(env: AppEnv, guildId: string, channelId: string, options: { requireAttachFiles?: boolean } = {}): Promise<string[]> {
  try {
    const [application, roles, channel] = await Promise.all([
      getDiscordApplication(env),
      listGuildRoles(env, guildId),
      getDiscordChannel(env, channelId),
    ]);
    const botMember = await getGuildMember(env, guildId, application.id);
    if (!botMember) {
      return ['View Channel', 'Send Messages', ...(options.requireAttachFiles ? ['Attach Files'] : [])];
    }
    return missingChannelMessagePermissions(computeChannelPermissions(guildId, botMember, roles, channel), options);
  } catch {
    return ['View Channel', 'Send Messages', ...(options.requireAttachFiles ? ['Attach Files'] : [])];
  }
}

function formatMissingPermissions(permissions: string[]): string {
  return permissions.length === 1 ? permissions[0] : permissions.join(' and ');
}

function isAdminInteraction(interaction: Interaction): boolean {
  return hasAdministratorPermission(interaction.member?.permissions);
}

async function setupPanel(env: AppEnv, storage: Storage, guildId: string, ownerId: string, changesMade: string[] = []) {
  const config = await ensureGuild(storage, env, guildId);
  const mappings = await storage.listRoleMappings(guildId);
  const verifyCommand = await globalCommandMention(env, 'verify');
  const adminChannelMissingPermissions = config.logLinksEnabled && config.adminChannelId ? await missingBotChannelMessagePermissions(env, guildId, config.adminChannelId) : [];
  const mappingRows = mappings.length > 0
    ? mappings.map((mapping) => mappingLine(decodeAffiliations(mapping.affiliation), mapping.roleId)).join('\n')
    : 'No role mappings configured yet.';
  const serverSummaryText = `**${config.name}**\n\`${guildId}\`\n${config.verified ? VERIFIED_SERVER_LABEL : `Not Verified (${verifyCommand})`}`;
  const serverSummary = config.iconUrl
    ? {
        type: 9,
        components: [
          {
            type: 10,
            content: serverSummaryText,
          },
        ],
        accessory: {
          type: 11,
          media: { url: config.iconUrl },
          description: config.name,
        },
      }
    : {
        type: 10,
        content: serverSummaryText,
      };

  const changes = changesMade.length > 0
    ? [
        { type: 10, content: `**Changes made**\n${changesMade.join('\n')}` },
      ]
    : [];

  return [
    {
      type: 17,
      accent_color: UIUC_ORANGE,
      components: [
        serverSummary,
        {
          type: 9,
          components: [
            { type: 10, content: `**Allow linking**\n\`${config.linkingEnabled ? 'Enabled' : 'Disabled'}\`` },
          ],
          accessory: { type: 2, style: 2, label: 'Edit', custom_id: setupCustomId('l', guildId, ownerId) },
        },
        {
          type: 9,
          components: [
            { type: 10, content: `**Mode**\n\`${prettyMode(config.mode)}\`` },
          ],
          accessory: { type: 2, style: 2, label: 'Edit', custom_id: setupCustomId('m', guildId, ownerId) },
        },
        {
          type: 9,
          components: [
            { type: 10, content: `**Admin channel**\n${config.adminChannelId ? `<#${config.adminChannelId}>` : '`Not configured`'}` },
          ],
          accessory: { type: 2, style: 2, label: 'Edit', custom_id: setupCustomId('c', guildId, ownerId) },
        },
        {
          type: 9,
          components: [
            { type: 10, content: `**Logging to admin channel**\n\`${config.logLinksEnabled ? 'Enabled' : 'Disabled'}\`` },
          ],
          accessory: { type: 2, style: 2, label: 'Edit', custom_id: setupCustomId('g', guildId, ownerId) },
        },
        ...(config.logLinksEnabled && (!config.adminChannelId || adminChannelMissingPermissions.length > 0)
          ? [{ type: 10, content: config.adminChannelId
            ? `⚠️ Admin channel logging is enabled, but I am missing ${formatMissingPermissions(adminChannelMissingPermissions)} in <#${config.adminChannelId}>.`
            : '⚠️ Admin channel logging is enabled, but no admin channel is configured.' }]
          : []),
        {
          type: 10,
          content: `**Role mappings**\n${mappingRows}`,
        },
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: 'Add role map', custom_id: setupCustomId('a', guildId, ownerId), disabled: mappings.length >= 5 },
            { type: 2, style: 2, label: 'Remove role map', custom_id: setupCustomId('r', guildId, ownerId), disabled: mappings.length === 0 },
          ],
        },
        { type: 14, divider: true, spacing: 1 },
        ...changes,
        {
          type: 1,
          components: [
            { type: 2, style: 2, label: 'Refresh', custom_id: setupCustomId('f', guildId, ownerId) },
          ],
        },
      ],
    },
  ];
}

async function setupResponse(env: AppEnv, storage: Storage, interaction: Interaction, notice?: string, update = false): Promise<Response> {
  const guildId = interaction.guild_id;
  const ownerId = userId(interaction);
  if (!guildId || !ownerId) {
    return message('⚠️ Config can only be used in a server.');
  }
  const changesMade = [...setupChangesFromInteraction(interaction), ...(notice ? [notice] : [])].slice(-10);
  return componentMessage(await setupPanel(env, storage, guildId, ownerId, changesMade), await adminEphemeral(storage, interaction), update);
}

async function addMappingDraft(env: AppEnv, storage: Storage, interaction: Interaction, setup: { guildId: string; ownerId: string }, data?: string): Promise<Response> {
  const draft = decodeDraft(data);
  const selectedAffiliations = new Set(decodeAffiliations(draft.affiliations));
  const saveDisabled = !draft.affiliations || !draft.roleId;
  const changesMade = setupChangesFromInteraction(interaction);

  return componentMessage([
    ...await setupPanel(env, storage, setup.guildId, setup.ownerId, changesMade),
    {
      type: 17,
      accent_color: UIUC_ORANGE,
      components: [
        {
          type: 10,
          content: '**Add role mapping**\nSelect one or more affiliations and the role to grant. Matching **any** selected affiliation grants the role.',
        },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: setupCustomId('af', setup.guildId, setup.ownerId, encodeDraft(draft.affiliations, draft.roleId)),
              placeholder: 'Select affiliations',
              min_values: 1,
              max_values: 4,
              options: affiliationSelectOptions().map((option) => ({ ...option, default: selectedAffiliations.has(option.value) })),
            },
          ],
        },
        {
          type: 1,
          components: [
            {
              type: 6,
              custom_id: setupCustomId('ar', setup.guildId, setup.ownerId, encodeDraft(draft.affiliations, draft.roleId)),
              placeholder: 'Select role to grant',
              min_values: 1,
              max_values: 1,
              default_values: draft.roleId ? [{ id: draft.roleId, type: 'role' }] : undefined,
            },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: 'Save', custom_id: setupCustomId('as', setup.guildId, setup.ownerId, encodeDraft(draft.affiliations, draft.roleId)), disabled: saveDisabled },
            { type: 2, style: 2, label: 'Cancel', custom_id: setupCustomId('x', setup.guildId, setup.ownerId) },
          ],
        },
      ],
    },
  ], await adminEphemeral(storage, interaction), true);
}

async function linkingDraft(env: AppEnv, storage: Storage, interaction: Interaction, setup: { guildId: string; ownerId: string }, data?: string): Promise<Response> {
  const config = await storage.getGuildConfig(setup.guildId);
  const selected = decodeBooleanDraft(data) ?? config?.linkingEnabled ?? true;
  const changesMade = setupChangesFromInteraction(interaction);

  return componentMessage([
    ...await setupPanel(env, storage, setup.guildId, setup.ownerId, changesMade),
    {
      type: 17,
      accent_color: UIUC_ORANGE,
      components: [
        { type: 10, content: '**Edit allow linking**\nWhen disabled, users cannot start linking or receive roles.' },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: setupCustomId('ls', setup.guildId, setup.ownerId, encodeBooleanDraft(selected)),
              placeholder: 'Select allow linking status',
              min_values: 1,
              max_values: 1,
              options: [
                { label: 'Enabled', value: '1', description: 'Users can link accounts and receive roles.', default: selected },
                { label: 'Disabled', value: '0', description: 'New linking and role grants are blocked.', default: !selected },
              ],
            },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: 'Save', custom_id: setupCustomId('lv', setup.guildId, setup.ownerId, encodeBooleanDraft(selected)), disabled: data === undefined },
            { type: 2, style: 2, label: 'Cancel', custom_id: setupCustomId('x', setup.guildId, setup.ownerId) },
          ],
        },
      ],
    },
  ], await adminEphemeral(storage, interaction), true);
}

async function modeDraft(env: AppEnv, storage: Storage, interaction: Interaction, setup: { guildId: string; ownerId: string }, data?: string, error?: string): Promise<Response> {
  const config = await storage.getGuildConfig(setup.guildId);
  const selected = decodeModeDraft(data) ?? config?.mode ?? 'confirm_only';
  const changesMade = setupChangesFromInteraction(interaction);
  const deleteLinksCommand = await globalCommandMention(env, 'delete-links');

  return componentMessage([
    ...await setupPanel(env, storage, setup.guildId, setup.ownerId, changesMade),
    {
      type: 17,
      accent_color: UIUC_ORANGE,
      components: [
        {
          type: 10,
          content: [
            '**Edit Mode**',
            '- **Confirm Only** grants roles for each link attempt and then deletes the user identity cookies. It does not store account links, track NetIDs, or keep a server member database.',
            '- **Link and Store** grants roles and stores a server-scoped account link in the Shibboleth Link database, including Discord user ID, NetID, and UIUC affiliations. Unverified servers can store links, but NetID-revealing features such as lookup, export, and NetID logging require Verified Server status.',
            `Switching back to Confirm Only does not delete existing stored links. Use ${deleteLinksCommand} to delete stored links for this server.`,
            error ? `⚠️ ${error}` : undefined,
          ].filter(Boolean).join('\n'),
        },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: setupCustomId('ms', setup.guildId, setup.ownerId, selected),
              placeholder: 'Select privacy mode',
              min_values: 1,
              max_values: 1,
              options: [
                { label: 'Confirm Only', value: 'confirm_only', description: 'No stored account links or NetID tracking.', default: selected === 'confirm_only' },
                { label: 'Link and Store', value: 'link_and_store', description: 'Store server-scoped Discord, NetID, and affiliation links.', default: selected === 'link_and_store' },
              ],
            },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: 'Save', custom_id: setupCustomId('mv', setup.guildId, setup.ownerId, selected), disabled: data === undefined || selected === config?.mode },
            { type: 2, style: 2, label: 'Cancel', custom_id: setupCustomId('x', setup.guildId, setup.ownerId) },
          ],
        },
      ],
    },
  ], await adminEphemeral(storage, interaction), true);
}

async function logLinksDraft(env: AppEnv, storage: Storage, interaction: Interaction, setup: { guildId: string; ownerId: string }, data?: string): Promise<Response> {
  const config = await storage.getGuildConfig(setup.guildId);
  const selected = decodeBooleanDraft(data) ?? config?.logLinksEnabled ?? false;
  const changesMade = setupChangesFromInteraction(interaction);

  return componentMessage([
    ...await setupPanel(env, storage, setup.guildId, setup.ownerId, changesMade),
    {
      type: 17,
      accent_color: UIUC_ORANGE,
      components: [
        {
          type: 10,
          content: '**Edit admin channel logging**\nWhen enabled, Shibboleth Link will log events such as user links and errors to the configured admin channel.',
        },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: setupCustomId('gs', setup.guildId, setup.ownerId, encodeBooleanDraft(selected)),
              placeholder: 'Select admin channel logging status',
              min_values: 1,
              max_values: 1,
              options: [
                { label: 'Enabled', value: '1', description: 'Log relevant events to the admin channel.', default: selected },
                { label: 'Disabled', value: '0', description: 'Do not post logs to the admin channel.', default: !selected },
              ],
            },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: 'Save', custom_id: setupCustomId('gv', setup.guildId, setup.ownerId, encodeBooleanDraft(selected)), disabled: data === undefined || selected === (config?.logLinksEnabled ?? false) },
            { type: 2, style: 2, label: 'Cancel', custom_id: setupCustomId('x', setup.guildId, setup.ownerId) },
          ],
        },
      ],
    },
  ], await adminEphemeral(storage, interaction), true);
}

async function channelDraft(env: AppEnv, storage: Storage, interaction: Interaction, setup: { guildId: string; ownerId: string }, channelId?: string): Promise<Response> {
  const config = await storage.getGuildConfig(setup.guildId);
  const selectedChannelId = channelId ?? config?.adminChannelId;
  const changesMade = setupChangesFromInteraction(interaction);

  return componentMessage([
    ...await setupPanel(env, storage, setup.guildId, setup.ownerId, changesMade),
    {
      type: 17,
      accent_color: UIUC_ORANGE,
      components: [
        { type: 10, content: '**Set admin channel**\nAdministrative command output is public only in this channel. Commands used elsewhere remain ephemeral.' },
        {
          type: 1,
          components: [
            {
              type: 8,
              custom_id: setupCustomId('cs', setup.guildId, setup.ownerId, selectedChannelId),
              placeholder: 'Select admin channel',
              min_values: 1,
              max_values: 1,
              channel_types: [0],
              default_values: selectedChannelId ? [{ id: selectedChannelId, type: 'channel' }] : undefined,
            },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, style: 1, label: 'Save', custom_id: setupCustomId('cv', setup.guildId, setup.ownerId, selectedChannelId), disabled: !selectedChannelId },
            { type: 2, style: 2, label: 'Cancel', custom_id: setupCustomId('x', setup.guildId, setup.ownerId) },
          ],
        },
      ],
    },
  ], await adminEphemeral(storage, interaction), true);
}

async function removeMappingSelect(env: AppEnv, storage: Storage, interaction: Interaction, setup: { guildId: string; ownerId: string }, selectedAffiliation?: string, selectedRoleId?: string): Promise<Response> {
  const mappings = await storage.listRoleMappings(setup.guildId);
  const changesMade = setupChangesFromInteraction(interaction);
  const roleNames = new Map(
    await listGuildRoles(env, setup.guildId)
      .then((roles) => roles.map((role) => [role.id, role.name] as const))
      .catch(() => []),
  );

  return componentMessage([
    ...await setupPanel(env, storage, setup.guildId, setup.ownerId, changesMade),
    {
      type: 17,
      accent_color: UIUC_ORANGE,
      components: [
        { type: 10, content: '**Remove role mapping**\nSelect the mapping to remove.' },
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: setupCustomId('rs', setup.guildId, setup.ownerId, selectedAffiliation),
              placeholder: 'Select mapping to remove',
              min_values: 1,
              max_values: 1,
              options: mappings.slice(0, 25).map((mapping) => ({
                label: truncate(`${prettyAffiliations(mapping.affiliation)} -> ${roleNames.has(mapping.roleId) ? `@${roleNames.get(mapping.roleId)}` : 'missing role'}`, 100),
                value: mapping.affiliation,
                description: truncate(`Role ID: ${mapping.roleId}`, 100),
                default: mapping.affiliation === selectedAffiliation,
              })),
            },
          ],
        },
        {
          type: 1,
          components: [
            { type: 2, style: 4, label: 'Delete', custom_id: setupCustomId('rv', setup.guildId, setup.ownerId, selectedAffiliation), disabled: !selectedAffiliation },
            { type: 2, style: 2, label: 'Cancel', custom_id: setupCustomId('x', setup.guildId, setup.ownerId) },
          ],
        },
      ],
    },
  ], await adminEphemeral(storage, interaction), true);
}

async function handleRoleCommand(env: AppEnv, storage: Storage, interaction: Interaction, subcommand: Option): Promise<Response> {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return message('⚠️ This command can only be used in a server.');
  }

  const ephemeral = await adminEphemeral(storage, interaction);

  await ensureGuild(storage, env, guildId);

  if (subcommand.name === 'add') {
    const rawAffiliation = optionValue(subcommand.options, 'affiliation');
    const affiliation = rawAffiliation ? encodeAffiliations([rawAffiliation]) : '';
    const roleId = optionValue(subcommand.options, 'role');
    if (!affiliation || !roleId) {
      return message('⚠️ Missing affiliation or role.', ephemeral);
    }

    await storage.upsertRoleMapping({ guildId, affiliation, roleId });

    try {
      const appUserId = env.DISCORD_CLIENT_ID;
      await assertCanGrantRole(env, guildId, appUserId, roleId);
      const testCommand = await globalCommandMention(env, 'test');
      return message([
        '✅ **Role mapping saved**',
        '',
        mappingLine([affiliation], roleId),
        '',
        `I can grant this role. Run ${testCommand} any time to re-check configuration.`,
      ].join('\n'), ephemeral);
    } catch (error) {
      const warning = error instanceof DiscordPreflightError
        ? await warningText(env, guildId, error)
        : 'I could not verify bot role permissions right now.';
      const testCommand = await globalCommandMention(env, 'test');
      return message([
        '⚠️ **Role mapping saved, but configuration needs attention**',
        '',
        mappingLine([affiliation], roleId),
        '',
        warning,
        '',
        `After fixing it, run ${testCommand} to verify configuration.`,
      ].join('\n'), ephemeral);
    }
  }

  if (subcommand.name === 'remove') {
    const rawAffiliation = optionValue(subcommand.options, 'affiliation');
    const affiliation = rawAffiliation ? encodeAffiliations([rawAffiliation]) : '';
    if (!affiliation) {
      return message('⚠️ Missing affiliation.', ephemeral);
    }
    const removed = await storage.removeRoleMapping(guildId, affiliation);
    const content = removed
      ? `✅ Removed the mapping for ${prettyAffiliations(affiliation)}.`
      : `ℹ️ No mapping existed for ${prettyAffiliations(affiliation)}.`;
    return message(content, ephemeral);
  }

  if (subcommand.name === 'list') {
    const mappings = await storage.listRoleMappings(guildId);
    if (mappings.length === 0) {
      const roleAddCommand = await globalCommandMention(env, 'role', 'add');
      return message(`ℹ️ **No role mappings configured yet.**\nUse ${roleAddCommand} to map a UIUC affiliation to a Discord role.`, ephemeral);
    }
    const byRole = new Map<string, string[]>();
    for (const mapping of mappings) {
      byRole.set(mapping.roleId, [...(byRole.get(mapping.roleId) ?? []), mapping.affiliation]);
    }
    return message([
      '📋 **Role mappings**',
      '',
      ...[...byRole.entries()].map(([roleId, affiliations]) => mappingLine(affiliations, roleId)),
    ].join('\n'), ephemeral);
  }

  return message('⚠️ Unknown role subcommand.', ephemeral);
}

async function handleTest(env: AppEnv, storage: Storage, interaction: Interaction): Promise<Response> {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return message('⚠️ This command can only be used in a server.');
  }

  const ephemeral = await adminEphemeral(storage, interaction);

  const config = await ensureGuild(storage, env, guildId);
  const mappings = await storage.listRoleMappings(guildId);
  if (mappings.length === 0) {
    const configCommand = await globalCommandMention(env, 'config');
    return message([
      `No role mappings are configured yet. Use ${configCommand} to map UIUC affiliations to Discord roles.`,
    ].join('\n'), ephemeral);
  }

  try {
    const [application, roles] = await Promise.all([
      getDiscordApplication(env),
      listGuildRoles(env, guildId),
    ]);
    const botMember = await getGuildMember(env, guildId, application.id);

    const lines: string[] = [];
    const testCommand = await globalCommandMention(env, 'test');

    if (!botMember) {
      lines.push(`⚠️ I am not in this server. Re-invite the bot, then run ${testCommand} again.`);
      return message(lines.join('\n'), ephemeral);
    }

    const botPermissions = botMember.permissions !== undefined
      ? BigInt(botMember.permissions)
      : computeMemberGuildPermissions(guildId, botMember, roles);

    if (!hasManageRolesPermission(botPermissions)) {
      lines.push(`⚠️ I am missing **Manage Roles**. Give the bot Manage Roles, then run ${testCommand} again.`);
      return message(lines.join('\n'), ephemeral);
    }

    let passed = true;

    if (config.adminChannelId) {
      const missing = await missingBotChannelMessagePermissions(env, guildId, config.adminChannelId, { requireAttachFiles: true });
      if (missing.length > 0) {
        passed = false;
        lines.push(`⚠️ I am missing ${formatMissingPermissions(missing)} in <#${config.adminChannelId}>. Fix channel permissions, then run ${testCommand} again.`);
      }
    } else if (config.logLinksEnabled) {
      passed = false;
        const configCommand = await globalCommandMention(env, 'config');
        lines.push(`⚠️ Admin channel logging is enabled, but no admin channel is configured. Use ${configCommand} to set one.`);
    }
    const botTopRolePosition = roles
      .filter((role) => botMember.roles.includes(role.id))
      .reduce((max, role) => Math.max(max, role.position), 0);

    for (const mapping of mappings) {
      const role = roles.find((candidate) => candidate.id === mapping.roleId);

      if (!role) {
        passed = false;
        lines.push(`- ${roleMention(mapping.roleId)}: role no longer exists. Remove or update this mapping.`);
      } else if (role.managed) {
        passed = false;
        lines.push(`- ${roleMention(mapping.roleId)}: role is integration-managed. Choose a normal server role.`);
      } else if (botTopRolePosition <= role.position) {
        passed = false;
        lines.push(`- ${roleMention(mapping.roleId)}: move the bot role above this role, then run ${testCommand} again.`);
      }
    }

    if (passed) {
      return message('✅ Permissions tests passed!', ephemeral);
    }

    return message(lines.join('\n'), ephemeral);
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 429) {
      const testCommand = await globalCommandMention(env, 'test');
      return message(`⏳ Discord rate-limited the permission check. Wait a minute, then run ${testCommand} again.`, ephemeral);
    }
    return message('⚠️ Discord permission checks failed. Try again, and check that the bot still has access to this server.', ephemeral);
  }
}

async function handleChannelCommand(env: AppEnv, storage: Storage, interaction: Interaction): Promise<Response> {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return message('⚠️ This command can only be used in a server.');
  }

  const channelId = optionValue(interaction.data?.options, 'channel');
  if (!channelId) {
    return message('⚠️ Missing channel.');
  }

  const config = await ensureGuild(storage, env, guildId);
  await storage.upsertGuildConfig({ ...config, adminChannelId: channelId, updatedAt: Date.now() });

  return message([
    '✅ **Admin channel configured**',
    '',
    `Administrative command output will be public in <#${channelId}>.`,
    'Administrative commands used elsewhere will remain ephemeral.',
  ].join('\n'), false);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
}

function affiliationList(affiliations: string[]): string {
  return affiliations.length > 0 ? affiliations.map((affiliation) => `\`${affiliation}\``).join(', ') : '`none`';
}

async function requireVerifiedServer(storage: Storage, guildId: string): Promise<{ ok: true } | { ok: false; response: Response }> {
  const config = await storage.getGuildConfig(guildId);
  if (!config?.verified) {
    return { ok: false, response: message('⚠️ This server must be a Verified Server to use this command.') };
  }
  return { ok: true };
}

async function handleLookupCommand(storage: Storage, interaction: Interaction, forced?: { target: 'discord' | 'netid'; id: string; ephemeral: boolean }): Promise<Response> {
  const guildId = interaction.guild_id;
  const requesterDiscordUserId = userId(interaction);
  if (!guildId) {
    return message('⚠️ This command can only be used in a server.');
  }

  const verified = await requireVerifiedServer(storage, guildId);
  if (!verified.ok) {
    return verified.response;
  }

  const subcommand = interaction.data?.options?.[0];
  const target = forced?.target ?? (subcommand?.name === 'discord' || subcommand?.name === 'netid' ? subcommand.name : undefined);
  const id = forced?.id ?? (target === 'discord'
    ? optionValue(subcommand?.options, 'user')?.trim()
    : optionValue(subcommand?.options, 'netid')?.trim());
  if (!id || (target !== 'discord' && target !== 'netid')) {
    return message('⚠️ Provide a valid lookup target and ID.');
  }

  const links = await storage.listStoredLinks(guildId);
  const matches = target === 'discord'
    ? links.filter((link) => link.discordUserId === id)
    : links.filter((link) => link.shibUid.toLowerCase() === id.toLowerCase());

  await storage.createAuditEvent({
    id: randomToken(),
    guildId,
    type: 'stored_links_lookup',
    metadata: { target, id, resultCount: matches.length, requesterDiscordUserId },
    createdAt: Date.now(),
  });

  if (matches.length === 0) {
    return message('No stored links matched that lookup.', forced?.ephemeral ?? await adminEphemeral(storage, interaction));
  }

  const components = [
    {
      type: 10,
      content: target === 'netid'
        ? `Found ${matches.length} Discord ${plural(matches.length, 'user')} associated with NetID \`${id}\``
        : `Found ${matches.length} stored ${plural(matches.length, 'link')} associated with <@${id}>`,
    },
    ...matches.slice(0, 10).map((link) => ({
      type: 17,
      accent_color: UIUC_ORANGE,
      components: [
        {
          type: 10,
          content: [
            `**Discord**: <@${link.discordUserId}> (\`${link.discordUserId}\`)`,
            `**NetID**: ||\`${link.shibUid}\`||, **Affiliation**: ${affiliationList(link.shibAffiliations)}`,
            `-# <t:${Math.floor(link.updatedAt / 1000)}:R>`,
          ].join('\n'),
        },
      ],
    })),
    ...(matches.length > 10 ? [{ type: 10, content: `Showing first 10 of ${matches.length} matches.` }] : []),
  ];

  return componentMessage(components, forced?.ephemeral ?? await adminEphemeral(storage, interaction));
}

async function handleExportCommand(env: AppEnv, storage: Storage, interaction: Interaction): Promise<Response> {
  const admin = await requireAdminChannel(storage, interaction);
  if (!admin.ok) {
    return admin.response;
  }

  const verified = await requireVerifiedServer(storage, admin.guildId);
  if (!verified.ok) {
    return verified.response;
  }

  const channelId = interaction.channel_id ?? interaction.channel?.id;
  const missing = channelId ? await missingBotChannelMessagePermissions(env, admin.guildId, channelId, { requireAttachFiles: true }) : ['View Channel', 'Send Messages', 'Attach Files'];
  if (missing.length > 0) {
    return message(`⚠️ I am missing ${formatMissingPermissions(missing)} in this channel and cannot export a file here.`, false);
  }

  const links = await storage.listStoredLinks(admin.guildId);
  if (links.length === 0) {
    await storage.createAuditEvent({
      id: randomToken(),
      guildId: admin.guildId,
      type: 'stored_links_export',
      metadata: { count: 0, requesterDiscordUserId: userId(interaction) },
      createdAt: Date.now(),
    });
    return message('No stored links were found for this server. There is nothing to export.', false);
  }

  await storage.createAuditEvent({
    id: randomToken(),
    guildId: admin.guildId,
    type: 'stored_links_export',
    metadata: { count: links.length, requesterDiscordUserId: userId(interaction) },
    createdAt: Date.now(),
  });

  const csv = [
    ['discord_user_id', 'netid', 'affiliations', 'created_at', 'updated_at'].join(','),
    ...links.map((link) => [
      link.discordUserId,
      link.shibUid,
      link.shibAffiliations.join(';'),
      new Date(link.createdAt).toISOString(),
      new Date(link.updatedAt).toISOString(),
    ].map(csvCell).join(',')),
  ].join('\n');

  const uniqueNetIds = new Set(links.map((link) => link.shibUid.toLowerCase())).size;
  return attachmentMessage(`Exported ${links.length} ${plural(links.length, 'link')} (${uniqueNetIds} unique ${plural(uniqueNetIds, 'NetID')})`, `shibboleth-link-${admin.guildId}.csv`, csv);
}

async function handleDeleteLinksCommand(storage: Storage, interaction: Interaction): Promise<Response> {
  const admin = await requireAdminChannel(storage, interaction);
  if (!admin.ok) {
    return admin.response;
  }

  const ownerId = userId(interaction);
  if (!ownerId) {
    return message('⚠️ Missing Discord user.');
  }
  const linkCount = (await storage.listStoredLinks(admin.guildId)).length;
  if (linkCount === 0) {
    return message('No stored links were found for this server. There is nothing to delete.', false);
  }

  return interactiveMessage([
    '**Delete all stored user links?**',
    '',
    `Current stored links: **${linkCount}**`,
    'This deletes all stored user links for this server.',
    'Audit events and other information necessary for moderation of Shibboleth Link will be retained.',
  ].join('\n'), [
    {
      type: 1,
      components: [
        { type: 2, style: 4, label: 'Delete all links', custom_id: deleteDataCustomId('modal', admin.guildId, ownerId) },
        { type: 2, style: 2, label: 'Cancel', custom_id: deleteDataCustomId('cancel', admin.guildId, ownerId) },
      ],
    },
  ], false);
}

function banTarget(value: string | undefined): BanTargetType | null {
  return value === 'user' || value === 'server' || value === 'netid' ? value : null;
}

async function handleOperatorCommand(env: AppEnv, storage: Storage, interaction: Interaction): Promise<Response> {
  if (!env.OPERATOR_GUILD_ID || !env.OPERATOR_CHANNEL_ID) {
    return message('⚠️ Operator commands are not configured for this deployment.', false);
  }

  if (!operatorAllowed(env, interaction)) {
    return message('⚠️ Operator commands can only be used by administrators in the configured operator channel.', false);
  }

  const subcommand = interaction.data?.options?.[0]?.name;

  if (subcommand === 'stats') {
    const application = await getDiscordApplication(env);
    const guildCount = application.bot_approximate_guild_count ?? application.approximate_guild_count;
    return message([
      '📊 **Operator stats**',
      '',
      `Servers with bot installed: **${guildCount ?? 'Unknown'}**`,
    ].join('\n'), false);
  }

  if (subcommand === 'verify') {
    const options = interaction.data?.options?.[0]?.options;
    const guildId = optionValue(options, 'server');
    const expiresAt = parseExpiration(optionValue(options, 'expires'), { allowForever: false });
    if (!guildId || !expiresAt) {
      return message('⚠️ Provide a server ID and a future expiration time.', false);
    }

    const config = await ensureGuild(storage, env, guildId);
    await storage.upsertGuildConfig({ ...config, verified: true, verificationExpiresAt: expiresAt, updatedAt: Date.now() });
    await storage.createAuditEvent({
      id: randomToken(),
      guildId,
      type: 'operator_server_verified',
      metadata: { expiresAt, operatorDiscordUserId: userId(interaction) },
      createdAt: Date.now(),
    });
    return message(`✅ ${VERIFIED_SERVER_LABEL}\nServer ID: \`${guildId}\`\nExpires: **${formatDate(expiresAt)}**`, false);
  }

  if (subcommand === 'unverify') {
    const options = interaction.data?.options?.[0]?.options;
    const guildId = optionValue(options, 'server');
    if (!guildId) {
      return message('⚠️ Provide a server ID to unverify.', false);
    }

    const config = await ensureGuild(storage, env, guildId);
    const now = Date.now();
    const invalidated = await storage.invalidateServerVerifiers(guildId, now);
    await storage.upsertGuildConfig({ ...config, verified: false, verificationExpiresAt: undefined, updatedAt: now });
    await storage.createAuditEvent({
      id: randomToken(),
      guildId,
      type: 'operator_server_unverified',
      metadata: { invalidatedVerifierCount: invalidated, operatorDiscordUserId: userId(interaction) },
      createdAt: now,
    });
    return message([
      '✅ Removed Verified Server status.',
      `Server ID: \`${guildId}\``,
      `Expired active verifier records: **${invalidated}**`,
      'Verifier rows were kept for contact/history.',
    ].join('\n'), false);
  }

  if (subcommand === 'ban') {
    const options = interaction.data?.options?.[0]?.options;
    const targetType = banTarget(optionValue(options, 'target'));
    const rawTargetId = optionValue(options, 'id');
    const expiresAt = parseExpiration(optionValue(options, 'expires'), { allowForever: true });
    if (!targetType || !rawTargetId || expiresAt === null) {
      return message('⚠️ Provide a valid ban target, ID, and optional future expiration time.', false);
    }

    const targetId = normalizeBanTarget(targetType, rawTargetId);
    await storage.upsertBan({
      targetType,
      targetId,
      bannedByDiscordUserId: userId(interaction),
      createdAt: Date.now(),
      expiresAt,
    });
    await storage.createAuditEvent({
      id: randomToken(),
      type: 'operator_ban_created',
      metadata: { targetType, targetId, expiresAt, operatorDiscordUserId: userId(interaction) },
      createdAt: Date.now(),
    });
    return message(`✅ Banned ${targetType} \`${targetId}\` until **${formatBanExpiration(expiresAt)}**.`, false);
  }

  if (subcommand === 'unban') {
    const options = interaction.data?.options?.[0]?.options;
    const targetType = banTarget(optionValue(options, 'target'));
    const rawTargetId = optionValue(options, 'id');
    if (!targetType || !rawTargetId) {
      return message('⚠️ Provide a valid unban target and ID.', false);
    }

    const targetId = normalizeBanTarget(targetType, rawTargetId);
    const removed = await storage.removeBan(targetType, targetId);
    await storage.createAuditEvent({
      id: randomToken(),
      type: 'operator_ban_removed',
      metadata: { targetType, targetId, removed, operatorDiscordUserId: userId(interaction) },
      createdAt: Date.now(),
    });
    return message(removed ? `✅ Unbanned ${targetType} \`${targetId}\`.` : `ℹ️ No active ban found for ${targetType} \`${targetId}\`.`, false);
  }

  return message('⚠️ Unknown operator command.', false);
}

async function handleServerVerifyCommand(env: AppEnv, storage: Storage, interaction: Interaction): Promise<Response> {
  const guildId = interaction.guild_id;
  const requesterDiscordUserId = userId(interaction);
  if (!guildId || !requesterDiscordUserId) {
    return message('⚠️ This command can only be used in a server.');
  }

  const guild = await getDiscordGuild(env, guildId).catch(() => null);
  const requesterIsOwner = guild?.ownerId === requesterDiscordUserId;
  const requesterIsAdmin = isAdminInteraction(interaction);
  if (!requesterIsOwner && !requesterIsAdmin) {
    return message('⚠️ Server verification must be started by the server owner or an administrator.');
  }

  const now = Date.now();
  const id = randomToken();
  const verifySelfCommand = await globalCommandMention(env, 'verify-self');
  await ensureGuild(storage, env, guildId);
  await storage.createServerVerificationFlow({
    id,
    guildId,
    requesterDiscordUserId,
    requesterIsOwner,
    requesterIsAdmin,
    createdAt: now,
    expiresAt: now + FLOW_TTL_MS,
  });

  return componentMessage([
    {
      type: 17,
      accent_color: UIUC_ORANGE,
      components: [
        {
          type: 10,
          content: [
            '## Verification link created',
            'Complete verification at the link below within **15 minutes**.',
            '',
            `You will sign in with UIUC Shibboleth and Discord. The Discord account must match the account that ran ${verifySelfCommand}.`,
            '',
            'A server owner or administrator who is an active UIUC student or staff can verify the server.',
          ].join('\n'),
        },
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: 'Open verification link', url: `${env.APP_ORIGIN}/verify?flow=${id}` },
          ],
        },
      ],
    },
  ]);
}

function formatDate(value: number | undefined): string {
  if (!value) {
    return 'Not set';
  }
  return discordTimestamp(value);
}

async function handleVerifyCommand(env: AppEnv, storage: Storage, interaction: Interaction): Promise<Response> {
  const guildId = interaction.guild_id;
  if (!guildId) {
    return message('⚠️ This command can only be used in a server.');
  }

  const config = await ensureGuild(storage, env, guildId);
  const verifiers = await storage.listServerVerifiers(guildId, Date.now());
  const activeAdmins = verifiers.filter((verifier) => verifier.active && (verifier.isAdmin || verifier.isOwner));
  const satisfied = verificationSatisfied(verifiers);
  const verifySelfCommand = await globalCommandMention(env, 'verify-self');
  const statusLabel = config.verified ? VERIFIED_SERVER_LABEL : satisfied ? 'Policy satisfied' : 'Incomplete';

  return componentMessage([
    {
      type: 17,
      accent_color: UIUC_ORANGE,
      components: [
        {
          type: 10,
          content: [
            '## Server Verification',
            `**Status:** ${statusLabel}`,
            `**Expires:** ${formatDate(config.verificationExpiresAt)}`,
            `**Verified admins:** ${activeAdmins.length}`,
            '',
            `One administrator must verify as an active UIUC student or staff before NetID lookup and export are available. Start verification with ${verifySelfCommand}.`,
          ].join('\n'),
        },
      ],
    },
  ], await adminEphemeral(storage, interaction));
}

export async function handleDiscordInteraction(env: AppEnv, storage: Storage, request: Request): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await readTextBody(request, DISCORD_INTERACTION_BODY_LIMIT_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response('Request body too large', { status: 413 });
    }
    throw error;
  }
  if (!(await verifySignature(env, request, rawBody))) {
    return new Response('Invalid request signature', { status: 401 });
  }

  const interaction = JSON.parse(rawBody) as Interaction;

  if (interaction.type === PING) {
    return jsonResponse({ type: PONG });
  }

  if (interaction.data?.name === 'operator') {
    return handleOperatorCommand(env, storage, interaction);
  }

  const ban = await firstActiveBan(storage, [
    { targetType: 'server', targetId: interaction.guild_id },
    { targetType: 'user', targetId: userId(interaction) },
  ]);
  if (ban) {
    return message('⚠️ Shibboleth Link is not available for this user or server.');
  }

  if (interaction.type === MESSAGE_COMPONENT && interaction.data?.custom_id) {
    const deleteData = parseDeleteDataCustomId(interaction.data.custom_id);
    if (deleteData) {
      if (userId(interaction) !== deleteData.ownerId) {
        return message('⚠️ Only the user who started this deletion flow can use these controls.');
      }
      const permissionError = requireCurrentAdminConfigPermission(interaction);
      if (permissionError) {
        return permissionError;
      }
      const admin = await requireAdminChannel(storage, interaction);
      if (!admin.ok || admin.guildId !== deleteData.guildId) {
        return admin.ok ? message('⚠️ This delete flow can only be used in the configured admin channel.') : admin.response;
      }
      if (deleteData.action === 'cancel') {
        return interactiveMessage('Deletion cancelled. No stored links were deleted.', [], false, true);
      }
      if (deleteData.action === 'modal') {
        return modalResponse(deleteDataCustomId('ready', deleteData.guildId, deleteData.ownerId), 'Confirm Link Deletion', 'Type DELETE LINKS');
      }
      return message('⚠️ Unknown delete data action.');
    }

    const setup = parseSetupCustomId(interaction.data.custom_id);
    if (!setup) {
      return message('⚠️ Unknown config control.');
    }
    const ownerError = assertSetupOwner(interaction, setup.ownerId);
    if (ownerError) {
      return ownerError;
    }
    const permissionError = requireCurrentAdminConfigPermission(interaction);
    if (permissionError) {
      return permissionError;
    }
    if (interaction.guild_id !== setup.guildId) {
      return message('⚠️ This config panel can only be used in the server where it was opened.');
    }

    if (setup.action === 'a') {
      return addMappingDraft(env, storage, interaction, setup);
    }

    if (setup.action === 'l') {
      return linkingDraft(env, storage, interaction, setup);
    }

    if (setup.action === 'm') {
      return modeDraft(env, storage, interaction, setup);
    }

    if (setup.action === 'g') {
      return logLinksDraft(env, storage, interaction, setup);
    }

    if (setup.action === 'c') {
      return channelDraft(env, storage, interaction, setup);
    }

    if (setup.action === 'af') {
      const draft = decodeDraft(setup.data);
      return addMappingDraft(env, storage, interaction, setup, encodeDraft(interaction.data.values ?? [], draft.roleId));
    }

    if (setup.action === 'ls') {
      const selected = interaction.data.values?.[0];
      return linkingDraft(env, storage, interaction, setup, selected);
    }

    if (setup.action === 'ms') {
      const selected = interaction.data.values?.[0];
      return modeDraft(env, storage, interaction, setup, selected);
    }

    if (setup.action === 'gs') {
      const selected = interaction.data.values?.[0];
      return logLinksDraft(env, storage, interaction, setup, selected);
    }

    if (setup.action === 'lv') {
      const linkingEnabled = decodeBooleanDraft(setup.data);
      if (linkingEnabled === undefined) {
        return message('⚠️ Select an allow linking status.');
      }
      const config = await ensureGuild(storage, env, setup.guildId);
      await storage.upsertGuildConfig({ ...config, linkingEnabled, updatedAt: Date.now() });
      return setupResponse(env, storage, interaction, `- Set allow linking to ${linkingEnabled ? '`Enabled`' : '`Disabled`'}.`, true);
    }

    if (setup.action === 'mv') {
      const mode = decodeModeDraft(setup.data);
      if (!mode) {
        return message('⚠️ Select a privacy mode.');
      }
      const config = await ensureGuild(storage, env, setup.guildId);
      await storage.upsertGuildConfig({ ...config, mode, updatedAt: Date.now() });
      return setupResponse(env, storage, interaction, `- Set privacy mode to \`${prettyMode(mode)}\`.`, true);
    }

    if (setup.action === 'gv') {
      const logLinksEnabled = decodeBooleanDraft(setup.data);
      if (logLinksEnabled === undefined) {
        return message('⚠️ Select an admin channel logging status.');
      }
      const config = await ensureGuild(storage, env, setup.guildId);
      await storage.upsertGuildConfig({ ...config, logLinksEnabled, updatedAt: Date.now() });
      return setupResponse(env, storage, interaction, `- Set admin channel logging to ${logLinksEnabled ? '`Enabled`' : '`Disabled`'}.`, true);
    }

    if (setup.action === 'ar') {
      const draft = decodeDraft(setup.data);
      return addMappingDraft(env, storage, interaction, setup, encodeDraft(draft.affiliations, interaction.data.values?.[0]));
    }

    if (setup.action === 'as') {
      const draft = decodeDraft(setup.data);
      if (!draft.affiliations || !draft.roleId) {
        return message('⚠️ Select at least one affiliation and one role.');
      }
      await storage.upsertRoleMapping({ guildId: setup.guildId, affiliation: draft.affiliations, roleId: draft.roleId });
      return setupResponse(env, storage, interaction, `- Added role map (${prettyAffiliations(draft.affiliations)} → ${roleMention(draft.roleId)}).`, true);
    }

    if (setup.action === 'r') {
      return removeMappingSelect(env, storage, interaction, setup);
    }

    if (setup.action === 'f') {
      return setupResponse(env, storage, interaction, undefined, true);
    }

    if (setup.action === 'x') {
      return setupResponse(env, storage, interaction, undefined, true);
    }

    if (setup.action === 'rs') {
      const encodedAffiliation = interaction.data.values?.[0];
      if (!encodedAffiliation) {
        return message('⚠️ No mapping selected.');
      }
      const mappings = await storage.listRoleMappings(setup.guildId);
      const removedMapping = mappings.find((mapping) => mapping.affiliation === encodedAffiliation);
      return removeMappingSelect(env, storage, interaction, setup, encodedAffiliation, removedMapping?.roleId);
    }

    if (setup.action === 'rv') {
      const encodedAffiliation = setup.data;
      if (!encodedAffiliation) {
        return message('⚠️ Select a role mapping to remove.');
      }
      const mappings = await storage.listRoleMappings(setup.guildId);
      const removedMapping = mappings.find((mapping) => mapping.affiliation === encodedAffiliation);
      await storage.removeRoleMapping(setup.guildId, encodedAffiliation);
      return setupResponse(env, storage, interaction, `- Removed role map (${prettyAffiliations(encodedAffiliation)}${removedMapping ? ` → ${roleMention(removedMapping.roleId)}` : ''}).`, true);
    }

    if (setup.action === 'cs') {
      return channelDraft(env, storage, interaction, setup, interaction.data.values?.[0]);
    }

    if (setup.action === 'cv') {
      const channelId = setup.data;
      if (!channelId) {
        return message('⚠️ Select a channel.');
      }
      const config = await ensureGuild(storage, env, setup.guildId);
      await storage.upsertGuildConfig({ ...config, adminChannelId: channelId, updatedAt: Date.now() });
      return setupResponse(env, storage, interaction, `- Set admin channel to <#${channelId}>.`, true);
    }

    return message('⚠️ Unknown config action.');
  }

  if (interaction.type === MODAL_SUBMIT && interaction.data?.custom_id) {
    const deleteData = parseDeleteDataCustomId(interaction.data.custom_id);
    if (deleteData?.action === 'ready') {
      if (userId(interaction) !== deleteData.ownerId) {
        return message('⚠️ Only the user who started this deletion flow can use these controls.');
      }
      const permissionError = requireCurrentAdminConfigPermission(interaction);
      if (permissionError) {
        return permissionError;
      }
      const admin = await requireAdminChannel(storage, interaction);
      if (!admin.ok || admin.guildId !== deleteData.guildId) {
        return admin.ok ? message('⚠️ This delete flow can only be used in the configured admin channel.') : admin.response;
      }
      const phrase = modalValue(interaction.data.components, 'confirmation');
      if (phrase !== 'DELETE LINKS') {
        return message('⚠️ Confirmation text did not match. No data was deleted.');
      }
      const deleted = await storage.deleteStoredLinks(deleteData.guildId);
      await storage.createAuditEvent({
        id: randomToken(),
        guildId: deleteData.guildId,
        type: 'stored_links_deleted',
        metadata: { deleted, requesterDiscordUserId: deleteData.ownerId },
        createdAt: Date.now(),
      });
      return interactiveMessage(`✅ Deleted **${deleted}** stored user links for this server. Audit events were retained.`, [], false, true);
    }
    return message('⚠️ Unknown modal submission.');
  }

  if (interaction.type !== APPLICATION_COMMAND || !interaction.data) {
    return message('⚠️ Unsupported interaction.');
  }

  const guildId = interaction.guild_id;
  if (!guildId) {
    return message('⚠️ This command can only be used in a server.');
  }

  if (interaction.data.name === 'link') {
    await ensureGuild(storage, env, guildId);
    return message(`Use this link to verify your account, connect Discord, and receive the configured server role.\n\n${env.APP_ORIGIN}/link?server=${guildId}`, false);
  }

  if (interaction.data.name === 'test') {
    return handleTest(env, storage, interaction);
  }

  if (interaction.data.name === 'lookup') {
    return handleLookupCommand(storage, interaction);
  }

  if (interaction.data.name === 'Lookup NetID') {
    const targetId = interaction.data.type === 3
      ? interaction.data.resolved?.messages?.[interaction.data.target_id ?? '']?.author?.id
      : interaction.data.target_id;
    if (!targetId) {
      return message('⚠️ Provide a valid lookup target and ID.');
    }
    return handleLookupCommand(storage, interaction, { target: 'discord', id: targetId, ephemeral: true });
  }

  if (interaction.data.name === 'export') {
    return handleExportCommand(env, storage, interaction);
  }

  if (interaction.data.name === 'delete-links') {
    return handleDeleteLinksCommand(storage, interaction);
  }

  if (interaction.data.name === 'config') {
    return setupResponse(env, storage, interaction);
  }

  if (interaction.data.name === 'verify') {
    return handleVerifyCommand(env, storage, interaction);
  }

  if (interaction.data.name === 'verify-self') {
    return handleServerVerifyCommand(env, storage, interaction);
  }

  return message('⚠️ Unknown command.');
}
