import type { AuditEvent, BanRecord, BanTargetType, CleanupResult, GuildAdminChannel, GuildConfig, LinkFlow, OAuthState, RoleMapping, SamlRequest, ServerVerificationFlow, ServerVerifier, Storage, StoredLink } from './types.js';

export class MemoryStorage implements Storage {
  private readonly flows = new Map<string, LinkFlow>();
  private readonly states = new Map<string, OAuthState>();
  private readonly guilds = new Map<string, GuildConfig>();
  private readonly mappings: RoleMapping[] = [
    { guildId: '1517822433900363796', affiliation: 'student', roleId: '1517822477999411260' },
    { guildId: '1517822433900363796', affiliation: 'staff', roleId: '1517822477999411260' },
    { guildId: '1517822433900363796', affiliation: 'member', roleId: '1517822477999411260' },
    { guildId: '1517822433900363796', affiliation: 'employee', roleId: '1517822477999411260' },
    { guildId: '1517822433900363796', affiliation: 'affiliate', roleId: '1517822477999411260' },
  ];
  private readonly audit: AuditEvent[] = [];
  private readonly samlRequests = new Map<string, SamlRequest>();
  private readonly verificationFlows = new Map<string, ServerVerificationFlow>();
  private readonly verifiers = new Map<string, ServerVerifier>();
  private readonly storedLinks = new Map<string, StoredLink>();
  private readonly bans = new Map<string, BanRecord>();

  async createLinkFlow(flow: LinkFlow): Promise<void> {
    this.flows.set(flow.id, flow);
  }

  async getLinkFlow(flowId: string): Promise<LinkFlow | null> {
    return this.flows.get(flowId) ?? null;
  }

  async updateLinkFlow(flow: LinkFlow): Promise<void> {
    this.flows.set(flow.id, flow);
  }

  async completeLinkFlow(flowId: string, now: number): Promise<LinkFlow | null> {
    const flow = this.flows.get(flowId);
    if (!flow || flow.consumedAt || flow.expiresAt <= now) {
      return null;
    }
    const consumed = { ...flow, consumedAt: now };
    this.flows.set(flowId, consumed);
    return consumed;
  }

  async createOAuthState(state: OAuthState): Promise<void> {
    this.states.set(`${state.provider}:${state.stateHash}`, state);
  }

  async getOAuthState(stateHash: string, provider: OAuthState['provider'], now: number): Promise<OAuthState | null> {
    const state = this.states.get(`${provider}:${stateHash}`);
    if (!state || state.consumedAt || state.expiresAt <= now) {
      return null;
    }
    return state;
  }

  async consumeOAuthState(stateHash: string, provider: OAuthState['provider'], now: number): Promise<OAuthState | null> {
    const key = `${provider}:${stateHash}`;
    const state = this.states.get(key);
    if (!state || state.consumedAt || state.expiresAt <= now) {
      return null;
    }
    const consumed = { ...state, consumedAt: now };
    this.states.set(key, consumed);
    return consumed;
  }

  async getGuildConfig(guildId: string): Promise<GuildConfig | null> {
    if (guildId === '1517822433900363796' && !this.guilds.has(guildId)) {
      const now = Date.now();
      this.guilds.set(guildId, {
        guildId,
        name: 'Shibboleth Link Test Server',
        iconUrl: undefined,
        adminChannelId: undefined,
        logLinksEnabled: false,
        linkingEnabled: true,
        mode: 'confirm_only',
        verified: true,
        verificationExpiresAt: undefined,
        createdAt: now,
        updatedAt: now,
      });
    }

    return this.guilds.get(guildId) ?? null;
  }

  async listGuildAdminChannels(): Promise<GuildAdminChannel[]> {
    return [...this.guilds.values()].flatMap((config) => config.adminChannelId?.trim()
      ? [{ guildId: config.guildId, channelId: config.adminChannelId }]
      : []);
  }

  async upsertGuildConfig(config: GuildConfig): Promise<void> {
    this.guilds.set(config.guildId, config);
  }

  async createServerVerificationFlow(flow: ServerVerificationFlow): Promise<void> {
    this.verificationFlows.set(flow.id, flow);
  }

  async getServerVerificationFlow(id: string): Promise<ServerVerificationFlow | null> {
    return this.verificationFlows.get(id) ?? null;
  }

  async completeServerVerificationFlow(id: string, now: number): Promise<void> {
    const flow = this.verificationFlows.get(id);
    if (flow) {
      this.verificationFlows.set(id, { ...flow, completedAt: now });
    }
  }

  async upsertServerVerifier(verifier: ServerVerifier): Promise<void> {
    for (const [key, existing] of this.verifiers.entries()) {
      if (existing.guildId === verifier.guildId && existing.shibUid === verifier.shibUid && existing.discordUserId !== verifier.discordUserId) {
        this.verifiers.delete(key);
      }
    }
    this.verifiers.set(`${verifier.guildId}:${verifier.discordUserId}`, verifier);
  }

  async listServerVerifiers(guildId: string, now: number): Promise<ServerVerifier[]> {
    return [...this.verifiers.values()].filter((verifier) => verifier.guildId === guildId && verifier.expiresAt > now);
  }

  async invalidateServerVerifiers(guildId: string, now: number): Promise<number> {
    let changes = 0;
    for (const [key, verifier] of this.verifiers.entries()) {
      if (verifier.guildId === guildId && verifier.expiresAt > now) {
        this.verifiers.set(key, { ...verifier, expiresAt: now });
        changes += 1;
      }
    }
    return changes;
  }

  async upsertStoredLink(link: StoredLink): Promise<void> {
    this.storedLinks.set(`${link.guildId}:${link.discordUserId}`, link);
  }

  async getStoredLink(guildId: string, discordUserId: string): Promise<StoredLink | null> {
    return this.storedLinks.get(`${guildId}:${discordUserId}`) ?? null;
  }

  async listStoredLinks(guildId: string): Promise<StoredLink[]> {
    return [...this.storedLinks.values()].filter((link) => link.guildId === guildId);
  }

  async removeStoredLink(guildId: string, discordUserId: string): Promise<boolean> {
    return this.storedLinks.delete(`${guildId}:${discordUserId}`);
  }

  async deleteStoredLinks(guildId: string): Promise<number> {
    let changes = 0;
    for (const [key, link] of this.storedLinks.entries()) {
      if (link.guildId === guildId) {
        this.storedLinks.delete(key);
        changes += 1;
      }
    }
    return changes;
  }

  async upsertBan(record: BanRecord): Promise<void> {
    this.bans.set(`${record.targetType}:${record.targetId}`, record);
  }

  async getActiveBan(targetType: BanTargetType, targetId: string, now: number): Promise<BanRecord | null> {
    const ban = this.bans.get(`${targetType}:${targetId}`);
    if (!ban || (ban.expiresAt && ban.expiresAt <= now)) {
      return null;
    }
    return ban;
  }

  async removeBan(targetType: BanTargetType, targetId: string): Promise<boolean> {
    return this.bans.delete(`${targetType}:${targetId}`);
  }

  async listRoleMappings(guildId: string): Promise<RoleMapping[]> {
    return this.mappings.filter((mapping) => mapping.guildId === guildId);
  }

  async upsertRoleMapping(mapping: RoleMapping): Promise<void> {
    const index = this.mappings.findIndex((candidate) => (
      candidate.guildId === mapping.guildId && candidate.affiliation === mapping.affiliation
    ));

    if (index === -1) {
      this.mappings.push(mapping);
      return;
    }

    this.mappings[index] = mapping;
  }

  async removeRoleMapping(guildId: string, affiliation: string): Promise<boolean> {
    const index = this.mappings.findIndex((mapping) => mapping.guildId === guildId && mapping.affiliation === affiliation);
    if (index === -1) {
      return false;
    }
    this.mappings.splice(index, 1);
    return true;
  }

  async createAuditEvent(event: AuditEvent): Promise<void> {
    this.audit.push(event);
  }

  async saveSamlRequest(request: SamlRequest): Promise<void> {
    this.samlRequests.set(request.id, request);
  }

  async getSamlRequest(id: string, now: number): Promise<SamlRequest | null> {
    const request = this.samlRequests.get(id);
    if (!request || request.consumedAt || request.expiresAt <= now) {
      return null;
    }
    return request;
  }

  async consumeSamlRequest(id: string, now: number): Promise<SamlRequest | null> {
    const request = await this.getSamlRequest(id, now);
    if (!request) {
      return null;
    }
    const consumed = { ...request, consumedAt: now };
    this.samlRequests.set(id, consumed);
    return consumed;
  }

  async cleanupTransientRows(cutoff: number): Promise<CleanupResult> {
    let linkFlows = 0;
    for (const [id, flow] of this.flows.entries()) {
      if (flow.expiresAt <= cutoff || (flow.consumedAt !== undefined && flow.consumedAt <= cutoff)) {
        this.flows.delete(id);
        linkFlows += 1;
      }
    }

    let oauthStates = 0;
    for (const [key, state] of this.states.entries()) {
      if (state.expiresAt <= cutoff || (state.consumedAt !== undefined && state.consumedAt <= cutoff)) {
        this.states.delete(key);
        oauthStates += 1;
      }
    }

    let samlRequests = 0;
    for (const [id, request] of this.samlRequests.entries()) {
      if (request.expiresAt <= cutoff || (request.consumedAt !== undefined && request.consumedAt <= cutoff)) {
        this.samlRequests.delete(id);
        samlRequests += 1;
      }
    }

    let serverVerificationFlows = 0;
    for (const [id, flow] of this.verificationFlows.entries()) {
      if (flow.expiresAt <= cutoff || (flow.completedAt !== undefined && flow.completedAt <= cutoff)) {
        this.verificationFlows.delete(id);
        serverVerificationFlows += 1;
      }
    }

    return { linkFlows, oauthStates, samlRequests, serverVerificationFlows };
  }
}
