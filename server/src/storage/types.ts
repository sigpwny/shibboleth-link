export type LinkFlowStep = 'created' | 'saml_started' | 'saml_verified' | 'discord_started' | 'discord_verified' | 'confirmed';

export interface LinkFlow {
  id: string;
  guildId: string;
  step: LinkFlowStep;
  shibUid?: string;
  shibAffiliations?: string[];
  discordUserId?: string;
  discordUsername?: string;
  createdAt: number;
  expiresAt: number;
  consumedAt?: number;
}

export interface OAuthState {
  stateHash: string;
  flowId: string;
  provider: 'saml' | 'discord';
  createdAt: number;
  expiresAt: number;
  consumedAt?: number;
}

export interface GuildConfig {
  guildId: string;
  name: string;
  iconUrl?: string;
  adminChannelId?: string;
  logLinksEnabled: boolean;
  linkingEnabled: boolean;
  mode: 'confirm_only' | 'link_and_store';
  verified: boolean;
  verificationExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ServerVerificationFlow {
  id: string;
  guildId: string;
  requesterDiscordUserId: string;
  requesterIsOwner: boolean;
  requesterIsAdmin: boolean;
  createdAt: number;
  expiresAt: number;
  completedAt?: number;
}

export interface ServerVerifier {
  guildId: string;
  discordUserId: string;
  shibUid: string;
  affiliations: string[];
  isOwner: boolean;
  isAdmin: boolean;
  active: boolean;
  alum: boolean;
  verifiedAt: number;
  expiresAt: number;
}

export interface StoredLink {
  guildId: string;
  discordUserId: string;
  shibUid: string;
  shibAffiliations: string[];
  createdAt: number;
  updatedAt: number;
}

export type BanTargetType = 'user' | 'server' | 'netid';

export interface BanRecord {
  targetType: BanTargetType;
  targetId: string;
  bannedByDiscordUserId?: string;
  createdAt: number;
  expiresAt?: number;
}

export interface RoleMapping {
  guildId: string;
  affiliation: string;
  roleId: string;
}

export interface AuditEvent {
  id: string;
  flowId?: string;
  guildId?: string;
  type: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface SamlRequest {
  id: string;
  value: string;
  createdAt: number;
  expiresAt: number;
  consumedAt?: number;
}

export interface CleanupResult {
  linkFlows: number;
  oauthStates: number;
  samlRequests: number;
  serverVerificationFlows: number;
}

export interface Storage {
  createLinkFlow(flow: LinkFlow): Promise<void>;
  getLinkFlow(flowId: string): Promise<LinkFlow | null>;
  updateLinkFlow(flow: LinkFlow): Promise<void>;
  completeLinkFlow(flowId: string, now: number): Promise<LinkFlow | null>;
  createOAuthState(state: OAuthState): Promise<void>;
  getOAuthState(stateHash: string, provider: OAuthState['provider'], now: number): Promise<OAuthState | null>;
  consumeOAuthState(stateHash: string, provider: OAuthState['provider'], now: number): Promise<OAuthState | null>;
  getGuildConfig(guildId: string): Promise<GuildConfig | null>;
  upsertGuildConfig(config: GuildConfig): Promise<void>;
  createServerVerificationFlow(flow: ServerVerificationFlow): Promise<void>;
  getServerVerificationFlow(id: string): Promise<ServerVerificationFlow | null>;
  completeServerVerificationFlow(id: string, now: number): Promise<void>;
  upsertServerVerifier(verifier: ServerVerifier): Promise<void>;
  listServerVerifiers(guildId: string, now: number): Promise<ServerVerifier[]>;
  invalidateServerVerifiers(guildId: string, now: number): Promise<number>;
  upsertStoredLink(link: StoredLink): Promise<void>;
  getStoredLink(guildId: string, discordUserId: string): Promise<StoredLink | null>;
  listStoredLinks(guildId: string): Promise<StoredLink[]>;
  removeStoredLink(guildId: string, discordUserId: string): Promise<boolean>;
  deleteStoredLinks(guildId: string): Promise<number>;
  upsertBan(record: BanRecord): Promise<void>;
  getActiveBan(targetType: BanTargetType, targetId: string, now: number): Promise<BanRecord | null>;
  removeBan(targetType: BanTargetType, targetId: string): Promise<boolean>;
  listRoleMappings(guildId: string): Promise<RoleMapping[]>;
  upsertRoleMapping(mapping: RoleMapping): Promise<void>;
  removeRoleMapping(guildId: string, affiliation: string): Promise<boolean>;
  createAuditEvent(event: AuditEvent): Promise<void>;
  saveSamlRequest(request: SamlRequest): Promise<void>;
  getSamlRequest(id: string, now: number): Promise<SamlRequest | null>;
  consumeSamlRequest(id: string, now: number): Promise<SamlRequest | null>;
  cleanupTransientRows(cutoff: number): Promise<CleanupResult>;
}
