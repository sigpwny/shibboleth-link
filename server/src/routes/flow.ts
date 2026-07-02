import type { Context } from 'hono';
import type { AppBindings } from '../bindings.js';
import { randomToken } from '../crypto.js';
import { getFlowSession, setFlowSession } from '../session.js';
import type { LinkFlow } from '../storage/types.js';

const FLOW_TTL_MS = 15 * 60 * 1000;

export async function getOrCreateFlow(c: Context<AppBindings>, guildId: string): Promise<LinkFlow | null> {
  const storage = c.get('storage');
  const flowSession = await getFlowSession(c, guildId);
  const existing = flowSession ? await storage.getLinkFlow(flowSession.flowId) : null;
  if (existing && !existing.consumedAt && existing.expiresAt > Date.now()) {
    return existing;
  }

  const guild = await storage.getGuildConfig(guildId);
  if (!guild) {
    return null;
  }

  const now = Date.now();
  const flow: LinkFlow = {
    id: randomToken(),
    guildId,
    step: 'created',
    createdAt: now,
    expiresAt: now + FLOW_TTL_MS,
  };

  await storage.createLinkFlow(flow);
  await setFlowSession(c, { flowId: flow.id, guildId });
  return flow;
}
