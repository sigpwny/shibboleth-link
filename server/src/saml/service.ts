import { SAML, ValidateInResponseTo, type CacheItem, type CacheProvider, type Profile, type SamlConfig } from '@node-saml/node-saml';
import type { AppEnv } from '../env.js';
import type { Storage } from '../storage/types.js';
import { SAML_ATTRIBUTES } from './attributes.js';

const SAML_REQUEST_TTL_MS = 10 * 60 * 1000;

const ATTRIBUTES = {
  uid: SAML_ATTRIBUTES.uid.oid,
  eduPersonAffiliation: SAML_ATTRIBUTES.eduPersonAffiliation.oid,
} as const;

class StorageCacheProvider implements CacheProvider {
  constructor(private readonly storage: Storage) {}

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    const now = Date.now();
    await this.storage.saveSamlRequest({
      id: key,
      value,
      createdAt: now,
      expiresAt: now + SAML_REQUEST_TTL_MS,
    });
    return { value, createdAt: now };
  }

  async getAsync(key: string): Promise<string | null> {
    const request = await this.storage.getSamlRequest(key, Date.now());
    return request?.value ?? null;
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) {
      return null;
    }

    const request = await this.storage.consumeSamlRequest(key, Date.now());
    return request?.value ?? null;
  }
}

class IndexedAcsSamlClient extends SAML {
  constructor(
    options: SamlConfig,
    private readonly assertionConsumerServiceIndex?: string,
  ) {
    super(options);
  }

  protected override async generateAuthorizeRequestAsync(isPassive: boolean, isHttpPostBinding: boolean): Promise<string> {
    const request = await super.generateAuthorizeRequestAsync(isPassive, isHttpPostBinding);
    if (!this.assertionConsumerServiceIndex) {
      return request;
    }

    return request.replace(
      /<samlp:AuthnRequest\b([^>]*)>/,
      (match, attributes: string) => {
        const withoutUrl = attributes
          .replace(/\sAssertionConsumerServiceURL="[^"]*"/, '')
          .replace(/\sProtocolBinding="[^"]*"/, '');
        return `<samlp:AuthnRequest${withoutUrl} AssertionConsumerServiceIndex="${this.assertionConsumerServiceIndex}">`;
      },
    );
  }
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => asStringArray(item));
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

export interface ShibbolethProfile {
  uid?: string;
  affiliations: string[];
}

export function createSamlClient(env: AppEnv, storage: Storage): SAML {
  return new IndexedAcsSamlClient({
    entryPoint: env.SAML_ENTRY_POINT,
    callbackUrl: env.SAML_CALLBACK_URL,
    issuer: env.SAML_ISSUER,
    audience: env.SAML_ISSUER,
    idpCert: env.SAML_IDP_CERT,
    decryptionPvk: env.SAML_SP_PRIVATE_KEY,
    wantAuthnResponseSigned: true,
    // UIUC signs the SAML response envelope but not individual assertions; requiring assertion signatures breaks live IdP callbacks.
    wantAssertionsSigned: false,
    identifierFormat: null,
    disableRequestAcsUrl: Boolean(env.SAML_ACS_INDEX),
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
    acceptedClockSkewMs: 60_000,
    cacheProvider: new StorageCacheProvider(storage),
  }, env.SAML_ACS_INDEX);
}

export async function getSamlLoginUrl(env: AppEnv, storage: Storage, relayState: string): Promise<string> {
  const client = createSamlClient(env, storage);
  return client.getAuthorizeUrlAsync(relayState, undefined, {});
}

export async function validateSamlPost(env: AppEnv, storage: Storage, samlResponse: string): Promise<ShibbolethProfile> {
  const client = createSamlClient(env, storage);
  const result = await client.validatePostResponseAsync({ SAMLResponse: samlResponse });
  const profile = result.profile;
  if (!profile) {
    throw new Error('SAML response did not contain a profile');
  }

  return extractShibbolethProfile(profile);
}

export function extractShibbolethProfile(profile: Profile): ShibbolethProfile {
  const uid = asStringArray(profile[ATTRIBUTES.uid])[0];
  const affiliations = asStringArray(profile[ATTRIBUTES.eduPersonAffiliation]);

  if (!uid && affiliations.length === 0) {
    throw new Error('SAML response missing known Shibboleth attributes');
  }

  return { uid, affiliations };
}
