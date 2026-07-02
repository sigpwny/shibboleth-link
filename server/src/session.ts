import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { hkdfSync } from 'node:crypto';
import { jwtDecrypt, EncryptJWT } from 'jose';
import type { AppBindings } from './bindings.js';

const SESSION_TTL_SECONDS = 15 * 60;
const FLOW_COOKIE = '__Host-shib-link-flow';
const SHIB_COOKIE = '__Host-shib-link-shib';
const DISCORD_COOKIE = '__Host-shib-link-discord';
const SESSION_KEY_DOMAIN = 'shibboleth-link/session-jwe/v1';

export interface ShibSession {
  flowId: string;
  uid?: string;
  affiliations: string[];
}

export interface FlowSession {
  flowId: string;
  guildId: string;
}

export interface DiscordSession {
  version?: 1;
  flowId: string;
  userId: string;
  username?: string;
}

function key(secret: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', secret, 'shibboleth-link', SESSION_KEY_DOMAIN, 32));
}

async function seal<T extends Record<string, unknown>>(secret: string, payload: T): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .encrypt(key(secret));
}

async function open<T>(secret: string, token: string | undefined): Promise<T | null> {
  if (!token) {
    return null;
  }

  try {
    const result = await jwtDecrypt(token, key(secret));
    return result.payload as T;
  } catch {
    return null;
  }
}

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
} as const;

export async function setShibSession(c: Context<AppBindings>, session: ShibSession): Promise<void> {
  setCookie(c, SHIB_COOKIE, await seal(c.get('env').JWT_SECRET, { ...session }), cookieOptions);
}

export async function setFlowSession(c: Context<AppBindings>, session: FlowSession): Promise<void> {
  setCookie(c, FLOW_COOKIE, await seal(c.get('env').JWT_SECRET, { ...session }), cookieOptions);
}

export async function getFlowSession(c: Context<AppBindings>, guildId: string): Promise<FlowSession | null> {
  const session = await open<FlowSession>(c.get('env').JWT_SECRET, getCookie(c, FLOW_COOKIE));
  return session?.guildId === guildId ? session : null;
}

export async function getShibSession(c: Context<AppBindings>, flowId: string): Promise<ShibSession | null> {
  const session = await open<ShibSession>(c.get('env').JWT_SECRET, getCookie(c, SHIB_COOKIE));
  return session?.flowId === flowId ? session : null;
}

export async function setDiscordSession(c: Context<AppBindings>, session: DiscordSession): Promise<void> {
  setCookie(c, DISCORD_COOKIE, await seal(c.get('env').JWT_SECRET, { ...session }), cookieOptions);
}

export async function getDiscordSession(c: Context<AppBindings>, flowId: string): Promise<DiscordSession | null> {
  const session = await open<DiscordSession>(c.get('env').JWT_SECRET, getCookie(c, DISCORD_COOKIE));
  return session?.flowId === flowId && session.version === 1 ? session : null;
}

export function clearLinkSessions(c: Context<AppBindings>): void {
  deleteCookie(c, FLOW_COOKIE, { path: '/', secure: true });
  deleteCookie(c, SHIB_COOKIE, { path: '/', secure: true });
  deleteCookie(c, DISCORD_COOKIE, { path: '/', secure: true });
}

export function clearIdentitySessions(c: Context<AppBindings>): void {
  deleteCookie(c, SHIB_COOKIE, { path: '/', secure: true });
  deleteCookie(c, DISCORD_COOKIE, { path: '/', secure: true });
}
