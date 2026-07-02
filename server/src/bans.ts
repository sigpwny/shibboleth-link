import type { BanRecord, BanTargetType, Storage } from './storage/types.js';

export function normalizeBanTarget(targetType: BanTargetType, targetId: string): string {
  const value = targetId.trim();
  return targetType === 'netid' ? value.toLowerCase() : value;
}

export function banError(targetType: BanTargetType): 'user_banned' | 'server_banned' | 'netid_banned' {
  return `${targetType}_banned` as 'user_banned' | 'server_banned' | 'netid_banned';
}

export async function firstActiveBan(storage: Storage, targets: Array<{ targetType: BanTargetType; targetId: string | undefined }>): Promise<BanRecord | null> {
  const now = Date.now();
  for (const target of targets) {
    if (!target.targetId) {
      continue;
    }
    const ban = await storage.getActiveBan(target.targetType, normalizeBanTarget(target.targetType, target.targetId), now);
    if (ban) {
      return ban;
    }
  }
  return null;
}

export function parseExpiration(value: string | undefined, options: { allowForever: boolean }): number | undefined | null {
  if (!value) {
    return options.allowForever ? undefined : null;
  }

  const trimmed = value.trim();
  if (options.allowForever && ['forever', 'never', 'permanent'].includes(trimmed.toLowerCase())) {
    return undefined;
  }

  const timestamp = /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    return null;
  }
  return timestamp;
}

export function formatBanExpiration(expiresAt: number | undefined): string {
  return expiresAt ? discordTimestamp(expiresAt) : 'forever';
}

export function discordTimestamp(timestampMs: number): string {
  const seconds = Math.floor(timestampMs / 1000);
  return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}
