import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import type { AuditEvent, BanRecord, BanTargetType, CleanupResult, GuildAdminChannel, GuildConfig, GuildStats, LinkFlow, OAuthState, RoleMapping, SamlRequest, ServerVerificationFlow, ServerVerifier, Storage, StoredLink } from './types.js';

function rowToFlow(row: Record<string, unknown>): LinkFlow {
  return {
    id: String(row.id),
    guildId: String(row.guild_id),
    step: row.step as LinkFlow['step'],
    shibUid: row.shib_uid ? String(row.shib_uid) : undefined,
    shibAffiliations: row.shib_affiliations ? JSON.parse(String(row.shib_affiliations)) as string[] : undefined,
    discordUserId: row.discord_user_id ? String(row.discord_user_id) : undefined,
    discordUsername: row.discord_username ? String(row.discord_username) : undefined,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    consumedAt: row.consumed_at ? Number(row.consumed_at) : undefined,
  };
}

function rowToStoredLink(row: Record<string, unknown>): StoredLink {
  return {
    guildId: String(row.guild_id),
    discordUserId: String(row.discord_user_id),
    shibUid: String(row.shib_uid),
    shibAffiliations: JSON.parse(String(row.shib_affiliations)) as string[],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToBan(row: Record<string, unknown>): BanRecord {
  return {
    targetType: row.target_type as BanTargetType,
    targetId: String(row.target_id),
    bannedByDiscordUserId: row.banned_by_discord_user_id ? String(row.banned_by_discord_user_id) : undefined,
    createdAt: Number(row.created_at),
    expiresAt: row.expires_at ? Number(row.expires_at) : undefined,
  };
}

export class SqliteStorage implements Storage {
  private readonly db: Database.Database;

  constructor(path = 'data/local.sqlite') {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  migrate(migrationsPath = 'migrations'): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');

    const path = resolve(migrationsPath);
    for (const name of readdirSync(path).filter((entry) => entry.endsWith('.sql')).sort()) {
      const applied = this.db.prepare('SELECT name FROM __migrations WHERE name = ?').get(name);
      if (applied) {
        continue;
      }

      const sql = readFileSync(join(path, name), 'utf8');
      try {
        this.db.exec(sql);
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('duplicate column name'))) {
          throw error;
        }
      }

      this.db.prepare('INSERT OR IGNORE INTO __migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
    }
  }

  seed(seedPath: string): void {
    this.db.exec(readFileSync(resolve(seedPath), 'utf8'));
  }

  async createLinkFlow(flow: LinkFlow): Promise<void> {
    this.db.prepare(`
      INSERT INTO link_flows (id, guild_id, step, shib_uid, shib_affiliations, discord_user_id, discord_username, created_at, expires_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      flow.id,
      flow.guildId,
      flow.step,
      flow.shibUid ?? null,
      flow.shibAffiliations ? JSON.stringify(flow.shibAffiliations) : null,
      flow.discordUserId ?? null,
      flow.discordUsername ?? null,
      flow.createdAt,
      flow.expiresAt,
      flow.consumedAt ?? null,
    );
  }

  async getLinkFlow(flowId: string): Promise<LinkFlow | null> {
    const row = this.db.prepare('SELECT * FROM link_flows WHERE id = ?').get(flowId) as Record<string, unknown> | undefined;
    return row ? rowToFlow(row) : null;
  }

  async updateLinkFlow(flow: LinkFlow): Promise<void> {
    this.db.prepare(`
      UPDATE link_flows
      SET step = ?, shib_uid = ?, shib_affiliations = ?, discord_user_id = ?, discord_username = ?, consumed_at = ?
      WHERE id = ?
    `).run(
      flow.step,
      flow.shibUid ?? null,
      flow.shibAffiliations ? JSON.stringify(flow.shibAffiliations) : null,
      flow.discordUserId ?? null,
      flow.discordUsername ?? null,
      flow.consumedAt ?? null,
      flow.id,
    );
  }

  async completeLinkFlow(flowId: string, now: number): Promise<LinkFlow | null> {
    const result = this.db.prepare(`
      UPDATE link_flows
      SET consumed_at = ?, step = 'confirmed', shib_uid = NULL, shib_affiliations = NULL, discord_user_id = NULL, discord_username = NULL
      WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
    `).run(now, flowId, now);

    if (!result.changes) {
      return null;
    }

    return this.getLinkFlow(flowId);
  }

  async createOAuthState(state: OAuthState): Promise<void> {
    this.db.prepare(`
      INSERT INTO oauth_states (state_hash, flow_id, provider, created_at, expires_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(state.stateHash, state.flowId, state.provider, state.createdAt, state.expiresAt, state.consumedAt ?? null);
  }

  async getOAuthState(stateHash: string, provider: OAuthState['provider'], now: number): Promise<OAuthState | null> {
    const row = this.db.prepare(`
      SELECT * FROM oauth_states
      WHERE state_hash = ? AND provider = ? AND consumed_at IS NULL AND expires_at > ?
    `).get(stateHash, provider, now) as Record<string, unknown> | undefined;

    return row
      ? {
          stateHash: String(row.state_hash),
          flowId: String(row.flow_id),
          provider: row.provider as OAuthState['provider'],
          createdAt: Number(row.created_at),
          expiresAt: Number(row.expires_at),
          consumedAt: row.consumed_at ? Number(row.consumed_at) : undefined,
        }
      : null;
  }

  async consumeOAuthState(stateHash: string, provider: OAuthState['provider'], now: number): Promise<OAuthState | null> {
    const result = this.db.prepare(`
      UPDATE oauth_states
      SET consumed_at = ?
      WHERE state_hash = ? AND provider = ? AND consumed_at IS NULL AND expires_at > ?
    `).run(now, stateHash, provider, now);

    if (!result.changes) {
      return null;
    }

    const row = this.db.prepare('SELECT * FROM oauth_states WHERE state_hash = ? AND provider = ?')
      .get(stateHash, provider) as Record<string, unknown> | undefined;

    return row
      ? {
          stateHash: String(row.state_hash),
          flowId: String(row.flow_id),
          provider: row.provider as OAuthState['provider'],
          createdAt: Number(row.created_at),
          expiresAt: Number(row.expires_at),
          consumedAt: Number(row.consumed_at),
        }
      : null;
  }

  async getGuildConfig(guildId: string): Promise<GuildConfig | null> {
    const row = this.db.prepare('SELECT * FROM guild_configs WHERE guild_id = ?').get(guildId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    const verificationExpiresAt = row.verification_expires_at ? Number(row.verification_expires_at) : undefined;
    return {
      guildId: String(row.guild_id),
      name: String(row.name),
      iconUrl: row.icon_url ? String(row.icon_url) : undefined,
      adminChannelId: row.admin_channel_id ? String(row.admin_channel_id) : undefined,
      logLinksEnabled: Boolean(row.log_links_enabled),
      linkingEnabled: row.linking_enabled === undefined ? true : Boolean(row.linking_enabled),
      mode: row.mode === 'link_and_store' ? 'link_and_store' : 'confirm_only',
      verified: Boolean(row.verified) && Boolean(verificationExpiresAt && verificationExpiresAt > Date.now()),
      verificationExpiresAt,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async getGuildStats(now: number): Promise<GuildStats> {
    const row = this.db.prepare(`
      SELECT
        COUNT(CASE WHEN verified = 1 AND verification_expires_at > ? THEN 1 END) AS verified,
        COUNT(CASE WHEN linking_enabled = 1 THEN 1 END) AS linking_enabled,
        COUNT(CASE WHEN linking_enabled = 1 AND mode = 'confirm_only' THEN 1 END) AS confirm_only,
        COUNT(CASE WHEN linking_enabled = 1 AND mode = 'link_and_store' THEN 1 END) AS link_and_store
      FROM guild_configs
    `).get(now) as Record<string, number>;
    return {
      verified: Number(row.verified),
      linkingEnabled: Number(row.linking_enabled),
      confirmOnly: Number(row.confirm_only),
      linkAndStore: Number(row.link_and_store),
    };
  }

  async listGuildAdminChannels(): Promise<GuildAdminChannel[]> {
    const rows = this.db.prepare(`
      SELECT guild_id, admin_channel_id FROM guild_configs
      WHERE admin_channel_id IS NOT NULL AND TRIM(admin_channel_id) != ''
    `).all() as Record<string, unknown>[];
    return rows.map((row) => ({
      guildId: String(row.guild_id),
      channelId: String(row.admin_channel_id),
    }));
  }

  async upsertGuildConfig(config: GuildConfig): Promise<void> {
    this.db.prepare(`
      INSERT INTO guild_configs (guild_id, name, icon_url, admin_channel_id, log_links_enabled, linking_enabled, mode, verified, verification_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        name = excluded.name,
        icon_url = excluded.icon_url,
        admin_channel_id = excluded.admin_channel_id,
        log_links_enabled = excluded.log_links_enabled,
        linking_enabled = excluded.linking_enabled,
        mode = excluded.mode,
        verified = excluded.verified,
        verification_expires_at = excluded.verification_expires_at,
        updated_at = excluded.updated_at
    `).run(config.guildId, config.name, config.iconUrl ?? null, config.adminChannelId ?? null, config.logLinksEnabled ? 1 : 0, config.linkingEnabled ? 1 : 0, config.mode, config.verified ? 1 : 0, config.verificationExpiresAt ?? null, config.createdAt, config.updatedAt);
  }

  async createServerVerificationFlow(flow: ServerVerificationFlow): Promise<void> {
    this.db.prepare(`
      INSERT INTO server_verification_flows (id, guild_id, requester_discord_user_id, requester_is_owner, requester_is_admin, created_at, expires_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(flow.id, flow.guildId, flow.requesterDiscordUserId, flow.requesterIsOwner ? 1 : 0, flow.requesterIsAdmin ? 1 : 0, flow.createdAt, flow.expiresAt, flow.completedAt ?? null);
  }

  async getServerVerificationFlow(id: string): Promise<ServerVerificationFlow | null> {
    const row = this.db.prepare('SELECT * FROM server_verification_flows WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? {
      id: String(row.id),
      guildId: String(row.guild_id),
      requesterDiscordUserId: String(row.requester_discord_user_id),
      requesterIsOwner: Boolean(row.requester_is_owner),
      requesterIsAdmin: Boolean(row.requester_is_admin),
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      completedAt: row.completed_at ? Number(row.completed_at) : undefined,
    } : null;
  }

  async completeServerVerificationFlow(id: string, now: number): Promise<void> {
    this.db.prepare('UPDATE server_verification_flows SET completed_at = ? WHERE id = ?').run(now, id);
  }

  async upsertServerVerifier(verifier: ServerVerifier): Promise<void> {
    this.db.prepare(`
      DELETE FROM server_verifiers
      WHERE guild_id = ? AND shib_uid = ? AND discord_user_id != ?
    `).run(verifier.guildId, verifier.shibUid, verifier.discordUserId);

    this.db.prepare(`
      INSERT INTO server_verifiers (guild_id, discord_user_id, shib_uid, affiliations, is_owner, is_admin, active, alum, verified_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, discord_user_id) DO UPDATE SET
        shib_uid = excluded.shib_uid,
        affiliations = excluded.affiliations,
        is_owner = excluded.is_owner,
        is_admin = excluded.is_admin,
        active = excluded.active,
        alum = excluded.alum,
        verified_at = excluded.verified_at,
        expires_at = excluded.expires_at
    `).run(verifier.guildId, verifier.discordUserId, verifier.shibUid, JSON.stringify(verifier.affiliations), verifier.isOwner ? 1 : 0, verifier.isAdmin ? 1 : 0, verifier.active ? 1 : 0, verifier.alum ? 1 : 0, verifier.verifiedAt, verifier.expiresAt);
  }

  async listServerVerifiers(guildId: string, now: number): Promise<ServerVerifier[]> {
    const rows = this.db.prepare('SELECT * FROM server_verifiers WHERE guild_id = ? AND expires_at > ?').all(guildId, now) as Record<string, unknown>[];
    return rows.map((row) => ({
      guildId: String(row.guild_id),
      discordUserId: String(row.discord_user_id),
      shibUid: String(row.shib_uid),
      affiliations: JSON.parse(String(row.affiliations)) as string[],
      isOwner: Boolean(row.is_owner),
      isAdmin: Boolean(row.is_admin),
      active: Boolean(row.active),
      alum: Boolean(row.alum),
      verifiedAt: Number(row.verified_at),
      expiresAt: Number(row.expires_at),
    }));
  }

  async invalidateServerVerifiers(guildId: string, now: number): Promise<number> {
    const result = this.db.prepare(`
      UPDATE server_verifiers
      SET expires_at = ?
      WHERE guild_id = ? AND expires_at > ?
    `).run(now, guildId, now);
    return result.changes;
  }

  async upsertStoredLink(link: StoredLink): Promise<void> {
    this.db.prepare(`
      INSERT INTO stored_links (guild_id, discord_user_id, shib_uid, shib_affiliations, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, discord_user_id) DO UPDATE SET
        shib_uid = excluded.shib_uid,
        shib_affiliations = excluded.shib_affiliations,
        updated_at = excluded.updated_at
    `).run(link.guildId, link.discordUserId, link.shibUid, JSON.stringify(link.shibAffiliations), link.createdAt, link.updatedAt);
  }

  async getStoredLink(guildId: string, discordUserId: string): Promise<StoredLink | null> {
    const row = this.db.prepare('SELECT * FROM stored_links WHERE guild_id = ? AND discord_user_id = ?')
      .get(guildId, discordUserId) as Record<string, unknown> | undefined;
    return row ? rowToStoredLink(row) : null;
  }

  async listStoredLinks(guildId: string): Promise<StoredLink[]> {
    const rows = this.db.prepare('SELECT * FROM stored_links WHERE guild_id = ? ORDER BY updated_at DESC')
      .all(guildId) as Record<string, unknown>[];
    return rows.map(rowToStoredLink);
  }

  async removeStoredLink(guildId: string, discordUserId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM stored_links WHERE guild_id = ? AND discord_user_id = ?').run(guildId, discordUserId);
    return Boolean(result.changes);
  }

  async deleteStoredLinks(guildId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM stored_links WHERE guild_id = ?').run(guildId);
    return result.changes;
  }

  async upsertBan(record: BanRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO bans (target_type, target_id, banned_by_discord_user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(target_type, target_id) DO UPDATE SET
        banned_by_discord_user_id = excluded.banned_by_discord_user_id,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `).run(record.targetType, record.targetId, record.bannedByDiscordUserId ?? null, record.createdAt, record.expiresAt ?? null);
  }

  async getActiveBan(targetType: BanTargetType, targetId: string, now: number): Promise<BanRecord | null> {
    const row = this.db.prepare(`
      SELECT * FROM bans
      WHERE target_type = ? AND target_id = ? AND (expires_at IS NULL OR expires_at > ?)
    `).get(targetType, targetId, now) as Record<string, unknown> | undefined;
    return row ? rowToBan(row) : null;
  }

  async removeBan(targetType: BanTargetType, targetId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM bans WHERE target_type = ? AND target_id = ?').run(targetType, targetId);
    return Boolean(result.changes);
  }

  async listRoleMappings(guildId: string): Promise<RoleMapping[]> {
    const rows = this.db.prepare('SELECT * FROM role_mappings WHERE guild_id = ?').all(guildId) as Record<string, unknown>[];
    return rows.map((row) => ({
      guildId: String(row.guild_id),
      affiliation: String(row.affiliation),
      roleId: String(row.role_id),
    }));
  }

  async upsertRoleMapping(mapping: RoleMapping): Promise<void> {
    this.db.prepare(`
      INSERT INTO role_mappings (guild_id, affiliation, role_id)
      VALUES (?, ?, ?)
      ON CONFLICT(guild_id, affiliation) DO UPDATE SET role_id = excluded.role_id
    `).run(mapping.guildId, mapping.affiliation, mapping.roleId);
  }

  async removeRoleMapping(guildId: string, affiliation: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM role_mappings WHERE guild_id = ? AND affiliation = ?').run(guildId, affiliation);
    return Boolean(result.changes);
  }

  async createAuditEvent(event: AuditEvent): Promise<void> {
    this.db.prepare(`
      INSERT INTO audit_events (id, flow_id, guild_id, type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.flowId ?? null,
      event.guildId ?? null,
      event.type,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.createdAt,
    );
  }

  async saveSamlRequest(request: SamlRequest): Promise<void> {
    this.db.prepare(`
      INSERT INTO saml_requests (id, value, created_at, expires_at, consumed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(request.id, request.value, request.createdAt, request.expiresAt, request.consumedAt ?? null);
  }

  async getSamlRequest(id: string, now: number): Promise<SamlRequest | null> {
    const row = this.db.prepare(`
      SELECT * FROM saml_requests WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
    `).get(id, now) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      value: String(row.value),
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      consumedAt: row.consumed_at ? Number(row.consumed_at) : undefined,
    };
  }

  async consumeSamlRequest(id: string, now: number): Promise<SamlRequest | null> {
    const result = this.db.prepare(`
      UPDATE saml_requests
      SET consumed_at = ?
      WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
    `).run(now, id, now);

    if (!result.changes) {
      return null;
    }

    const row = this.db.prepare('SELECT * FROM saml_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;

    return row
      ? {
          id: String(row.id),
          value: String(row.value),
          createdAt: Number(row.created_at),
          expiresAt: Number(row.expires_at),
          consumedAt: Number(row.consumed_at),
        }
      : null;
  }

  async cleanupTransientRows(cutoff: number): Promise<CleanupResult> {
    const linkFlows = this.db.prepare('DELETE FROM link_flows WHERE expires_at <= ? OR consumed_at <= ?').run(cutoff, cutoff).changes;
    const oauthStates = this.db.prepare('DELETE FROM oauth_states WHERE expires_at <= ? OR consumed_at <= ?').run(cutoff, cutoff).changes;
    const samlRequests = this.db.prepare('DELETE FROM saml_requests WHERE expires_at <= ? OR consumed_at <= ?').run(cutoff, cutoff).changes;
    const serverVerificationFlows = this.db.prepare('DELETE FROM server_verification_flows WHERE expires_at <= ? OR completed_at <= ?').run(cutoff, cutoff).changes;
    return { linkFlows, oauthStates, samlRequests, serverVerificationFlows };
  }
}
