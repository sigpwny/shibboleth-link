import type { AppEnv } from '../env.js';
import { createChannelComponentsMessage, DiscordApiError } from './client.js';

const UIUC_ORANGE = 0xff5f05;

function affiliationList(affiliations: string[]): string {
  return affiliations.length > 0 ? affiliations.map((affiliation) => `\`${affiliation}\``).join(', ') : '`none`';
}

async function sendOperatorLog(env: AppEnv, content: string): Promise<void> {
  if (!env.OPERATOR_CHANNEL_ID) {
    return;
  }

  try {
    await createChannelComponentsMessage(env, env.OPERATOR_CHANNEL_ID, [
      {
        type: 17,
        accent_color: UIUC_ORANGE,
        components: [
          { type: 10, content },
        ],
      },
    ]);
  } catch (error) {
    console.error('Operator log failed', error instanceof DiscordApiError ? { status: error.status, route: error.route } : { message: error instanceof Error ? error.message : 'unknown' });
  }
}

export async function logServerAdded(env: AppEnv, server: { guildId: string; name: string }): Promise<void> {
  await sendOperatorLog(env, [
    '## Server added',
    `**Server:** ${server.name} (\`${server.guildId}\`)`,
    `-# <t:${Math.floor(Date.now() / 1000)}:R>`,
  ].join('\n'));
}

export async function logServerVerifier(env: AppEnv, verifier: { guildId: string; guildName?: string; discordUserId: string; shibUid: string; affiliations: string[]; active: boolean }): Promise<void> {
  await sendOperatorLog(env, [
    '## Server verifier recorded',
    `**Server:** ${verifier.guildName ?? 'Unknown server'} (\`${verifier.guildId}\`)`,
    `**Discord:** <@${verifier.discordUserId}> (\`${verifier.discordUserId}\`)`,
    `**NetID:** ||\`${verifier.shibUid}\`||`,
    `**Affiliation:** ${affiliationList(verifier.affiliations)}`,
    `**Active UIUC student/staff:** ${verifier.active ? 'Yes' : 'No'}`,
    `-# <t:${Math.floor(Date.now() / 1000)}:R>`,
  ].join('\n'));
}
