import { Hono } from 'hono';
import type { AppBindings } from '../bindings.js';
import { randomToken, sha256 } from '../crypto.js';
import { getSamlLoginUrl, validateSamlPost } from '../saml/service.js';
import { setShibSession } from '../session.js';
import { getOrCreateFlow } from './flow.js';
import { banError, firstActiveBan } from '../bans.js';
import { RequestBodyTooLargeError, readTextBody } from '../request-body.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const SAML_CALLBACK_BODY_LIMIT_BYTES = 1024 * 1024;

export const samlRoutes = new Hono<AppBindings>();

samlRoutes.get('/start/:flowId', async (c) => {
  const flow = await c.get('storage').getLinkFlow(c.req.param('flowId'));
  const verificationFlow = flow ? null : await c.get('storage').getServerVerificationFlow(c.req.param('flowId'));
  if ((!flow || flow.expiresAt <= Date.now()) && (!verificationFlow || verificationFlow.expiresAt <= Date.now() || verificationFlow.completedAt)) {
    return c.json({ error: 'unknown_flow' }, 404);
  }

  const guildId = flow?.guildId ?? verificationFlow!.guildId;
  const ban = await firstActiveBan(c.get('storage'), [{ targetType: 'server', targetId: guildId }]);
  if (ban) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/${flow ? 'link' : 'verify'}?${flow ? `server=${encodeURIComponent(guildId)}` : `flow=${encodeURIComponent(verificationFlow!.id)}`}&error=${banError(ban.targetType)}`);
  }

  const flowId = flow?.id ?? verificationFlow!.id;
  const state = randomToken();
  const now = Date.now();
  await c.get('storage').createOAuthState({
    stateHash: sha256(state),
    flowId,
    provider: 'saml',
    createdAt: now,
    expiresAt: now + STATE_TTL_MS,
  });

  if (flow) {
    await c.get('storage').updateLinkFlow({ ...flow, step: 'saml_started' });
  }

  const loginUrl = await getSamlLoginUrl(c.get('env'), c.get('storage'), state);

  return c.redirect(loginUrl);
});

samlRoutes.get('/start', async (c) => {
  const guildId = c.req.query('server');
  if (!guildId) {
    return c.json({ error: 'missing_server' }, 400);
  }

  const ban = await firstActiveBan(c.get('storage'), [{ targetType: 'server', targetId: guildId }]);
  if (ban) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link?server=${encodeURIComponent(guildId)}&error=${banError(ban.targetType)}`);
  }

  const guild = await c.get('storage').getGuildConfig(guildId);
  if (!guild?.linkingEnabled) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link?server=${encodeURIComponent(guildId)}&error=linking_disabled`);
  }

  const flow = await getOrCreateFlow(c, guildId);
  if (!flow || flow.expiresAt <= Date.now()) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link?server=${encodeURIComponent(guildId)}&error=expired_flow`);
  }

  const state = randomToken();
  const now = Date.now();
  await c.get('storage').createOAuthState({
    stateHash: sha256(state),
    flowId: flow.id,
    provider: 'saml',
    createdAt: now,
    expiresAt: now + STATE_TTL_MS,
  });

  await c.get('storage').updateLinkFlow({ ...flow, step: 'saml_started' });
  return c.redirect(await getSamlLoginUrl(c.get('env'), c.get('storage'), state));
});

samlRoutes.post('/callback', async (c) => {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await readTextBody(c.req.raw, SAML_CALLBACK_BODY_LIMIT_BYTES));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return c.text('SAML response too large', 413);
    }
    throw error;
  }
  const relayState = form.get('RelayState');
  const samlResponse = form.get('SAMLResponse');

  if (typeof relayState !== 'string' || typeof samlResponse !== 'string') {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link/error?error=saml_missing_response`);
  }

  const storage = c.get('storage');
  const stateHash = sha256(relayState);
  const oauthState = await storage.getOAuthState(stateHash, 'saml', Date.now());
  if (!oauthState) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link/error?error=saml_invalid_state`);
  }

  const flow = await storage.getLinkFlow(oauthState.flowId);
  const verificationFlow = flow ? null : await storage.getServerVerificationFlow(oauthState.flowId);
  if ((!flow || flow.expiresAt <= Date.now()) && (!verificationFlow || verificationFlow.expiresAt <= Date.now() || verificationFlow.completedAt)) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link/error?error=expired_flow`);
  }

  const flowId = flow?.id ?? verificationFlow!.id;
  const guildId = flow?.guildId ?? verificationFlow!.guildId;

  let profile;
  try {
    profile = await validateSamlPost(c.get('env'), storage, samlResponse);
  } catch (error) {
    console.error('SAML validation failed', {
      flowId,
      message: error instanceof Error ? error.message : 'unknown error',
    });

    await storage.createAuditEvent({
      id: randomToken(),
      flowId,
      guildId,
      type: 'saml_validation_failed',
      metadata: { message: error instanceof Error ? error.message : 'unknown error' },
      createdAt: Date.now(),
    });

    const target = flow
      ? `${c.get('env').APP_ORIGIN}/link?server=${encodeURIComponent(guildId)}&error=saml_validation_failed`
      : `${c.get('env').APP_ORIGIN}/verify?flow=${encodeURIComponent(flowId)}&error=saml_validation_failed`;
    return c.redirect(target);
  }

  const ban = await firstActiveBan(storage, [
    { targetType: 'server', targetId: guildId },
    { targetType: 'netid', targetId: profile.uid },
  ]);
  if (ban) {
    const target = flow
      ? `${c.get('env').APP_ORIGIN}/link?server=${encodeURIComponent(guildId)}&error=${banError(ban.targetType)}`
      : `${c.get('env').APP_ORIGIN}/verify?flow=${encodeURIComponent(flowId)}&error=${banError(ban.targetType)}`;
    return c.redirect(target);
  }

  const consumedState = await storage.consumeOAuthState(stateHash, 'saml', Date.now());
  if (!consumedState) {
    return c.redirect(`${c.get('env').APP_ORIGIN}/link/error?error=saml_invalid_state`);
  }

  await setShibSession(c, { flowId, uid: profile.uid, affiliations: profile.affiliations });
  if (flow) {
    await storage.updateLinkFlow({ ...flow, step: 'saml_verified' });
  }

  const target = flow
    ? `${c.get('env').APP_ORIGIN}/link?server=${encodeURIComponent(guildId)}&connected=shib&next=discord`
    : `${c.get('env').APP_ORIGIN}/verify?flow=${encodeURIComponent(flowId)}&connected=shib&next=discord`;
  return c.redirect(target);
});
