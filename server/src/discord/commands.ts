import type { DiscordCommandPayload } from './client.js';
import { affiliationChoices } from './affiliations.js';

const CHAT_INPUT = 1;
const USER_CONTEXT = 2;
const MESSAGE_CONTEXT = 3;
const SUB_COMMAND = 1;
const STRING = 3;
const USER = 6;
const CHANNEL = 7;
const ROLE = 8;
const GUILD_CONTEXT = 0;
const GUILD_INSTALL = 0;
const ADMIN_ONLY_BY_DEFAULT = '0';

const affiliationOption = {
  type: STRING,
  name: 'affiliation',
  description: 'Shibboleth affiliation, e.g. member, student, alum, staff',
  required: true,
  choices: affiliationChoices(),
};

const banTargetOption = {
  type: STRING,
  name: 'target',
  description: 'Type of target to ban or unban.',
  required: true,
  choices: [
    { name: 'Discord user', value: 'user' },
    { name: 'Discord server', value: 'server' },
    { name: 'UIUC NetID', value: 'netid' },
  ],
};

export const ACTIVE_COMMANDS: DiscordCommandPayload[] = [
  {
    name: 'link',
    type: CHAT_INPUT,
    description: 'Get the Shibboleth Link URL for this server.',
    contexts: [GUILD_CONTEXT],
    integration_types: [GUILD_INSTALL],
  },
  {
    name: 'test',
    type: CHAT_INPUT,
    description: 'Test Shibboleth Link role mapping and bot role permissions.',
    default_member_permissions: ADMIN_ONLY_BY_DEFAULT,
    contexts: [GUILD_CONTEXT],
    integration_types: [GUILD_INSTALL],
  },
  {
    name: 'lookup',
    type: CHAT_INPUT,
    description: 'Look up a stored server-scoped account link.',
    default_member_permissions: ADMIN_ONLY_BY_DEFAULT,
    contexts: [GUILD_CONTEXT],
    integration_types: [GUILD_INSTALL],
    options: [
      {
        type: SUB_COMMAND,
        name: 'netid',
        description: 'Look up stored Discord accounts for a UIUC NetID.',
        options: [
          {
            type: STRING,
            name: 'netid',
            description: 'UIUC NetID to look up.',
            required: true,
          },
        ],
      },
      {
        type: SUB_COMMAND,
        name: 'discord',
        description: 'Look up stored NetIDs for a Discord user.',
        options: [
          {
            type: USER,
            name: 'user',
            description: 'Discord user to look up.',
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: 'Lookup NetID',
    type: USER_CONTEXT,
    default_member_permissions: ADMIN_ONLY_BY_DEFAULT,
    contexts: [GUILD_CONTEXT],
    integration_types: [GUILD_INSTALL],
  },
  {
    name: 'Lookup NetID',
    type: MESSAGE_CONTEXT,
    default_member_permissions: ADMIN_ONLY_BY_DEFAULT,
    contexts: [GUILD_CONTEXT],
    integration_types: [GUILD_INSTALL],
  },
  {
    name: 'export',
    type: CHAT_INPUT,
    description: 'Export stored server-scoped account links in the admin channel.',
    default_member_permissions: ADMIN_ONLY_BY_DEFAULT,
    contexts: [GUILD_CONTEXT],
    integration_types: [GUILD_INSTALL],
  },
  {
    name: 'delete-links',
    type: CHAT_INPUT,
    description: 'Delete all stored account links for this server.',
    default_member_permissions: ADMIN_ONLY_BY_DEFAULT,
    contexts: [GUILD_CONTEXT],
    integration_types: [GUILD_INSTALL],
  },
  {
    name: 'config',
    type: CHAT_INPUT,
    description: 'Open the Shibboleth Link config panel for this server.',
    default_member_permissions: ADMIN_ONLY_BY_DEFAULT,
    contexts: [GUILD_CONTEXT],
    integration_types: [GUILD_INSTALL],
  },
  {
    name: 'verify',
    type: CHAT_INPUT,
    description: 'Show this server\'s verification status and progress.',
    default_member_permissions: ADMIN_ONLY_BY_DEFAULT,
    contexts: [GUILD_CONTEXT],
    integration_types: [GUILD_INSTALL],
  },
  {
    name: 'verify-self',
    type: CHAT_INPUT,
    description: 'Start your server owner/admin verification browser flow.',
    default_member_permissions: ADMIN_ONLY_BY_DEFAULT,
    contexts: [GUILD_CONTEXT],
    integration_types: [GUILD_INSTALL],
  },
];

export const OPERATOR_COMMANDS: DiscordCommandPayload[] = [
  {
    name: 'operator',
    type: CHAT_INPUT,
    description: 'Operator-only Shibboleth Link commands.',
    default_member_permissions: ADMIN_ONLY_BY_DEFAULT,
    contexts: [GUILD_CONTEXT],
    integration_types: [GUILD_INSTALL],
    options: [
      {
        type: SUB_COMMAND,
        name: 'stats',
        description: 'Show operator-level Shibboleth Link statistics.',
      },
      {
        type: SUB_COMMAND,
        name: 'verify',
        description: 'Manually mark a server as a Verified Server until an expiration time.',
        options: [
          {
            type: STRING,
            name: 'server',
            description: 'Discord server ID to verify.',
            required: true,
          },
          {
            type: STRING,
            name: 'expires',
            description: 'Expiration time, e.g. 2027-08-01 or 2027-08-01T00:00:00Z.',
            required: true,
          },
        ],
      },
      {
        type: SUB_COMMAND,
        name: 'unverify',
        description: 'Remove a server\'s issued status and expire active verifier records.',
        options: [
          {
            type: STRING,
            name: 'server',
            description: 'Discord server ID to unverify.',
            required: true,
          },
        ],
      },
      {
        type: SUB_COMMAND,
        name: 'ban',
        description: 'Ban a Discord user, Discord server, or UIUC NetID from Shibboleth Link.',
        options: [
          banTargetOption,
          {
            type: STRING,
            name: 'id',
            description: 'Discord ID or UIUC NetID to ban.',
            required: true,
          },
          {
            type: STRING,
            name: 'expires',
            description: 'Optional expiration time. Omit for forever.',
            required: false,
          },
        ],
      },
      {
        type: SUB_COMMAND,
        name: 'unban',
        description: 'Remove a Discord user, Discord server, or UIUC NetID ban.',
        options: [
          banTargetOption,
          {
            type: STRING,
            name: 'id',
            description: 'Discord ID or UIUC NetID to unban.',
            required: true,
          },
        ],
      },
    ],
  },
];
