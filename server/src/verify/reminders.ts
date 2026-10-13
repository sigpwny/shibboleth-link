import { createChannelMessage } from '../discord/client.js';
import { globalCommandMention } from '../discord/mentions.js';
import type { AppEnv } from '../env.js';
import type { Storage } from '../storage/types.js';
import { verificationExpiry } from './policy.js';

export const VERIFICATION_OPENING_CRON = '0 0 2 7 *';
export const VERIFICATION_EXPIRATION_CRON = '0 0 25 7 *';

export async function sendVerificationReminders(env: AppEnv, storage: Storage, kind: 'opening' | 'expiration', scheduledAt: Date): Promise<{ sent: number; failed: number }> {
  const channels = await storage.listGuildAdminChannels();
  if (channels.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const verifySelfCommand = await globalCommandMention(env, 'verify-self');
  const verifyCommand = await globalCommandMention(env, 'verify');
  const expiresAt = Math.floor(Date.UTC(scheduledAt.getUTCFullYear(), 7, 1) / 1000);
  const renewalExpiresAt = Math.floor(verificationExpiry(scheduledAt) / 1000);
  const renewalStartsAt = Math.floor(Date.UTC(scheduledAt.getUTCFullYear(), 6, 2) / 1000);
  const introduction = kind === 'opening'
    ? 'The new server verification period is now open.'
    : `**Reminder**\nThe current server verification period ends <t:${expiresAt}:R>.`;
  const content = [
    introduction,
    `An eligible server owner or administrator can use ${verifySelfCommand} to verify or renew this server through <t:${renewalExpiresAt}:F> starting on <t:${renewalStartsAt}:F>.`,
    `Use the ${verifyCommand} command to check your current server verification status.`,
  ].join(' ');

  let sent = 0;
  let failed = 0;
  for (const channel of channels) {
    try {
      await createChannelMessage(env, channel.channelId, content);
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, failed };
}
