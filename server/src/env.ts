export interface AppEnv {
  APP_ORIGIN: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_REDIRECT_URI: string;
  JWT_SECRET: string;
  SAML_ENTRY_POINT: string;
  SAML_ISSUER: string;
  SAML_CALLBACK_URL: string;
  SAML_ACS_INDEX?: string;
  SAML_IDP_CERT: string;
  SAML_SP_PRIVATE_KEY: string;
  OPERATOR_GUILD_ID?: string;
  OPERATOR_CHANNEL_ID?: string;
  PORT?: string;
}

type EnvSource = Record<string, string | undefined>;

const optionalDefaults = {
  APP_ORIGIN: 'http://localhost:4321',
  PORT: '8787',
};

const requiredKeys = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_PUBLIC_KEY',
  'JWT_SECRET',
  'SAML_ENTRY_POINT',
  'SAML_ISSUER',
  'SAML_IDP_CERT',
  'SAML_SP_PRIVATE_KEY',
] as const;

function validateJwtSecret(secret: string): void {
  const byteLength = new TextEncoder().encode(secret).length;
  if (secret === 'replace-me' || byteLength < 32) {
    throw new Error('JWT_SECRET must be a high-entropy secret of at least 32 bytes. Generate one with: openssl rand -hex 32');
  }
}

export function loadEnv(source: EnvSource): AppEnv {
  const merged: EnvSource = { ...optionalDefaults, ...source };

  for (const key of requiredKeys) {
    if (!merged[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  validateJwtSecret(merged.JWT_SECRET!);

  const appOrigin = merged.APP_ORIGIN!.replace(/\/$/, '');

  return {
    APP_ORIGIN: appOrigin,
    DISCORD_BOT_TOKEN: merged.DISCORD_BOT_TOKEN!,
    DISCORD_CLIENT_ID: merged.DISCORD_CLIENT_ID!,
    DISCORD_CLIENT_SECRET: merged.DISCORD_CLIENT_SECRET!,
    DISCORD_PUBLIC_KEY: merged.DISCORD_PUBLIC_KEY!,
    DISCORD_REDIRECT_URI: merged.DISCORD_REDIRECT_URI ?? `${appOrigin}/api/discord/callback`,
    JWT_SECRET: merged.JWT_SECRET!,
    SAML_ENTRY_POINT: merged.SAML_ENTRY_POINT!,
    SAML_ISSUER: merged.SAML_ISSUER!,
    SAML_CALLBACK_URL: merged.SAML_CALLBACK_URL ?? `${appOrigin}/api/saml/callback`,
    SAML_ACS_INDEX: merged.SAML_ACS_INDEX,
    SAML_IDP_CERT: merged.SAML_IDP_CERT!,
    SAML_SP_PRIVATE_KEY: merged.SAML_SP_PRIVATE_KEY!,
    OPERATOR_GUILD_ID: merged.OPERATOR_GUILD_ID,
    OPERATOR_CHANNEL_ID: merged.OPERATOR_CHANNEL_ID,
    PORT: merged.PORT,
  };
}
